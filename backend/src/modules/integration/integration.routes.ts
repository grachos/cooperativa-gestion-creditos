import { Router } from "express";
import { pool } from "../../db/pool.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { idParam, paginationQuery } from "../../shared/schemas.js";

export const integrationRouter = Router();
integrationRouter.use(requireAuth);

integrationRouter.get(
  "/events",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationQuery.parse(req.query);
    const status = req.query.status as string | undefined;
    const offset = (page - 1) * pageSize;
    const where = status ? `WHERE status = ?` : "";
    const args = status ? [status] : [];

    const [rows] = await pool.query<any[]>(
      `SELECT * FROM integration_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, offset]
    );
    const [countRows] = await pool.query<any[]>(
      `SELECT COUNT(*) as total FROM integration_events ${where}`,
      args
    );
    res.json({ data: rows, page, pageSize, total: (countRows as any[])[0].total });
  })
);

integrationRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<any[]>(
      `SELECT status, COUNT(*) as total FROM integration_events GROUP BY status`
    );
    res.json(rows);
  })
);

integrationRouter.post(
  "/events/replay",
  requirePermission("integration:write"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.body);
    const [rows] = await pool.query<any[]>(`SELECT * FROM integration_events WHERE id = ?`, [id]);
    const event = (rows as any[])[0];
    if (!event) throw new HttpError(404, "Evento no encontrado");

    // Simulación: no existe todavía adaptador real hacia el software contable.
    // Se marca como enviado/confirmado y se registra el intento.
    const attemptNumber = event.attempts + 1;
    await pool.query(
      `UPDATE integration_events SET status = 'CONFIRMADO', attempts = ? WHERE id = ?`,
      [attemptNumber, id]
    );
    await pool.query(
      `INSERT INTO integration_attempts (integration_event_id, attempt_number, response_summary, success)
       VALUES (?, ?, 'Simulado: confirmado en reproceso manual', TRUE)`,
      [id, attemptNumber]
    );

    res.json({ id, status: "CONFIRMADO" });
  })
);

integrationRouter.get(
  "/export/accounting",
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<any[]>(
      `SELECT event_type, idempotency_key, payload, status, created_at
       FROM integration_events WHERE status IN ('PENDIENTE','FALLIDO') ORDER BY created_at ASC`
    );
    res.json({ generatedAt: new Date().toISOString(), events: rows });
  })
);
