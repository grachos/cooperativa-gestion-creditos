import { Router } from "express";
import { pool, withTransaction } from "../../db/pool.js";
import { paymentSchema, reversalSchema, idParam } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { allocatePayment } from "./allocation.service.js";
import { recordAudit } from "../audit/audit.service.js";
import { enqueueIntegrationEvent } from "../integration/integration.service.js";
import { broadcastEvent } from "../alerts/sse.hub.js";
import { invalidateReportCache } from "../reports/reportCache.js";
import { idempotent } from "../../middlewares/idempotent.js";

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.post(
  "/",
  requirePermission("payments:write"),
  idempotent("payments.create", { transactional: true }),
  asyncHandler(async (req, res) => {
    const data = paymentSchema.parse(req.body);

    const result = await withTransaction(async (conn) => {
      // Bloqueo del crédito (PRIMERA sentencia de la transacción): los pagos al
      // mismo crédito se aplican de a uno. Sin esto, dos pagos simultáneos leían
      // las mismas cuotas y el último en escribir pisaba al otro (abonos
      // perdidos o duplicados) o chocaban en un deadlock (500). La lectura de
      // las cuotas ocurre DESPUÉS del bloqueo, así que ve el pago anterior.
      const [creditRows] = await conn.query<any[]>(`SELECT * FROM credits WHERE id = ? FOR UPDATE`, [data.creditId]);
      const credit = (creditRows as any[])[0];
      if (!credit) throw new HttpError(404, "Crédito no encontrado");
      if (credit.status === "PAGADO" || credit.status === "ANULADO") {
        throw new HttpError(409, "El crédito no admite pagos en su estado actual");
      }

      const [paymentResult] = await conn.query<any>(
        `INSERT INTO payments (credit_id, received_date, effective_date, amount, payment_method, reference, notes, created_by, verified, verified_by, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${data.verified ? "NOW()" : "NULL"})`,
        [
          data.creditId,
          data.receivedDate,
          data.effectiveDate ?? data.receivedDate,
          data.amount,
          data.paymentMethod,
          data.reference ?? null,
          data.notes ?? null,
          req.user!.id,
          data.verified ? 1 : 0,
          data.verified ? req.user!.id : null
        ]
      );
      const paymentId = paymentResult.insertId;

      const asOf = new Date(data.effectiveDate ?? data.receivedDate);
      const allocations = await allocatePayment(conn, data.creditId, data.amount, asOf);

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

    invalidateReportCache();
    broadcastEvent("payment.registered", { creditId: data.creditId, paymentId: result.paymentId });
    res.status(201).json(result);
  })
);

/** Marca un pago ya registrado como verificado en banco con soporte archivado (o quita la marca). */
paymentsRouter.put(
  "/:id/verified",
  requirePermission("payments:write"),
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
  requirePermission("payments:write"),
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
      await conn.query(`SELECT id FROM credits WHERE id = ? FOR UPDATE`, [creditId]);
      const [rows] = await conn.query<any[]>(`SELECT * FROM payments WHERE id = ? FOR UPDATE`, [id]);
      const payment = (rows as any[])[0];
      if (!payment) throw new HttpError(404, "Pago no encontrado");
      if (payment.status === "REVERSADO") throw new HttpError(409, "El pago ya fue reversado");

      const [allocations] = await conn.query<any[]>(
        `SELECT * FROM payment_allocations WHERE payment_id = ?`,
        [id]
      );

      for (const alloc of allocations as any[]) {
        if (alloc.concept === "GASTOS") {
          await conn.query(`UPDATE credit_adjustments SET paid_amount = paid_amount - ? WHERE id = ?`, [
            alloc.amount,
            alloc.adjustment_id
          ]);
          continue;
        }
        const column =
          alloc.concept === "CAPITAL" ? "principal_paid" : alloc.concept === "INTERES" ? "interest_paid" : "late_fee_paid";
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

    invalidateReportCache();
    broadcastEvent("payment.reversed", { paymentId: id });
    res.json({ id, status: "REVERSADO" });
  })
);
