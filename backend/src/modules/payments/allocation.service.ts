import type { PoolConnection } from "../../db/pool.js";
import { round2 } from "../../utils/money.js";
import {
  calculateOverdueDays,
  calculateLateFee,
  getMoraBucket,
  DEFAULT_DELINQUENCY_POLICY
} from "../delinquency/delinquency.service.js";

export interface AllocationLine {
  concept: "GASTOS" | "MORA" | "INTERES" | "CAPITAL";
  amount: number;
  installmentId?: number;
  adjustmentId?: number;
}

/**
 * Orden de imputación real: gastos pendientes (ajustes tipo GASTO_NOTIFICACION
 * u OTRO), luego mora, interés y capital de la cuota más antigua. Se
 * confirmó contra el histórico de observaciones de pago de la cooperativa:
 * "SALDA $91.800 CUOTA 4 + $100.000 DE GASTOS DE NOTIFICACIÓN" — el gasto se
 * cobra junto con la cuota, no después del capital. Antes, el esquema tenía
 * el concepto GASTOS en `payment_allocations` pero nunca se usaba.
 * Configurable a futuro vía tabla `parameters` (pendiente de confirmación).
 */
const INSTALLMENT_ALLOCATION_ORDER: Array<"MORA" | "INTERES" | "CAPITAL"> = ["MORA", "INTERES", "CAPITAL"];

async function allocateOutstandingGastos(
  conn: PoolConnection,
  creditId: number,
  remaining: number,
  lines: AllocationLine[]
): Promise<number> {
  const [adjustments] = await conn.query<any[]>(
    `SELECT * FROM credit_adjustments
     WHERE credit_id = ? AND type IN ('GASTO_NOTIFICACION','OTRO') AND amount > paid_amount
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
    lines.push({ concept: "GASTOS", amount: applied, adjustmentId: adj.id });
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
  const lines: AllocationLine[] = [];
  let remaining = await allocateOutstandingGastos(conn, creditId, amount, lines);

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
    const { result: lateFeeDue } = calculateLateFee({
      policy: DEFAULT_DELINQUENCY_POLICY,
      overdueDays,
      principalOrInstallmentBase: outstandingPrincipal
    });
    const outstandingLateFee = Math.max(0, round2(lateFeeDue - inst.late_fee_paid));

    const outstanding: Record<string, number> = {
      MORA: outstandingLateFee,
      INTERES: outstandingInterest,
      CAPITAL: outstandingPrincipal
    };

    let principalPaid = 0;
    let interestPaid = 0;
    let lateFeePaid = 0;

    for (const concept of INSTALLMENT_ALLOCATION_ORDER) {
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
    else if (overdueDays > 0) status = getMoraBucket(overdueDays).code === "CD001" ? "VENCIDA" : "EN_MORA";

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

  return lines;
}
