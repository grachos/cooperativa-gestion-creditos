import type { PoolConnection, PoolLike } from "../../db/pool.js";
import { HttpError } from "../../middlewares/error.middleware.js";
import { round2 } from "../../utils/money.js";
import { calculateLateFee, calculateOverdueDays, lateFeeBase, loadDelinquencyPolicy } from "../delinquency/delinquency.service.js";
import { recordAudit } from "../audit/audit.service.js";

/**
 * Mora, gasto de notificación y descuento por pago anticipado (reunión 2026-10-16, Fase 5).
 * Todo sale de parámetros (politica_mora, gasto_notificacion, descuento_pago_anticipado) y se SUGIERE:
 * el sistema calcula, y quien tiene permiso de ajustes decide cuánto cobrar al registrar el pago.
 */

const OPEN_INSTALLMENT_STATUSES = `('PENDIENTE','PARCIAL','VENCIDA','EN_MORA')`;

export interface MoraItem {
  installmentId: number;
  installmentNumber: number;
  overdueDays: number;
  base: number;
  accrued: number;
  charged: number;
  pending: number;
}

export interface NotificationRule {
  enabled: boolean;
  amount: number;
  firstAfterOverdueDays: number;
  repeatEveryOverdueDays: number;
}

export interface PayoffRule {
  enabled: boolean;
  percentOfFutureInterest: number;
}

async function loadParam(db: PoolLike, key: string): Promise<Record<string, unknown> | null> {
  const [rows] = await db.query<any[]>(`SELECT value FROM parameters WHERE \`key\` = ?`, [key]);
  const value = (rows as any[])[0]?.value;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);

export async function loadNotificationRule(db: PoolLike): Promise<NotificationRule> {
  const p = await loadParam(db, "gasto_notificacion");
  return {
    enabled: p?.enabled !== false && p !== null,
    amount: num(p?.amount, 0),
    firstAfterOverdueDays: num(p?.firstAfterOverdueDays, 30),
    repeatEveryOverdueDays: num(p?.repeatEveryOverdueDays, 0)
  };
}

export async function loadPayoffRule(db: PoolLike): Promise<PayoffRule> {
  const p = await loadParam(db, "descuento_pago_anticipado");
  return { enabled: p?.enabled !== false && p !== null, percentOfFutureInterest: Math.min(100, num(p?.percentOfFutureInterest, 0)) };
}

async function openInstallments(db: PoolLike, creditId: number) {
  const [rows] = await db.query<any[]>(
    `SELECT id, installment_number, due_date, principal_due, interest_due, principal_paid, interest_paid
     FROM credit_schedule_installments
     WHERE credit_id = ? AND status IN ${OPEN_INSTALLMENT_STATUSES}
     ORDER BY installment_number ASC`,
    [creditId]
  );
  return (rows as any[]).map((r) => ({
    id: r.id as number,
    number: r.installment_number as number,
    dueDate: String(r.due_date),
    principalOut: round2(Number(r.principal_due) - Number(r.principal_paid)),
    interestOut: round2(Number(r.interest_due) - Number(r.interest_paid))
  }));
}

/** Mora que corresponde hoy por cada cuota vencida, menos lo que ya se cobró por esa cuota. */
export async function computeMoraQuote(db: PoolLike, creditId: number, asOf: Date) {
  const policy = await loadDelinquencyPolicy(db);
  const installments = await openInstallments(db, creditId);
  const [chargedRows] = await db.query<any[]>(
    `SELECT installment_id, SUM(amount) AS charged FROM credit_adjustments
     WHERE credit_id = ? AND type = 'INTERES_MORA' AND installment_id IS NOT NULL GROUP BY installment_id`,
    [creditId]
  );
  const charged = new Map((chargedRows as any[]).map((r) => [r.installment_id as number, Number(r.charged)]));

  const items: MoraItem[] = [];
  let maxOverdueDays = 0;
  for (const inst of installments) {
    const overdueDays = calculateOverdueDays(new Date(inst.dueDate), asOf);
    if (overdueDays <= 0) continue;
    maxOverdueDays = Math.max(maxOverdueDays, overdueDays);
    // En modo AUTOMATICO la mora ya se cobra sola al aplicar el pago: no hay nada que sugerir.
    if (policy.mode === "AUTOMATICO") continue;
    const base = lateFeeBase(policy, inst.principalOut, inst.interestOut);
    const accrued = calculateLateFee({ policy, overdueDays, principalOrInstallmentBase: base }).result;
    const already = round2(charged.get(inst.id) ?? 0);
    const pending = Math.max(0, round2(accrued - already));
    items.push({ installmentId: inst.id, installmentNumber: inst.number, overdueDays, base, accrued, charged: already, pending });
  }
  const suggested = round2(items.reduce((s, i) => s + i.pending, 0));
  return {
    mode: policy.mode,
    rateOrValue: policy.rateOrValue,
    rateType: policy.rateType,
    graceDays: policy.graceDays,
    base: policy.base,
    maxOverdueDays,
    items: items.filter((i) => i.accrued > 0 || i.pending > 0),
    suggested
  };
}

/** Gasto de notificación: se sugiere cuando la mora alcanza el umbral y aún no se ha cobrado el que toca. */
export async function computeNotificationQuote(db: PoolLike, creditId: number, maxOverdueDays: number) {
  const rule = await loadNotificationRule(db);
  const [rows] = await db.query<any[]>(
    `SELECT COUNT(*) AS n FROM credit_adjustments WHERE credit_id = ? AND type = 'GASTO_NOTIFICACION'`,
    [creditId]
  );
  const chargedCount = Number((rows as any[])[0].n);
  let expected = 0;
  if (rule.enabled && rule.amount > 0 && maxOverdueDays >= rule.firstAfterOverdueDays) {
    expected =
      rule.repeatEveryOverdueDays > 0
        ? Math.floor((maxOverdueDays - rule.firstAfterOverdueDays) / rule.repeatEveryOverdueDays) + 1
        : 1;
  }
  const due = expected > chargedCount;
  return { enabled: rule.enabled, amount: rule.amount, suggested: due ? rule.amount : 0, chargedCount, expectedCount: expected };
}

/** Cargos aprobados que siguen sin pagarse (gastos y mora ya cobrados). */
async function unpaidCharges(db: PoolLike, creditId: number): Promise<number> {
  const [rows] = await db.query<any[]>(
    `SELECT COALESCE(SUM(amount - paid_amount), 0) AS pending FROM credit_adjustments
     WHERE credit_id = ? AND type IN ('GASTO_NOTIFICACION','OTRO','INTERES_MORA') AND amount > paid_amount`,
    [creditId]
  );
  return round2(Number((rows as any[])[0].pending));
}

/**
 * Cancelación anticipada: lo que falta de capital e interés, y el descuento sobre el interés de las
 * cuotas que todavía no vencen (due_date posterior a la fecha de pago).
 */
export async function computePayoffQuote(db: PoolLike, creditId: number, asOf: Date, discountPercent?: number) {
  const rule = await loadPayoffRule(db);
  const installments = await openInstallments(db, creditId);
  let principal = 0;
  let interest = 0;
  let futureInterest = 0;
  const futureIds: Array<{ id: number; interestOut: number }> = [];
  for (const inst of installments) {
    principal += inst.principalOut;
    interest += inst.interestOut;
    if (new Date(inst.dueDate).getTime() > asOf.getTime()) {
      futureInterest += inst.interestOut;
      futureIds.push({ id: inst.id, interestOut: inst.interestOut });
    }
  }
  principal = round2(principal);
  interest = round2(interest);
  futureInterest = round2(futureInterest);
  const percent = discountPercent ?? (rule.enabled ? rule.percentOfFutureInterest : 0);
  const cuts = futureIds.map((f) => ({ id: f.id, cut: round2((f.interestOut * percent) / 100) }));
  const discount = round2(cuts.reduce((s, c) => s + c.cut, 0));
  const charges = await unpaidCharges(db, creditId);
  return {
    enabled: rule.enabled,
    defaultPercent: rule.enabled ? rule.percentOfFutureInterest : 0,
    percent,
    outstandingPrincipal: principal,
    outstandingInterest: interest,
    futureInterest,
    discount,
    pendingCharges: charges,
    total: round2(principal + interest - discount + charges),
    cuts
  };
}

export interface ChargeRequest {
  moraAmount?: number;
  notificationAmount?: number;
  reason?: string;
}

/**
 * Registra como ajustes los cargos que el usuario decidió cobrar (mora y/o gasto de notificación).
 * Debe llamarse dentro de la transacción del pago, ya con el crédito bloqueado, y ANTES de aplicar el
 * pago, para que el mismo pago los cubra. El llamador verifica el permiso de ajustes.
 */
export async function applyCharges(
  conn: PoolConnection,
  creditId: number,
  userId: number,
  ip: string | undefined,
  request: ChargeRequest,
  asOf: Date
): Promise<number> {
  const moraAmount = round2(request.moraAmount ?? 0);
  const notificationAmount = round2(request.notificationAmount ?? 0);
  if (moraAmount <= 0 && notificationAmount <= 0) return 0;
  let total = 0;

  const mora = await computeMoraQuote(conn, creditId, asOf);
  if (moraAmount > 0) {
    if (moraAmount > mora.suggested + 0.01) {
      throw new HttpError(400, `La mora a cobrar (${moraAmount}) supera la calculada (${mora.suggested})`);
    }
    // Se reparte de la cuota más antigua a la más reciente, sin pasar de lo calculado en cada una.
    let left = moraAmount;
    for (const item of mora.items) {
      if (left <= 0) break;
      const part = round2(Math.min(left, item.pending));
      if (part <= 0) continue;
      left = round2(left - part);
      const reason = request.reason?.trim() || `Mora cuota ${item.installmentNumber} (${item.overdueDays} días de atraso)`;
      const [res] = await conn.query<any>(
        `INSERT INTO credit_adjustments (credit_id, installment_id, type, amount, reason, approved_by)
         VALUES (?, ?, 'INTERES_MORA', ?, ?, ?)`,
        [creditId, item.installmentId, part, reason.slice(0, 255), userId]
      );
      await recordAudit(conn, {
        entity: "credit_adjustment",
        entityId: res.insertId,
        action: "CREATE",
        newValue: { type: "INTERES_MORA", installmentId: item.installmentId, amount: part, suggested: item.pending },
        userId,
        ipAddress: ip,
        reason
      });
    }
    total = round2(total + moraAmount);
  }

  if (notificationAmount > 0) {
    const notification = await computeNotificationQuote(conn, creditId, mora.maxOverdueDays);
    if (notification.suggested <= 0) throw new HttpError(400, "Por ahora no corresponde cobrar gasto de notificación");
    if (notificationAmount > notification.amount + 0.01) {
      throw new HttpError(400, `El gasto de notificación no puede superar ${notification.amount}`);
    }
    const reason = request.reason?.trim() || `Gasto de notificación (${mora.maxOverdueDays} días de mora)`;
    const [res] = await conn.query<any>(
      `INSERT INTO credit_adjustments (credit_id, installment_id, type, amount, reason, approved_by)
       VALUES (?, NULL, 'GASTO_NOTIFICACION', ?, ?, ?)`,
      [creditId, notificationAmount, reason.slice(0, 255), userId]
    );
    await recordAudit(conn, {
      entity: "credit_adjustment",
      entityId: res.insertId,
      action: "CREATE",
      newValue: { type: "GASTO_NOTIFICACION", amount: notificationAmount },
      userId,
      ipAddress: ip,
      reason
    });
    total = round2(total + notificationAmount);
  }
  return total;
}
