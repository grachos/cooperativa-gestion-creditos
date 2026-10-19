import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction, type PoolConnection } from "../../db/pool.js";
import { earlyPayoffSchema, paymentSchema, reversalSchema, idParam } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAnyPermission, requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { allocatePayment, refreshCreditAfterReversal, refreshInstallments } from "./allocation.service.js";
import { round2 } from "../../utils/money.js";
import { applyCharges, computeMoraQuote, computeNotificationQuote, computePayoffQuote } from "./charges.service.js";
import { recordAudit } from "../audit/audit.service.js";
import { enqueueIntegrationEvent } from "../integration/integration.service.js";
import { broadcastEvent } from "../alerts/sse.hub.js";
import { invalidateReportCache } from "../reports/reportCache.js";
import { completeIdempotencyInTransaction, idempotent } from "../../middlewares/idempotent.js";

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

interface NewPayment {
  creditId: number;
  receivedDate: string;
  effectiveDate?: string | null;
  amount: number;
  paymentMethod: string;
  reference?: string | null;
  notes?: string | null;
  verified?: boolean;
}

/**
 * Inserta el pago, lo aplica a las cuotas y actualiza el crédito. DEBE llamarse dentro de una transacción
 * que ya tiene el crédito bloqueado (`SELECT … FOR UPDATE` como primera sentencia).
 */
async function recordPayment(
  conn: PoolConnection,
  credit: { id: number; status: string },
  userId: number,
  ip: string | undefined,
  data: NewPayment,
  earlyPayoff = false
) {
  const [paymentResult] = await conn.query<any>(
    `INSERT INTO payments (credit_id, received_date, effective_date, amount, payment_method, reference, notes, created_by, verified, verified_by, verified_at, early_payoff)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${data.verified ? "NOW()" : "NULL"}, ?)`,
    [
      data.creditId,
      data.receivedDate,
      data.effectiveDate ?? data.receivedDate,
      data.amount,
      data.paymentMethod,
      data.reference ?? null,
      data.notes ?? null,
      userId,
      data.verified ? 1 : 0,
      data.verified ? userId : null,
      earlyPayoff ? 1 : 0
    ]
  );
  const paymentId = paymentResult.insertId;

  const asOf = new Date(data.effectiveDate ?? data.receivedDate);
  const allocations = await allocatePayment(conn, data.creditId, data.amount, asOf);

  // Todo el dinero recibido debe quedar aplicado: si sobra, el pago supera lo adeudado y se rechaza (rollback),
  // en vez de guardar un monto que no se refleja en ninguna cuota ni cargo (hallazgo H4).
  const applied = round2(allocations.reduce((sum, line) => sum + line.amount, 0));
  if (applied < round2(data.amount) - 0.005) {
    throw new HttpError(
      409,
      applied > 0
        ? `El pago supera lo adeudado. El máximo que se puede registrar hoy es ${applied}.`
        : "El crédito no tiene saldo pendiente para aplicar este pago."
    );
  }

  for (const line of allocations) {
    await conn.query(
      `INSERT INTO payment_allocations (payment_id, installment_id, adjustment_id, concept, amount) VALUES (?, ?, ?, ?, ?)`,
      [paymentId, line.installmentId ?? null, line.adjustmentId ?? null, line.concept, line.amount]
    );
  }

  const [pendingRows] = await conn.query<any[]>(
    `SELECT COUNT(*) as pending FROM credit_schedule_installments
     WHERE credit_id = ? AND status NOT IN ('PAGADA','ANULADA')`,
    [data.creditId]
  );
  const pending = (pendingRows as any[])[0].pending;

  const [balanceRows] = await conn.query<any[]>(
    `SELECT SUM(principal_due - principal_paid) as remaining FROM credit_schedule_installments WHERE credit_id = ?`,
    [data.creditId]
  );
  const remainingPrincipal = Number((balanceRows as any[])[0].remaining ?? 0);

  const newCreditStatus = pending === 0 ? "PAGADO" : credit.status;
  await conn.query(`UPDATE credits SET principal_balance = ?, status = ? WHERE id = ?`, [
    remainingPrincipal,
    newCreditStatus,
    data.creditId
  ]);

  await recordAudit(conn, {
    entity: "payment",
    entityId: paymentId,
    action: earlyPayoff ? "EARLY_PAYOFF" : "CREATE",
    newValue: { ...data, allocations },
    userId,
    ipAddress: ip
  });

  await enqueueIntegrationEvent(conn, "PAYMENT_REGISTERED", {
    paymentId,
    creditId: data.creditId,
    amount: data.amount
  });

  return { paymentId, allocations, creditStatus: newCreditStatus };
}

/** Bloquea el crédito (PRIMERA sentencia de la transacción) y verifica que admita pagos. */
async function lockCreditForPayment(conn: PoolConnection, creditId: number) {
  // Los pagos al mismo crédito se aplican de a uno. Sin esto, dos pagos simultáneos leían las mismas
  // cuotas y el último en escribir pisaba al otro (abonos perdidos o duplicados) o chocaban en un
  // deadlock (500). La lectura de las cuotas ocurre DESPUÉS del bloqueo, así que ve el pago anterior.
  const [creditRows] = await conn.query<any[]>(`SELECT * FROM credits WHERE id = ? FOR UPDATE`, [creditId]);
  const credit = (creditRows as any[])[0];
  if (!credit) throw new HttpError(404, "Crédito no encontrado");
  // Solo créditos vigentes o en mora: un crédito REFINANCIADO tiene sus cuotas anuladas y el pago quedaba
  // guardado sin aplicarse a nada (hallazgo H3).
  if (!["VIGENTE", "EN_MORA"].includes(credit.status)) {
    throw new HttpError(409, "El crédito no admite pagos en su estado actual");
  }
  return credit as { id: number; status: string };
}

const canNegotiate = (req: { user?: { permissions: string[] } }) => Boolean(req.user?.permissions.includes("adjustments:write"));

paymentsRouter.post(
  "/",
  requirePermission("payments:write"),
  idempotent("payments.create", { transactional: true }),
  asyncHandler(async (req, res) => {
    const data = paymentSchema.parse(req.body);
    const wantsCharges = (data.moraAmount ?? 0) > 0 || (data.notificationAmount ?? 0) > 0;
    // Cobrar mora o gasto de notificación (o decidir no cobrarlos) es una decisión de quien tiene permiso de ajustes.
    if (wantsCharges && !canNegotiate(req)) {
      throw new HttpError(403, "Cobrar mora o gastos requiere el permiso de ajustes");
    }

    const result = await withTransaction(async (conn) => {
      const credit = await lockCreditForPayment(conn, data.creditId);
      if (wantsCharges) {
        await applyCharges(
          conn,
          data.creditId,
          req.user!.id,
          req.ip,
          { moraAmount: data.moraAmount, notificationAmount: data.notificationAmount, reason: data.chargeReason ?? undefined },
          new Date(data.effectiveDate ?? data.receivedDate)
        );
      }
      const payment = await recordPayment(conn, credit, req.user!.id, req.ip, data);
      await completeIdempotencyInTransaction(conn, res, 201, payment);
      return payment;
    });

    invalidateReportCache();
    broadcastEvent("payment.registered", { creditId: data.creditId, paymentId: result.paymentId });
    res.status(201).json(result);
  })
);

/**
 * Lo que el sistema sugiere cobrar en un pago a esta fecha: mora, gasto de notificación y cancelación
 * anticipada con su descuento. Solo lectura. Quien no tiene permiso de ajustes la ve, pero no decide.
 */
paymentsRouter.get(
  "/quote",
  requireAnyPermission("payments:write", "adjustments:write"),
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        creditId: z.coerce.number().int().positive(),
        date: z.string().date().optional(),
        discountPercent: z.coerce.number().min(0).max(100).optional()
      })
      .parse(req.query);
    const asOfDate = query.date ?? new Date().toISOString().slice(0, 10);
    const asOf = new Date(asOfDate);
    const [creditRows] = await pool.query<any[]>(`SELECT id, status FROM credits WHERE id = ?`, [query.creditId]);
    const credit = (creditRows as any[])[0];
    if (!credit) throw new HttpError(404, "Crédito no encontrado");

    const negotiate = canNegotiate(req);
    const mora = await computeMoraQuote(pool, query.creditId, asOf);
    const notification = await computeNotificationQuote(pool, query.creditId, mora.maxOverdueDays);
    // Sin permiso de ajustes no hay descuento: se muestra lo que se pagaría sin él.
    const payoffRaw = await computePayoffQuote(pool, query.creditId, asOf, negotiate ? query.discountPercent : 0);
    const { cuts: _cuts, ...payoff } = payoffRaw;
    res.json({ asOf: asOfDate, canNegotiate: negotiate, creditStatus: credit.status, mora, notification, payoff });
  })
);

paymentsRouter.post(
  "/early-payoff",
  requirePermission("payments:payoff"),
  idempotent("payments.early-payoff", { transactional: true }),
  asyncHandler(async (req, res) => {
    const data = earlyPayoffSchema.parse(req.body);
    const negotiate = canNegotiate(req);
    const wantsCharges = (data.moraAmount ?? 0) > 0 || (data.notificationAmount ?? 0) > 0;
    if ((wantsCharges || data.discountPercent !== undefined) && !negotiate) {
      throw new HttpError(403, "Cobrar mora o gastos, o fijar el descuento, requiere el permiso de ajustes");
    }
    const asOf = new Date(data.receivedDate);

    const result = await withTransaction(async (conn) => {
      const credit = await lockCreditForPayment(conn, data.creditId);
      if (wantsCharges) {
        await applyCharges(
          conn,
          data.creditId,
          req.user!.id,
          req.ip,
          { moraAmount: data.moraAmount, notificationAmount: data.notificationAmount, reason: data.chargeReason ?? undefined },
          asOf
        );
      }

      const quote = await computePayoffQuote(conn, data.creditId, asOf, negotiate ? data.discountPercent : 0);
      if (Math.abs(quote.total - data.expectedTotal) > 0.5) {
        throw new HttpError(409, `El total para cancelar cambió a ${quote.total}. Revise el valor y confirme de nuevo.`);
      }
      if (quote.total <= 0) throw new HttpError(409, "No hay saldo por cancelar");

      // El descuento reduce el interés de las cuotas que aún no vencen y queda registrado como ajuste.
      for (const cut of quote.cuts) {
        if (cut.cut <= 0) continue;
        await conn.query(
          `UPDATE credit_schedule_installments
           SET interest_due = interest_due - ?, total_due = total_due - ?, balance = GREATEST(balance - ?, 0)
           WHERE id = ?`,
          [cut.cut, cut.cut, cut.cut, cut.id]
        );
      }
      if (quote.discount > 0) {
        const reason = `Descuento por pago anticipado: ${quote.percent}% del interés de las cuotas no vencidas`;
        const [adj] = await conn.query<any>(
          `INSERT INTO credit_adjustments (credit_id, installment_id, type, amount, reason, approved_by)
           VALUES (?, NULL, 'DESCUENTO', ?, ?, ?)`,
          [data.creditId, quote.discount, reason, req.user!.id]
        );
        await recordAudit(conn, {
          entity: "credit_adjustment",
          entityId: adj.insertId,
          action: "CREATE",
          newValue: { type: "DESCUENTO", amount: quote.discount, percent: quote.percent },
          userId: req.user!.id,
          ipAddress: req.ip,
          reason
        });
      }

      const payment = await recordPayment(
        conn,
        credit,
        req.user!.id,
        req.ip,
        { ...data, amount: quote.total },
        true
      );
      if (payment.creditStatus !== "PAGADO") {
        // p. ej. mora en modo AUTOMATICO que se generó al aplicar el pago: no se deja a medias.
        throw new HttpError(409, "No fue posible cancelar el crédito por completo; revise la política de mora e intente de nuevo");
      }
      const response = { ...payment, total: quote.total, discount: quote.discount };
      await completeIdempotencyInTransaction(conn, res, 201, response);
      return response;
    });

    invalidateReportCache();
    broadcastEvent("payment.registered", { creditId: data.creditId, paymentId: result.paymentId });
    res.status(201).json(result);
  })
);

/** Marca un pago ya registrado como verificado en banco con soporte archivado (o quita la marca). */
paymentsRouter.put(
  "/:id/verified",
  requirePermission("payments:verify"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const verified = req.body?.verified !== false;
    const [result] = await pool.query<any>(
      `UPDATE payments SET verified = ?, verified_by = ?, verified_at = ${verified ? "NOW()" : "NULL"} WHERE id = ?`,
      [verified ? 1 : 0, verified ? req.user!.id : null, id]
    );
    if (!result.affectedRows) throw new HttpError(404, "Pago no encontrado");
    await recordAudit(pool, {
      entity: "payment",
      entityId: id,
      action: verified ? "VERIFY" : "UNVERIFY",
      userId: req.user!.id,
      ipAddress: req.ip
    });
    res.json({ id, verified });
  })
);

paymentsRouter.post(
  "/:id/reverse",
  requirePermission("payments:reverse"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { reason } = reversalSchema.parse(req.body);

    // Se averigua el crédito FUERA de la transacción para poder bloquearlo como
    // PRIMERA sentencia (mismo orden que al registrar un pago: crédito, luego
    // pago; así no hay deadlocks, y las lecturas posteriores ven los cambios
    // de cualquier pago/reverso que terminó antes).
    const [pre] = await pool.query<any[]>(`SELECT credit_id FROM payments WHERE id = ?`, [id]);
    const creditId = (pre as any[])[0]?.credit_id;
    if (!creditId) throw new HttpError(404, "Pago no encontrado");

    await withTransaction(async (conn) => {
      const [creditRows] = await conn.query<any[]>(`SELECT id, status FROM credits WHERE id = ? FOR UPDATE`, [creditId]);
      // Un crédito refinanciado ya trasladó su saldo al crédito nuevo: reversar un pago del viejo dejaría el nuevo
      // con menos capital del que correspondía (hallazgo H5). Lo mismo para un crédito anulado.
      if (!["VIGENTE", "EN_MORA", "PAGADO"].includes((creditRows as any[])[0]?.status)) {
        throw new HttpError(409, "No se puede reversar un pago de un crédito refinanciado o anulado");
      }
      const [rows] = await conn.query<any[]>(`SELECT * FROM payments WHERE id = ? FOR UPDATE`, [id]);
      const payment = (rows as any[])[0];
      if (!payment) throw new HttpError(404, "Pago no encontrado");
      if (payment.status === "REVERSADO") throw new HttpError(409, "El pago ya fue reversado");
      if (payment.early_payoff) {
        // La cancelación anticipada redujo el interés de las cuotas; reversar solo el pago dejaría el crédito
        // con intereses menores a los pactados. Requiere una corrección manual.
        throw new HttpError(409, "Un pago de cancelación anticipada no se puede reversar desde aquí; contacte al administrador");
      }

      const [allocations] = await conn.query<any[]>(
        `SELECT * FROM payment_allocations WHERE payment_id = ?`,
        [id]
      );

      for (const alloc of allocations as any[]) {
        // Gastos y mora cobrada (ajustes): se descuenta lo pagado del ajuste.
        if (alloc.adjustment_id) {
          await conn.query(`UPDATE credit_adjustments SET paid_amount = paid_amount - ? WHERE id = ?`, [
            alloc.amount,
            alloc.adjustment_id
          ]);
          continue;
        }
        const column =
          alloc.concept === "CAPITAL" ? "principal_paid" : alloc.concept === "INTERES" ? "interest_paid" : "late_fee_paid";
        await conn.query(`UPDATE credit_schedule_installments SET ${column} = ${column} - ? WHERE id = ?`, [
          alloc.amount,
          alloc.installment_id
        ]);
      }

      // Saldo y estado de cada cuota tocada, y saldo de capital del crédito, se recalculan desde lo pagado.
      // Antes el reverso dejaba `principal_balance` y `balance` con el valor del pago reversado y la cuota en
      // PARCIAL aunque quedara sin abonos (hallazgo H1).
      const touched = [...new Set((allocations as any[]).filter((a) => a.installment_id).map((a) => a.installment_id as number))];
      await refreshInstallments(conn, touched, new Date());

      await conn.query(
        `UPDATE payments SET status = 'REVERSADO', reversal_reason = ? WHERE id = ?`,
        [reason, id]
      );
      await refreshCreditAfterReversal(conn, payment.credit_id);

      await recordAudit(conn, {
        entity: "payment",
        entityId: id,
        action: "REVERSE",
        oldValue: payment,
        reason,
        userId: req.user!.id,
        ipAddress: req.ip
      });

      await enqueueIntegrationEvent(conn, "PAYMENT_REVERSED", { paymentId: id, reason });
    });

    invalidateReportCache();
    broadcastEvent("payment.reversed", { paymentId: id });
    res.json({ id, status: "REVERSADO" });
  })
);
