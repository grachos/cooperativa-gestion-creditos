import { Router } from "express";
import { pool, withTransaction } from "../../db/pool.js";
import { disbursementSchema, idParam, paginationQuery } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { buildAmortizationSchedule } from "./schedule.service.js";
import { recordAudit } from "../audit/audit.service.js";
import { enqueueIntegrationEvent } from "../integration/integration.service.js";
import { broadcastEvent } from "../alerts/sse.hub.js";
import { DEFAULT_DELINQUENCY_POLICY } from "../delinquency/delinquency.service.js";

export const creditsRouter = Router();
creditsRouter.use(requireAuth);

async function nextCreditNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) as total FROM credits WHERE credit_number LIKE ?`,
    [`CR-${year}-%`]
  );
  const seq = (rows as any[])[0].total + 1;
  return `CR-${year}-${String(seq).padStart(5, "0")}`;
}

creditsRouter.post(
  "/applications/:id/disburse",
  requirePermission("disbursements:write"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { disbursementDate, firstInstallmentDate } = disbursementSchema.parse(req.body);

    const credit = await withTransaction(async (conn) => {
      const [rows] = await conn.query<any[]>(`SELECT * FROM credit_applications WHERE id = ?`, [id]);
      const app = (rows as any[])[0];
      if (!app) throw new HttpError(404, "Solicitud no encontrada");
      if (app.status !== "APROBADA") throw new HttpError(409, "La solicitud debe estar aprobada para desembolsar");

      const creditNumber = await nextCreditNumber();

      const [result] = await conn.query<any>(
        `INSERT INTO credits
          (credit_number, credit_application_id, titular_associate_id, titular_society_id, disbursed_amount, principal_balance, interest_rate, rate_type, term_value, disbursement_date, first_installment_date, delinquency_policy_snapshot, parameters_snapshot, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          creditNumber,
          id,
          app.titular_associate_id,
          app.titular_society_id,
          app.requested_amount,
          app.requested_amount,
          app.interest_rate,
          app.rate_type,
          app.term_value,
          disbursementDate,
          firstInstallmentDate,
          JSON.stringify(DEFAULT_DELINQUENCY_POLICY),
          JSON.stringify({ rateType: app.rate_type, termValue: app.term_value }),
          req.user!.id
        ]
      );
      const creditId = result.insertId;

      await conn.query(
        `UPDATE credit_participants SET credit_id = ? WHERE credit_application_id = ?`,
        [creditId, id]
      );

      const schedule = buildAmortizationSchedule({
        principal: Number(app.requested_amount),
        monthlyRatePercent: Number(app.interest_rate),
        termMonths: app.term_value,
        firstInstallmentDate: new Date(firstInstallmentDate)
      });

      for (const row of schedule) {
        await conn.query(
          `INSERT INTO credit_schedule_installments
            (credit_id, installment_number, due_date, principal_due, interest_due, other_due, total_due, balance)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [creditId, row.installmentNumber, row.dueDate, row.principalDue, row.interestDue, row.otherDue, row.totalDue, row.totalDue]
        );
      }

      await conn.query(`UPDATE credit_applications SET status = 'DESEMBOLSADA' WHERE id = ?`, [id]);
      await conn.query(
        `INSERT INTO credit_application_status_history (credit_application_id, from_status, to_status, reason, user_id)
         VALUES (?, 'APROBADA', 'DESEMBOLSADA', 'Desembolso ejecutado', ?)`,
        [id, req.user!.id]
      );

      await recordAudit(conn, {
        entity: "credit",
        entityId: creditId,
        action: "DISBURSE",
        newValue: { creditNumber, disbursementDate, firstInstallmentDate },
        userId: req.user!.id,
        ipAddress: req.ip
      });

      await enqueueIntegrationEvent(conn, "CREDIT_DISBURSED", {
        creditId,
        creditNumber,
        amount: app.requested_amount,
        disbursementDate
      });

      return { id: creditId, creditNumber };
    });

    broadcastEvent("credit.disbursed", credit);
    res.status(201).json(credit);
  })
);

creditsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationQuery.parse(req.query);
    const status = req.query.status as string | undefined;
    const offset = (page - 1) * pageSize;
    const where = status ? `WHERE c.status = ?` : "";
    const args = status ? [status] : [];

    const [rows] = await pool.query<any[]>(
      `SELECT c.*, a.first_name, a.last_name, s.legal_name
       FROM credits c
       LEFT JOIN associates a ON a.id = c.titular_associate_id
       LEFT JOIN societies s ON s.id = c.titular_society_id
       ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, offset]
    );
    const [countRows] = await pool.query<any[]>(`SELECT COUNT(*) as total FROM credits c ${where}`, args);
    res.json({ data: rows, page, pageSize, total: (countRows as any[])[0].total });
  })
);

creditsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [rows] = await pool.query<any[]>(`SELECT * FROM credits WHERE id = ?`, [id]);
    const credit = (rows as any[])[0];
    if (!credit) throw new HttpError(404, "Crédito no encontrado");

    const [schedule] = await pool.query<any[]>(
      `SELECT * FROM credit_schedule_installments WHERE credit_id = ? ORDER BY installment_number ASC`,
      [id]
    );
    const [payments] = await pool.query<any[]>(
      `SELECT * FROM payments WHERE credit_id = ? ORDER BY received_date DESC`,
      [id]
    );
    const [alerts] = await pool.query<any[]>(
      `SELECT * FROM alerts WHERE credit_id = ? ORDER BY created_at DESC`,
      [id]
    );
    const [participants] = await pool.query<any[]>(
      `SELECT cp.*, a.first_name, a.last_name FROM credit_participants cp
       LEFT JOIN associates a ON a.id = cp.associate_id
       WHERE cp.credit_id = ?`,
      [id]
    );

    res.json({ ...credit, schedule, payments, alerts, participants });
  })
);
