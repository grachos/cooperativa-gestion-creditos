import { Router } from "express";
import { pool } from "../../db/pool.js";
import { promiseSchema, idParam } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { recordAudit } from "../audit/audit.service.js";

/**
 * Compromisos de pago (FECHAS DE COMPROMISOS en el Excel original): la
 * gestora de cartera anota una fecha en la que el cliente promete pagar.
 * Se modela como una acción de cobro (`collection_actions`) para reutilizar
 * la tabla ya prevista en el modelo de datos para notificación/gestión.
 */
export const collectionsRouter = Router();
collectionsRouter.use(requireAuth);

collectionsRouter.post(
  "/:id/promises",
  requirePermission("collections:write"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { promiseDate, description } = promiseSchema.parse(req.body);

    const [creditRows] = await pool.query<any[]>(`SELECT id FROM credits WHERE id = ?`, [id]);
    if ((creditRows as any[]).length === 0) throw new HttpError(404, "Crédito no encontrado");

    const [result] = await pool.query<any>(
      `INSERT INTO collection_actions (credit_id, action_type, description, promise_date, promise_status, created_by)
       VALUES (?, 'GESTION_COBRO', ?, ?, 'PENDIENTE', ?)`,
      [id, description ?? "Compromiso de pago", promiseDate, req.user!.id]
    );

    await recordAudit(pool, {
      entity: "collection_action",
      entityId: result.insertId,
      action: "PROMISE_CREATED",
      newValue: { promiseDate, description },
      userId: req.user!.id,
      ipAddress: req.ip
    });

    res.status(201).json({ id: result.insertId });
  })
);

collectionsRouter.post(
  "/promises/:actionId/resolve",
  requirePermission("collections:write"),
  asyncHandler(async (req, res) => {
    const actionId = idParam.parse({ id: req.params.actionId }).id;
    const fulfilled = req.body?.fulfilled !== false;

    const [rows] = await pool.query<any[]>(`SELECT id FROM collection_actions WHERE id = ?`, [actionId]);
    if ((rows as any[]).length === 0) throw new HttpError(404, "Compromiso no encontrado");

    await pool.query(
      `UPDATE collection_actions SET promise_status = ?, status = 'COMPLETADA' WHERE id = ?`,
      [fulfilled ? "CUMPLIDA" : "INCUMPLIDA", actionId]
    );

    res.json({ id: actionId, promiseStatus: fulfilled ? "CUMPLIDA" : "INCUMPLIDA" });
  })
);
