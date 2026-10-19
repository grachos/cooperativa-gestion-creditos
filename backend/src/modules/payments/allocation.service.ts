import type { PoolConnection } from "../../db/pool.js";
import { round2 } from "../../utils/money.js";
import { calculateOverdueDays, calculateLateFee, lateFeeBase, getMoraBucket, loadDelinquencyPolicy, loadMoraBuckets } from "../delinquency/delinquency.service.js";

export interface AllocationLine {
  concept: "GASTOS" | "MORA" | "INTERES" | "CAPITAL";
  amount: number;
  installmentId?: number;
  adjustmentId?: number;
}

type AllocationConcept = "GASTOS" | "MORA" | "INTERES" | "CAPITAL";

/**
 * Orden de imputación real: gastos pendientes (ajustes tipo GASTO_NOTIFICACION
 * u OTRO), luego mora, interés y capital de la cuota más antigua. Se
 * confirmó contra el histórico de observaciones de pago de la cooperativa:
 * "SALDA $91.800 CUOTA 4 + $100.000 DE GASTOS DE NOTIFICACIÓN" — el gasto se
 * cobra junto con la cuota, no después del capital. Ahora configurable vía
 * el parámetro `orden_aplicacion_pago`. GASTOS es un cargo a nivel de
 * crédito (no de una cuota puntual), así que su posición en el arreglo solo
 * determina si se aplica ANTES o DESPUÉS del barrido de cuotas — MORA,
 * INTERES y CAPITAL sí se aplican en el orden exacto indicado dentro de
 * cada cuota.
 */
const DEFAULT_ALLOCATION_ORDER: AllocationConcept[] = ["GASTOS", "MORA", "INTERES", "CAPITAL"];

async function loadAllocationOrder(conn: PoolConnection): Promise<AllocationConcept[]> {
  const [rows] = await conn.query<any[]>(`SELECT value FROM parameters WHERE \`key\` = 'orden_aplicacion_pago'`);
  const value = (rows as any[])[0]?.value;
  const isValid =
    Array.isArray(value) &&
    value.length === DEFAULT_ALLOCATION_ORDER.length &&
    DEFAULT_ALLOCATION_ORDER.every((c) => value.includes(c));
  return isValid ? (value as AllocationConcept[]) : DEFAULT_ALLOCATION_ORDER;
}

async function allocateOutstandingGastos(
  conn: PoolConnection,
  creditId: number,
  remaining: number,
  lines: AllocationLine[]
): Promise<number> {
  const [adjustments] = await conn.query<any[]>(
    `SELECT * FROM credit_adjustments
     WHERE credit_id = ? AND type IN ('GASTO_NOTIFICACION','OTRO','INTERES_MORA') AND amount > paid_amount
     ORDER BY created_at ASC`,
    [creditId]
  );

  for (const adj of adjustments as any[]) {
    if (remaining <= 0) break;
    const outstanding = round2(Number(adj.amount) - Number(adj.paid_amount));
    if (outstanding <= 0) continue;
    const applied = round2(Math.min(outstanding, remaining));
    if (applied <= 0) continue;

    remaining = round2(remaining - applied);
    // La mora cobrada (ajuste INTERES_MORA) se muestra como MORA; el resto de cargos como GASTOS.
    lines.push({ concept: adj.type === "INTERES_MORA" ? "MORA" : "GASTOS", amount: applied, adjustmentId: adj.id });
    await conn.query(`UPDATE credit_adjustments SET paid_amount = paid_amount + ? WHERE id = ?`, [applied, adj.id]);
  }

  return remaining;
}

export async function allocatePayment(
  conn: PoolConnection,
  creditId: number,
  amount: number,
  asOf: Date
): Promise<AllocationLine[]> {
  const [order, policy, buckets] = await Promise.all([
    loadAllocationOrder(conn),
    loadDelinquencyPolicy(conn),
    loadMoraBuckets(conn)
  ]);
  const installmentOrder = order.filter((c): c is "MORA" | "INTERES" | "CAPITAL" => c !== "GASTOS");
  const gastosIndex = order.indexOf("GASTOS");
  const firstInstallmentIndex = Math.min(...installmentOrder.map((c) => order.indexOf(c)));
  const gastosFirst = gastosIndex === -1 || gastosIndex < firstInstallmentIndex;

  const lines: AllocationLine[] = [];
  let remaining = amount;
  if (gastosFirst) {
    remaining = await allocateOutstandingGastos(conn, creditId, remaining, lines);
  }

  const [installments] = await conn.query<any[]>(
    `SELECT * FROM credit_schedule_installments
     WHERE credit_id = ? AND status IN ('PENDIENTE','PARCIAL','VENCIDA','EN_MORA')
     ORDER BY installment_number ASC`,
    [creditId]
  );

  for (const raw of installments as any[]) {
    if (remaining <= 0) break;

    // pg (y antes mysql2) devuelve las columnas DECIMAL como string; se
    // convierten a número antes de cualquier operación aritmética para
    // evitar concatenaciones.
    const inst = {
      ...raw,
      principal_due: Number(raw.principal_due),
      interest_due: Number(raw.interest_due),
      principal_paid: Number(raw.principal_paid),
      interest_paid: Number(raw.interest_paid),
      late_fee_paid: Number(raw.late_fee_paid)
    };

    const dueDate = new Date(inst.due_date);
    const overdueDays = calculateOverdueDays(dueDate, asOf);
    const outstandingPrincipal = round2(inst.principal_due - inst.principal_paid);
    const outstandingInterest = round2(inst.interest_due - inst.interest_paid);
    // Modo SUGERIDO: la mora no se cobra sola; entra como ajuste INTERES_MORA decidido al registrar el pago.
    const { result: lateFeeDue } =
      policy.mode === "AUTOMATICO"
        ? calculateLateFee({
            policy,
            overdueDays,
            principalOrInstallmentBase: lateFeeBase(policy, outstandingPrincipal, outstandingInterest)
          })
        : { result: 0 };
    const outstandingLateFee = Math.max(0, round2(lateFeeDue - inst.late_fee_paid));

    const outstanding: Record<string, number> = {
      MORA: outstandingLateFee,
      INTERES: outstandingInterest,
      CAPITAL: outstandingPrincipal
    };

    let principalPaid = 0;
    let interestPaid = 0;
    let lateFeePaid = 0;

    for (const concept of installmentOrder) {
      if (remaining <= 0) break;
      const due = outstanding[concept] ?? 0;
      if (due <= 0) continue;
      const applied = round2(Math.min(due, remaining));
      if (applied <= 0) continue;
      remaining = round2(remaining - applied);
      lines.push({ installmentId: inst.id, concept, amount: applied });
      if (concept === "CAPITAL") principalPaid = applied;
      if (concept === "INTERES") interestPaid = applied;
      if (concept === "MORA") lateFeePaid = applied;
    }

    const newPrincipalPaid = round2(inst.principal_paid + principalPaid);
    const newInterestPaid = round2(inst.interest_paid + interestPaid);
    const newLateFeePaid = round2(inst.late_fee_paid + lateFeePaid);
    const totalOutstanding = round2(
      inst.principal_due - newPrincipalPaid + (inst.interest_due - newInterestPaid)
    );

    // VENCIDA: atrasada pero aún dentro del primer bucket de mora (< 30 días,
    // código CD001 en el Excel real). EN_MORA: ya entró a un bucket CM030+.
    let status = inst.status;
    if (totalOutstanding <= 0) status = "PAGADA";
    else if (newPrincipalPaid > 0 || newInterestPaid > 0 || newLateFeePaid > 0) status = "PARCIAL";
    else if (overdueDays > 0) status = getMoraBucket(overdueDays, buckets).code === "CD001" ? "VENCIDA" : "EN_MORA";

    await conn.query(
      `UPDATE credit_schedule_installments
       SET principal_paid = ?, interest_paid = ?, late_fee_paid = ?, balance = ?, overdue_days = ?, status = ?
       WHERE id = ?`,
      [
        newPrincipalPaid,
        newInterestPaid,
        newLateFeePaid,
        Math.max(totalOutstanding, 0),
        overdueDays,
        status,
        inst.id
      ]
    );
  }

  if (!gastosFirst) {
    await allocateOutstandingGastos(conn, creditId, remaining, lines);
  }

  return lines;
}

/**
 * Recalcula saldo y estado de las cuotas indicadas a partir de lo que tienen pagado (usado al reversar un pago).
 * Misma regla que al aplicar un pago: sin saldo => PAGADA; con algún abono => PARCIAL; sin abonos => según el
 * atraso (VENCIDA / EN_MORA por los rangos de mora) o PENDIENTE si aún no vence. Las anuladas no se tocan.
 */
export async function refreshInstallments(conn: PoolConnection, installmentIds: number[], asOf: Date): Promise<void> {
  if (installmentIds.length === 0) return;
  const buckets = await loadMoraBuckets(conn);
  const [rows] = await conn.query<any[]>(
    `SELECT id, due_date, status, principal_due, interest_due, principal_paid, interest_paid, late_fee_paid
     FROM credit_schedule_installments WHERE id IN (?) AND status <> 'ANULADA'`,
    [installmentIds]
  );
  for (const r of rows as any[]) {
    const principalPaid = Number(r.principal_paid);
    const interestPaid = Number(r.interest_paid);
    const lateFeePaid = Number(r.late_fee_paid);
    const outstanding = Math.max(0, round2(Number(r.principal_due) - principalPaid + (Number(r.interest_due) - interestPaid)));
    const overdueDays = calculateOverdueDays(new Date(r.due_date), asOf);
    let status: string;
    if (outstanding <= 0) status = "PAGADA";
    else if (principalPaid > 0 || interestPaid > 0 || lateFeePaid > 0) status = "PARCIAL";
    else if (overdueDays > 0) status = getMoraBucket(overdueDays, buckets).code === "CD001" ? "VENCIDA" : "EN_MORA";
    else status = "PENDIENTE";
    await conn.query(`UPDATE credit_schedule_installments SET balance = ?, status = ?, overdue_days = ? WHERE id = ?`, [
      outstanding,
      status,
      overdueDays,
      r.id
    ]);
  }
}

/** Tras un reverso: saldo de capital desde las cuotas y estado del crédito (PAGADO vuelve a VIGENTE o EN_MORA). */
export async function refreshCreditAfterReversal(conn: PoolConnection, creditId: number): Promise<void> {
  const [rows] = await conn.query<any[]>(
    `SELECT COALESCE(SUM(principal_due - principal_paid), 0) AS remaining,
            SUM(CASE WHEN status NOT IN ('PAGADA','ANULADA') THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'EN_MORA' THEN 1 ELSE 0 END) AS in_arrears
     FROM credit_schedule_installments WHERE credit_id = ? AND status <> 'ANULADA'`,
    [creditId]
  );
  const r = (rows as any[])[0];
  const pending = Number(r.pending ?? 0);
  await conn.query(
    `UPDATE credits
     SET principal_balance = ?,
         status = CASE
           WHEN status IN ('REFINANCIADO','ANULADO') THEN status
           WHEN ? = 0 THEN 'PAGADO'
           WHEN ? > 0 THEN 'EN_MORA'
           ELSE 'VIGENTE'
         END
     WHERE id = ?`,
    [round2(Number(r.remaining)), pending, Number(r.in_arrears ?? 0), creditId]
  );
}
