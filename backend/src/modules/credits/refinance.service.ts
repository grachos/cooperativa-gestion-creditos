import type { PoolLike } from "../../db/pool.js";
import { HttpError } from "../../middlewares/error.middleware.js";
import { round2 } from "../../utils/money.js";
import { buildAmortizationSchedule, type ScheduleRow } from "./schedule.service.js";

/**
 * Refinanciación según la regla de la cooperativa (confirmada el 2026-10-19, hallazgo H9).
 *
 * Ejemplo: $2.000.000 al 4 % a 15 cuotas de $213.400; el cliente pagó 7 y refinancia a 15 meses.
 *  - Cuotas pendientes: todas las que no están PAGADAS (si debe cuotas vencidas, se calcula desde la
 *    última pagada). Lo que deben: $1.707.200 = capital $1.066.666,67 + interés $640.533,33.
 *  - Interés adicional: interés mensual del préstamo inicial ($2.000.000 × 4 % = $80.000) × cuotas
 *    pendientes (8) = $640.000. Se puede apagar con el parámetro `refinanciacion`.
 *  - Nuevo crédito: $2.347.200, sin interés propio, en el plazo elegido: $156.480 → cuota $156.500 (redondeada hacia
 *    arriba a $100, parámetro `redondeo_cuota`).
 *  - Se guarda separado: capital heredado (el capital que faltaba) e interés heredado (el pendiente más el
 *    adicional), y lo que el cliente ya había pagado de capital y de interés en el crédito anterior.
 *  - El dinero nuevo NO se suma: se presta como un crédito aparte, con su interés normal.
 */

export interface RefinanceRule {
  chargeOriginalInterestOnPending: boolean;
}

export interface RefinanceQuote {
  creditId: number;
  rootCreditId: number;
  termValue: number;
  installmentsTotal: number;
  lastPaidInstallment: number | null;
  pendingInstallments: number;
  pendingPrincipal: number;
  pendingInterest: number;
  pendingTotal: number;
  paidPrincipal: number;
  paidInterest: number;
  originalMonthlyInterest: number;
  additionalInterest: number;
  inheritedPrincipal: number;
  inheritedInterest: number;
  total: number;
  installment: number;
  pendingCharges: number;
  rule: RefinanceRule;
}

async function loadJson(db: PoolLike, key: string): Promise<Record<string, unknown> | null> {
  const [rows] = await db.query<any[]>(`SELECT value FROM parameters WHERE \`key\` = ?`, [key]);
  const value = (rows as any[])[0]?.value;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Múltiplo al que se redondea hacia arriba la cuota (parámetro `redondeo_cuota`; 0 = sin redondeo). */
export async function loadInstallmentRounding(db: PoolLike): Promise<number> {
  const multiple = (await loadJson(db, "redondeo_cuota"))?.multiple;
  return typeof multiple === "number" && Number.isFinite(multiple) && multiple >= 0 ? multiple : 0;
}

export async function loadRefinanceRule(db: PoolLike): Promise<RefinanceRule> {
  const p = await loadJson(db, "refinanciacion");
  return { chargeOriginalInterestOnPending: p?.chargeOriginalInterestOnPending !== false };
}

/** El préstamo inicial de una cadena de refinanciaciones (el "interés mensual" se toma de él). */
async function rootCredit(db: PoolLike, credit: any): Promise<any> {
  let current = credit;
  for (let i = 0; i < 50 && current.refinanced_from_credit_id; i++) {
    const [rows] = await db.query<any[]>(`SELECT * FROM credits WHERE id = ?`, [current.refinanced_from_credit_id]);
    const parent = (rows as any[])[0];
    if (!parent) break;
    current = parent;
  }
  return current;
}

/** Cálculo de la refinanciación. `credit` es la fila de `credits` (en la transacción, ya bloqueada). */
export async function computeRefinanceQuote(db: PoolLike, credit: any, termValue: number): Promise<RefinanceQuote> {
  const [rows] = await db.query<any[]>(
    `SELECT installment_number, status, principal_due, interest_due, principal_paid, interest_paid
     FROM credit_schedule_installments WHERE credit_id = ? AND status <> 'ANULADA'
     ORDER BY installment_number ASC`,
    [credit.id]
  );
  const installments = rows as any[];
  const pending = installments.filter((i) => i.status !== "PAGADA");
  const paid = installments.filter((i) => i.status === "PAGADA");
  const sum = (list: any[], f: (i: any) => number) => round2(list.reduce((s, i) => s + f(i), 0));

  const pendingPrincipal = sum(pending, (i) => Number(i.principal_due) - Number(i.principal_paid));
  const pendingInterest = sum(pending, (i) => Number(i.interest_due) - Number(i.interest_paid));
  const paidPrincipal = sum(installments, (i) => Number(i.principal_paid));
  const paidInterest = sum(installments, (i) => Number(i.interest_paid));

  const root = await rootCredit(db, credit);
  const originalMonthlyInterest = round2(Number(root.disbursed_amount) * (Number(root.interest_rate) / 100));
  const rule = await loadRefinanceRule(db);
  const additionalInterest = rule.chargeOriginalInterestOnPending ? round2(originalMonthlyInterest * pending.length) : 0;

  const inheritedPrincipal = pendingPrincipal;
  const inheritedInterest = round2(pendingInterest + additionalInterest);
  const total = round2(inheritedPrincipal + inheritedInterest);

  const [chargeRows] = await db.query<any[]>(
    `SELECT COALESCE(SUM(amount - paid_amount), 0) AS pending FROM credit_adjustments
     WHERE credit_id = ? AND type IN ('GASTO_NOTIFICACION','OTRO','INTERES_MORA') AND amount > paid_amount`,
    [credit.id]
  );

  const schedule = previewSchedule(inheritedPrincipal, inheritedInterest, termValue, new Date(), await loadInstallmentRounding(db));
  return {
    creditId: credit.id,
    rootCreditId: root.id,
    termValue,
    installmentsTotal: installments.length,
    lastPaidInstallment: paid.length ? Math.max(...paid.map((i) => Number(i.installment_number))) : null,
    pendingInstallments: pending.length,
    pendingPrincipal,
    pendingInterest,
    pendingTotal: round2(pendingPrincipal + pendingInterest),
    paidPrincipal,
    paidInterest,
    originalMonthlyInterest,
    additionalInterest,
    inheritedPrincipal,
    inheritedInterest,
    total,
    installment: schedule[0]?.totalDue ?? 0,
    pendingCharges: round2(Number((chargeRows as any[])[0].pending)),
    rule
  };
}

export function previewSchedule(principal: number, totalInterest: number, termValue: number, firstInstallmentDate: Date, roundTo: number): ScheduleRow[] {
  return buildAmortizationSchedule({ principal, monthlyRatePercent: 0, totalInterest, termMonths: termValue, firstInstallmentDate, roundTo });
}

export function assertRefinanceable(credit: any, quote: RefinanceQuote) {
  if (!["VIGENTE", "EN_MORA"].includes(credit.status)) {
    throw new HttpError(409, "Solo se pueden refinanciar créditos vigentes o en mora");
  }
  if (quote.pendingInstallments === 0 || quote.total <= 0) throw new HttpError(409, "El crédito no tiene cuotas pendientes para refinanciar");
  if (quote.pendingCharges > 0) {
    throw new HttpError(
      409,
      `El crédito tiene cargos sin pagar (mora o gastos) por ${quote.pendingCharges}. Regístrelos con un pago antes de refinanciar.`
    );
  }
}
