import { round2 } from "../../utils/money.js";
import type { PoolLike } from "../../db/pool.js";

export interface DelinquencyPolicy {
  version: string;
  graceDays: number;
  base: "CAPITAL_VENCIDO" | "CUOTA_VENCIDA";
  rateType: "DIARIA" | "MENSUAL_FIJA";
  rateOrValue: number;
  cap: number | null;
  earlyAlertDays: number;
}

/**
 * Buckets de mora tomados literalmente del Excel real de la cooperativa
 * (columna "CÓDIGO DE MORA" y su leyenda: CD001 = crédito al día,
 * CM030/060/090/120/150/180 = días de atraso, CC002 = crédito cancelado).
 * El Excel de origen tenía un error de tipeo en la leyenda ("MORA 90 =
 * CM030", duplicando el código de la cuota 30); aquí se corrige a CM090
 * siguiendo la progresión de 30 en 30 días que sí es consistente en los
 * datos de las filas reales.
 */
export const MORA_BUCKETS = [
  { code: "CD001", label: "Al día", minDays: 0, maxDays: 29 },
  { code: "CM030", label: "Mora 30", minDays: 30, maxDays: 59 },
  { code: "CM060", label: "Mora 60", minDays: 60, maxDays: 89 },
  { code: "CM090", label: "Mora 90", minDays: 90, maxDays: 119 },
  { code: "CM120", label: "Mora 120", minDays: 120, maxDays: 149 },
  { code: "CM150", label: "Mora 150", minDays: 150, maxDays: 179 },
  { code: "CM180", label: "Mora 180+", minDays: 180, maxDays: Infinity }
] as const;

export interface MoraBucket {
  code: string;
  label: string;
  minDays: number;
  maxDays: number;
}

export function getMoraBucket(overdueDays: number, buckets: MoraBucket[] = MORA_BUCKETS as unknown as MoraBucket[]): MoraBucket {
  return buckets.find((b) => overdueDays >= b.minDays && overdueDays <= b.maxDays) ?? buckets[0] ?? (MORA_BUCKETS[0] as MoraBucket);
}

/**
 * Lee el parámetro `rangos_mora` (ver Parámetros) en vez de los MORA_BUCKETS
 * fijos de arriba, para que editarlo desde la UI de verdad cambie la
 * clasificación de mora. JSON.stringify serializa Infinity como null (el
 * último bucket no tiene tope superior), así que se restaura aquí.
 */
export async function loadMoraBuckets(db: PoolLike): Promise<MoraBucket[]> {
  const [rows] = await db.query<any[]>(`SELECT value FROM parameters WHERE \`key\` = 'rangos_mora'`);
  const value = (rows as any[])[0]?.value;
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((b) => b && typeof b.code === "string" && typeof b.minDays === "number")
  ) {
    return value.map((b) => ({ ...b, maxDays: b.maxDays === null || b.maxDays === undefined ? Infinity : b.maxDays }));
  }
  return MORA_BUCKETS as unknown as MoraBucket[];
}

/**
 * Política de demostración, corregida contra el Excel real de la
 * cooperativa (COOMULNISSI). Se buscaron explícitamente términos como
 * "interés de mora", "recargo", "gastos de cobranza" y "abogado" en el
 * histórico de observaciones de pago y NO aparece ningún interés o recargo
 * automático por mora: el único cargo adicional visto fue un "GASTOS DE
 * NOTIFICACIÓN" de $100.000 aplicado manualmente, una única vez, por una
 * gestora. Por eso `rateOrValue` queda en 0 por defecto — la cooperativa,
 * hoy, NO cobra interés de mora automático; solo hace seguimiento por
 * buckets de días (ver MORA_BUCKETS) y aplica cargos puntuales como
 * ajustes manuales auditables (`credit_adjustments`, tipo
 * GASTO_NOTIFICACION). Si la cooperativa confirma que sí quiere cobrar
 * interés de mora hacia adelante, este es el parámetro a activar.
 */
export const DEFAULT_DELINQUENCY_POLICY: DelinquencyPolicy = {
  version: "demo-v2-real",
  graceDays: 0,
  base: "CAPITAL_VENCIDO",
  rateType: "DIARIA",
  rateOrValue: 0, // sin evidencia de interés de mora automático en los datos reales
  cap: null,
  earlyAlertDays: 3 // alerta temprana 3 días antes del vencimiento
};

/** Lee el parámetro `politica_mora` en vez de DEFAULT_DELINQUENCY_POLICY. */
export async function loadDelinquencyPolicy(db: PoolLike): Promise<DelinquencyPolicy> {
  const [rows] = await db.query<any[]>(`SELECT value FROM parameters WHERE \`key\` = 'politica_mora'`);
  const value = (rows as any[])[0]?.value;
  if (value && typeof value === "object" && typeof value.rateOrValue === "number" && typeof value.graceDays === "number") {
    return { ...DEFAULT_DELINQUENCY_POLICY, ...value };
  }
  return DEFAULT_DELINQUENCY_POLICY;
}

export function calculateOverdueDays(dueDate: Date, asOf: Date): number {
  const ms = asOf.getTime() - dueDate.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function calculateLateFee(params: {
  policy: DelinquencyPolicy;
  overdueDays: number;
  principalOrInstallmentBase: number;
}): { chargeableDays: number; result: number } {
  const { policy, overdueDays, principalOrInstallmentBase } = params;
  if (policy.rateOrValue === 0) return { chargeableDays: 0, result: 0 };

  const chargeableDays = Math.max(0, overdueDays - policy.graceDays);
  if (chargeableDays <= 0) return { chargeableDays: 0, result: 0 };

  let result: number;
  if (policy.rateType === "DIARIA") {
    result = round2(principalOrInstallmentBase * (policy.rateOrValue / 100) * chargeableDays);
  } else {
    result = round2(principalOrInstallmentBase * (policy.rateOrValue / 100));
  }
  if (policy.cap !== null) result = Math.min(result, policy.cap);
  return { chargeableDays, result };
}
