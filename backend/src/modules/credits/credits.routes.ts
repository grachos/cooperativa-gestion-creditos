import { Router } from "express";
import { pool, withTransaction } from "../../db/pool.js";
import { disbursementSchema, refinanceSchema, idParam, paginationQuery } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { buildAmortizationSchedule } from "./schedule.service.js";
import { recordAudit } from "../audit/audit.service.js";
import { enqueueIntegrationEvent } from "../integration/integration.service.js";
import { broadcastEvent } from "../alerts/sse.hub.js";
import { DEFAULT_DELINQUENCY_POLICY, getMoraBucket } from "../delinquency/delinquency.service.js";
import { round2 } from "../../utils/money.js";

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
    const { disbursementDate, firstInstallmentDate, assignedCollectorId, assignedSellerId, funderName, funderRatePercent } =
      disbursementSchema.parse(req.body);

    const credit = await withTransaction(async (conn) => {
      const [rows] = await conn.query<any[]>(`SELECT * FROM credit_applications WHERE id = ?`, [id]);
      const app = (rows as any[])[0];
      if (!app) throw new HttpError(404, "Solicitud no encontrada");
      if (app.status !== "APROBADA") throw new HttpError(409, "La solicitud debe estar aprobada para desembolsar");

      const creditNumber = await nextCreditNumber();

      const [result] = await conn.query<any>(
        `INSERT INTO credits
          (credit_number, credit_application_id, titular_associate_id, titular_society_id, assigned_collector_id, assigned_seller_id, disbursed_amount, principal_balance, interest_rate, rate_type, term_value, disbursement_date, first_installment_date, delinquency_policy_snapshot, parameters_snapshot, funder_name, funder_rate_percent, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          creditNumber,
          id,
          app.titular_associate_id,
          app.titular_society_id,
          assignedCollectorId ?? null,
          assignedSellerId ?? null,
          app.requested_amount,
          app.requested_amount,
          app.interest_rate,
          app.rate_type,
          app.term_value,
          disbursementDate,
          firstInstallmentDate,
          JSON.stringify(DEFAULT_DELINQUENCY_POLICY),
          JSON.stringify({ rateType: app.rate_type, termValue: app.term_value }),
          funderName ?? null,
          funderRatePercent ?? null,
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
      `SELECT c.*, a.first_name, a.last_name, s.legal_name,
              (SELECT MAX(GREATEST((CURRENT_DATE - csi.due_date), 0))
               FROM credit_schedule_installments csi
               WHERE csi.credit_id = c.id AND csi.status NOT IN ('PAGADA','ANULADA')) AS max_overdue_days
       FROM credits c
       LEFT JOIN associates a ON a.id = c.titular_associate_id
       LEFT JOIN societies s ON s.id = c.titular_society_id
       ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, offset]
    );
    const [countRows] = await pool.query<any[]>(`SELECT COUNT(*) as total FROM credits c ${where}`, args);
    const data = (rows as any[]).map((row) => {
      const bucket = getMoraBucket(Number(row.max_overdue_days ?? 0));
      return { ...row, moraCode: row.status === "PAGADO" ? null : bucket.code, moraLabel: row.status === "PAGADO" ? null : bucket.label };
    });
    res.json({ data, page, pageSize, total: (countRows as any[])[0].total });
  })
);

creditsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [rows] = await pool.query<any[]>(
      `SELECT c.*, col.full_name AS collector_name, sel.full_name AS seller_name,
              rf.credit_number AS refinanced_from_credit_number, rt.credit_number AS refinanced_to_credit_number
       FROM credits c
       LEFT JOIN users col ON col.id = c.assigned_collector_id
       LEFT JOIN users sel ON sel.id = c.assigned_seller_id
       LEFT JOIN credits rf ON rf.id = c.refinanced_from_credit_id
       LEFT JOIN credits rt ON rt.id = c.refinanced_to_credit_id
       WHERE c.id = ?`,
      [id]
    );
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
    const [adjustments] = await pool.query<any[]>(
      `SELECT ca.*, u.full_name AS approved_by_name FROM credit_adjustments ca
       LEFT JOIN users u ON u.id = ca.approved_by
       WHERE ca.credit_id = ? ORDER BY ca.created_at DESC`,
      [id]
    );
    const [collectionActions] = await pool.query<any[]>(
      `SELECT * FROM collection_actions WHERE credit_id = ? ORDER BY created_at DESC`,
      [id]
    );

    const maxOverdueDays = (schedule as any[])
      .filter((i) => !["PAGADA", "ANULADA"].includes(i.status))
      .reduce((max, i) => Math.max(max, i.overdue_days), 0);
    const bucket = getMoraBucket(maxOverdueDays);
    const moraCode = credit.status === "PAGADO" ? null : bucket.code;
    const moraLabel = credit.status === "PAGADO" ? null : bucket.label;

    // Hallazgo del Excel real: cuando el crédito se fondea con capital de un
    // tercero ("tomador"), la cooperativa cobra al asociado una tasa y le
    // reconoce al tomador una tasa menor; la diferencia es el margen de la
    // cooperativa (verificado: 4% al asociado vs 1,9% al tomador, 2,1% de
    // diferencia, constante en 16 meses consecutivos del histórico real).
    const funderSummary =
      credit.funder_rate_percent != null
        ? {
            funderName: credit.funder_name,
            funderRatePercent: Number(credit.funder_rate_percent),
            clientRatePercent: Number(credit.interest_rate),
            cooperativeMarginPercent: round2(Number(credit.interest_rate) - Number(credit.funder_rate_percent)),
            funderMonthlyInterest: round2((Number(credit.principal_balance) * Number(credit.funder_rate_percent)) / 100),
            cooperativeMarginMonthly: round2(
              (Number(credit.principal_balance) * (Number(credit.interest_rate) - Number(credit.funder_rate_percent))) / 100
            )
          }
        : null;

    res.json({
      ...credit,
      moraCode,
      moraLabel,
      funderSummary,
      schedule,
      payments,
      alerts,
      participants,
      adjustments,
      collectionActions
    });
  })
);

creditsRouter.post(
  "/:id/refinance",
  requirePermission("disbursements:write"),
  asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const { additionalCapital, termValue, interestRate, firstInstallmentDate, reason } = refinanceSchema.parse(
        req.body
      );

      const result = await withTransaction(async (conn) => {
        const [rows] = await conn.query<any[]>(`SELECT * FROM credits WHERE id = ?`, [id]);
        const oldCredit = (rows as any[])[0];
        if (!oldCredit) throw new HttpError(404, "Crédito no encontrado");
        if (!["VIGENTE", "EN_MORA"].includes(oldCredit.status)) {
          throw new HttpError(409, "Solo se pueden refinanciar créditos vigentes o en mora");
        }

        const [balanceRows] = await conn.query<any[]>(
          `SELECT SUM(total_due - principal_paid - interest_paid) AS outstanding
           FROM credit_schedule_installments WHERE credit_id = ? AND status NOT IN ('ANULADA')`,
          [id]
        );
        const outstanding = Number((balanceRows as any[])[0].outstanding ?? 0);
        const newPrincipal = round2(outstanding + additionalCapital);

        await conn.query(`UPDATE credits SET status = 'REFINANCIADO' WHERE id = ?`, [id]);
        await conn.query(
          `UPDATE credit_schedule_installments SET status = 'ANULADA'
           WHERE credit_id = ? AND status NOT IN ('PAGADA')`,
          [id]
        );

        const creditNumber = await nextCreditNumber();
        const refinanceDisbursementDate = new Date().toISOString().slice(0, 10);
        const [insertResult] = await conn.query<any>(
          `INSERT INTO credits
            (credit_number, credit_application_id, titular_associate_id, titular_society_id, assigned_collector_id, assigned_seller_id, refinanced_from_credit_id, disbursed_amount, principal_balance, interest_rate, rate_type, term_value, disbursement_date, first_installment_date, delinquency_policy_snapshot, parameters_snapshot, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            creditNumber,
            oldCredit.credit_application_id,
            oldCredit.titular_associate_id,
            oldCredit.titular_society_id,
            oldCredit.assigned_collector_id,
            oldCredit.assigned_seller_id,
            id,
            newPrincipal,
            newPrincipal,
            interestRate,
            oldCredit.rate_type,
            termValue,
            refinanceDisbursementDate,
            firstInstallmentDate,
            JSON.stringify(oldCredit.delinquency_policy_snapshot),
            JSON.stringify({ rateType: oldCredit.rate_type, termValue }),
            req.user!.id
          ]
        );
        const newCreditId = insertResult.insertId;
        await conn.query(`UPDATE credits SET refinanced_to_credit_id = ? WHERE id = ?`, [newCreditId, id]);
        await conn.query(`UPDATE credit_participants SET credit_id = ? WHERE credit_id = ?`, [newCreditId, id]);

        const schedule = buildAmortizationSchedule({
          principal: newPrincipal,
          monthlyRatePercent: interestRate,
          termMonths: termValue,
          firstInstallmentDate: new Date(firstInstallmentDate)
        });
        for (const row of schedule) {
          await conn.query(
            `INSERT INTO credit_schedule_installments
              (credit_id, installment_number, due_date, principal_due, interest_due, other_due, total_due, balance)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [newCreditId, row.installmentNumber, row.dueDate, row.principalDue, row.interestDue, row.otherDue, row.totalDue, row.totalDue]
          );
        }

        await recordAudit(conn, {
          entity: "credit",
          entityId: newCreditId,
          action: "REFINANCE",
          oldValue: { creditId: id, outstanding, additionalCapital },
          newValue: { creditNumber, newPrincipal, termValue, interestRate },
          userId: req.user!.id,
          ipAddress: req.ip,
          reason
        });
        await enqueueIntegrationEvent(conn, "CREDIT_STATUS_CHANGED", {
          creditId: id,
          newStatus: "REFINANCIADO",
          refinancedToCreditId: newCreditId
        });

        return { id: newCreditId, creditNumber, refinancedFromCreditId: id };
      });

    broadcastEvent("credit.refinanced", result);
    res.status(201).json(result);
  })
);
