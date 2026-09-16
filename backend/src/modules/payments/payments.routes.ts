import { Router } from "express";
import { pool, withTransaction } from "../../db/pool.js";
import { paymentSchema, reversalSchema, idParam } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { allocatePayment } from "./allocation.service.js";
import { recordAudit } from "../audit/audit.service.js";
import { enqueueIntegrationEvent } from "../integration/integration.service.js";
import { broadcastEvent } from "../alerts/sse.hub.js";

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.post(
  "/",
  requirePermission("payments:write"),
  asyncHandler(async (req, res) => {
    const data = paymentSchema.parse(req.body);

    const result = await withTransaction(async (conn) => {
      const [creditRows] = await conn.query<any[]>(`SELECT * FROM credits WHERE id = ?`, [data.creditId]);
      const credit = (creditRows as any[])[0];
      if (!credit) throw new HttpError(404, "Crédito no encontrado");
      if (credit.status === "PAGADO" || credit.status === "ANULADO") {
        throw new HttpError(409, "El crédito no admite pagos en su estado actual");
      }

      const [paymentResult] = await conn.query<any>(
        `INSERT INTO payments (credit_id, received_date, effective_date, amount, payment_method, reference, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.creditId,
          data.receivedDate,
          data.effectiveDate ?? data.receivedDate,
          data.amount,
          data.paymentMethod,
          data.reference ?? null,
          data.notes ?? null,
          req.user!.id
        ]
      );
      const paymentId = paymentResult.insertId;

      const asOf = new Date(data.effectiveDate ?? data.receivedDate);
      const allocations = await allocatePayment(conn, data.creditId, data.amount, asOf);

      for (const line of allocations) {
        await conn.query(
          `INSERT INTO payment_allocations (payment_id, installment_id, concept, amount) VALUES (?, ?, ?, ?)`,
          [paymentId, line.installmentId, line.concept, line.amount]
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
        action: "CREATE",
        newValue: { ...data, allocations },
        userId: req.user!.id,
        ipAddress: req.ip
      });

      await enqueueIntegrationEvent(conn, "PAYMENT_REGISTERED", {
        paymentId,
        creditId: data.creditId,
        amount: data.amount
      });

      return { paymentId, allocations, creditStatus: newCreditStatus };
    });

    broadcastEvent("payment.registered", { creditId: data.creditId, paymentId: result.paymentId });
    res.status(201).json(result);
  })
);

paymentsRouter.post(
  "/:id/reverse",
  requirePermission("payments:write"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { reason } = reversalSchema.parse(req.body);

    await withTransaction(async (conn) => {
      const [rows] = await conn.query<any[]>(`SELECT * FROM payments WHERE id = ?`, [id]);
      const payment = (rows as any[])[0];
      if (!payment) throw new HttpError(404, "Pago no encontrado");
      if (payment.status === "REVERSADO") throw new HttpError(409, "El pago ya fue reversado");

      const [allocations] = await conn.query<any[]>(
        `SELECT * FROM payment_allocations WHERE payment_id = ?`,
        [id]
      );

      for (const alloc of allocations as any[]) {
        const column =
          alloc.concept === "CAPITAL"
            ? "principal_paid"
            : alloc.concept === "INTERES"
            ? "interest_paid"
            : alloc.concept === "MORA"
            ? "late_fee_paid"
            : "other_paid";
        await conn.query(
          `UPDATE credit_schedule_installments SET ${column} = ${column} - ?,
             status = CASE WHEN status = 'PAGADA' THEN 'PARCIAL' ELSE status END
           WHERE id = ?`,
          [alloc.amount, alloc.installment_id]
        );
      }

      await conn.query(
        `UPDATE payments SET status = 'REVERSADO', reversal_reason = ? WHERE id = ?`,
        [reason, id]
      );
      await conn.query(`UPDATE credits SET status = 'VIGENTE' WHERE id = ? AND status = 'PAGADO'`, [
        payment.credit_id
      ]);

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

    broadcastEvent("payment.reversed", { paymentId: id });
    res.json({ id, status: "REVERSADO" });
  })
);
