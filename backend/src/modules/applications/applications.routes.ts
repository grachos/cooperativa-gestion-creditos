import { Router } from "express";
import { pool } from "../../db/pool.js";
import { creditApplicationSchema, decisionSchema, idParam, paginationQuery } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { recordAudit } from "../audit/audit.service.js";
import { broadcastEvent } from "../alerts/sse.hub.js";

export const applicationsRouter = Router();
applicationsRouter.use(requireAuth);

async function transition(
  applicationId: number,
  fromStatus: string,
  toStatus: string,
  userId: number,
  reason?: string | null
) {
  await pool.query(`UPDATE credit_applications SET status = ? WHERE id = ?`, [toStatus, applicationId]);
  await pool.query(
    `INSERT INTO credit_application_status_history (credit_application_id, from_status, to_status, reason, user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [applicationId, fromStatus, toStatus, reason ?? null, userId]
  );
}

applicationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationQuery.parse(req.query);
    const status = req.query.status as string | undefined;
    const offset = (page - 1) * pageSize;
    const where = status ? `WHERE status = ?` : "";
    const args = status ? [status] : [];

    const [rows] = await pool.query<any[]>(
      `SELECT ca.*, a.first_name, a.last_name, s.legal_name
       FROM credit_applications ca
       LEFT JOIN associates a ON a.id = ca.titular_associate_id
       LEFT JOIN societies s ON s.id = ca.titular_society_id
       ${where} ORDER BY ca.created_at DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, offset]
    );
    const [countRows] = await pool.query<any[]>(
      `SELECT COUNT(*) as total FROM credit_applications ${where}`,
      args
    );
    res.json({ data: rows, page, pageSize, total: (countRows as any[])[0].total });
  })
);

applicationsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [rows] = await pool.query<any[]>(`SELECT * FROM credit_applications WHERE id = ?`, [id]);
    const application = (rows as any[])[0];
    if (!application) throw new HttpError(404, "Solicitud no encontrada");

    const [participants] = await pool.query<any[]>(
      `SELECT cp.*, a.first_name, a.last_name FROM credit_participants cp
       LEFT JOIN associates a ON a.id = cp.associate_id
       WHERE cp.credit_application_id = ?`,
      [id]
    );
    const [history] = await pool.query<any[]>(
      `SELECT * FROM credit_application_status_history WHERE credit_application_id = ? ORDER BY created_at ASC`,
      [id]
    );

    res.json({ ...application, participants, history });
  })
);

applicationsRouter.post(
  "/",
  requirePermission("applications:write"),
  asyncHandler(async (req, res) => {
    const data = creditApplicationSchema.parse(req.body);
    if (!data.titularAssociateId && !data.titularSocietyId) {
      throw new HttpError(400, "Debe indicar un titular (asociado o sociedad)");
    }

    const [result] = await pool.query<any>(
      `INSERT INTO credit_applications
        (titular_associate_id, titular_society_id, requested_amount, term_value, interest_rate, rate_type, expected_disbursement_date, due_day_rule, purpose, notes, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RADICADA', ?)`,
      [
        data.titularAssociateId ?? null,
        data.titularSocietyId ?? null,
        data.requestedAmount,
        data.termValue,
        data.interestRate,
        data.rateType,
        data.expectedDisbursementDate ?? null,
        data.dueDayRule ?? null,
        data.purpose ?? null,
        data.notes ?? null,
        req.user!.id
      ]
    );
    const applicationId = result.insertId;

    await pool.query(
      `INSERT INTO credit_participants (credit_application_id, associate_id, society_id, role) VALUES (?, ?, ?, 'TITULAR')`,
      [applicationId, data.titularAssociateId ?? null, data.titularSocietyId ?? null]
    );

    for (const coDebtorId of data.coDebtorAssociateIds ?? []) {
      await pool.query(
        `INSERT INTO credit_participants (credit_application_id, associate_id, role) VALUES (?, ?, 'CODEUDOR')`,
        [applicationId, coDebtorId]
      );
    }

    await transition(applicationId, "BORRADOR", "RADICADA", req.user!.id, "Radicación inicial");
    await recordAudit(pool, {
      entity: "credit_application",
      entityId: applicationId,
      action: "CREATE",
      newValue: data,
      userId: req.user!.id,
      ipAddress: req.ip
    });

    broadcastEvent("application.created", { id: applicationId });
    res.status(201).json({ id: applicationId });
  })
);

applicationsRouter.post(
  "/:id/review",
  requirePermission("applications:approve"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [rows] = await pool.query<any[]>(`SELECT status FROM credit_applications WHERE id = ?`, [id]);
    const app = (rows as any[])[0];
    if (!app) throw new HttpError(404, "Solicitud no encontrada");
    if (app.status !== "RADICADA") throw new HttpError(409, "La solicitud no está en estado radicada");

    await transition(id, app.status, "EN_REVISION", req.user!.id, "Inicio de revisión");
    res.json({ id, status: "EN_REVISION" });
  })
);

applicationsRouter.post(
  "/:id/approve",
  requirePermission("applications:approve"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const decision = decisionSchema.parse(req.body);

    const [rows] = await pool.query<any[]>(`SELECT * FROM credit_applications WHERE id = ?`, [id]);
    const app = (rows as any[])[0];
    if (!app) throw new HttpError(404, "Solicitud no encontrada");
    if (!["RADICADA", "EN_REVISION"].includes(app.status)) {
      throw new HttpError(409, "La solicitud no puede aprobarse en su estado actual");
    }

    await pool.query(
      `UPDATE credit_applications SET
        requested_amount = COALESCE(?, requested_amount),
        interest_rate = COALESCE(?, interest_rate),
        term_value = COALESCE(?, term_value),
        decided_by = ?, decided_at = NOW()
       WHERE id = ?`,
      [
        decision.approvedAmount ?? null,
        decision.approvedRate ?? null,
        decision.approvedTerm ?? null,
        req.user!.id,
        id
      ]
    );
    await transition(id, app.status, "APROBADA", req.user!.id, decision.observations ?? "Aprobada");

    await recordAudit(pool, {
      entity: "credit_application",
      entityId: id,
      action: "APPROVE",
      oldValue: app,
      newValue: decision,
      userId: req.user!.id,
      ipAddress: req.ip
    });

    broadcastEvent("application.status_changed", { id, status: "APROBADA" });
    res.json({ id, status: "APROBADA" });
  })
);

applicationsRouter.post(
  "/:id/reject",
  requirePermission("applications:approve"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const decision = decisionSchema.parse(req.body);
    if (!decision.rejectionReason) throw new HttpError(400, "Debe indicar el motivo de rechazo");

    const [rows] = await pool.query<any[]>(`SELECT * FROM credit_applications WHERE id = ?`, [id]);
    const app = (rows as any[])[0];
    if (!app) throw new HttpError(404, "Solicitud no encontrada");
    if (!["RADICADA", "EN_REVISION"].includes(app.status)) {
      throw new HttpError(409, "La solicitud no puede rechazarse en su estado actual");
    }

    await pool.query(
      `UPDATE credit_applications SET rejection_reason = ?, decided_by = ?, decided_at = NOW() WHERE id = ?`,
      [decision.rejectionReason, req.user!.id, id]
    );
    await transition(id, app.status, "RECHAZADA", req.user!.id, decision.rejectionReason);

    await recordAudit(pool, {
      entity: "credit_application",
      entityId: id,
      action: "REJECT",
      oldValue: app,
      newValue: decision,
      userId: req.user!.id,
      ipAddress: req.ip
    });

    broadcastEvent("application.status_changed", { id, status: "RECHAZADA" });
    res.json({ id, status: "RECHAZADA" });
  })
);

applicationsRouter.post(
  "/:id/cancel",
  requirePermission("applications:write"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [rows] = await pool.query<any[]>(`SELECT status FROM credit_applications WHERE id = ?`, [id]);
    const app = (rows as any[])[0];
    if (!app) throw new HttpError(404, "Solicitud no encontrada");
    if (["DESEMBOLSADA", "CANCELADA"].includes(app.status)) {
      throw new HttpError(409, "La solicitud no puede cancelarse en su estado actual");
    }
    await transition(id, app.status, "CANCELADA", req.user!.id, req.body?.reason ?? "Cancelada por usuario");
    res.json({ id, status: "CANCELADA" });
  })
);
