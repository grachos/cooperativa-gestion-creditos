import { round2 } from "../../utils/money.js";

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

export function getMoraBucket(overdueDays: number): (typeof MORA_BUCKETS)[number] {
  return MORA_BUCKETS.find((b) => overdueDays >= b.minDays && overdueDays <= b.maxDays) ?? MORA_BUCKETS[0];
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
