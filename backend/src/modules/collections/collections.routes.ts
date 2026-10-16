import { Router } from "express";
import { pool } from "../../db/pool.js";
import { collectionActionSchema, documentCheckSchema, promiseSchema, idParam } from "../../shared/schemas.js";
import { isKnownDocument, loadChecklist } from "../../utils/documentChecklist.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { recordAudit } from "../audit/audit.service.js";
import { idempotent } from "../../middlewares/idempotent.js";

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
  idempotent("credits.promise"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { promiseDate, description, observation } = promiseSchema.parse(req.body);

    const [creditRows] = await pool.query<any[]>(`SELECT id FROM credits WHERE id = ?`, [id]);
    if ((creditRows as any[]).length === 0) throw new HttpError(404, "Crédito no encontrado");

    const [result] = await pool.query<any>(
      `INSERT INTO collection_actions (credit_id, action_type, description, observation, promise_date, promise_status, created_by)
       VALUES (?, 'GESTION_COBRO', ?, ?, ?, 'PENDIENTE', ?)`,
      [id, description ?? "Compromiso de pago", observation || null, promiseDate, req.user!.id]
    );

    await recordAudit(pool, {
      entity: "collection_action",
      entityId: result.insertId,
      action: "PROMISE_CREATED",
      newValue: { promiseDate, description, observation },
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

/**
 * Cobro jurídico de un crédito: lista de chequeo de documentos (parámetro `documentos_juridicos`) y
 * bitácora de gestiones (notificaciones, gestión de cobro, preparación jurídica). Reutiliza
 * `collection_actions`, la misma tabla de los compromisos de pago.
 */
async function requireCredit(id: number) {
  const [rows] = await pool.query<any[]>(`SELECT id FROM credits WHERE id = ?`, [id]);
  if ((rows as any[]).length === 0) throw new HttpError(404, "Crédito no encontrado");
}

collectionsRouter.get(
  "/:id/legal-documents",
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    await requireCredit(id);
    res.json({ data: await loadChecklist(pool, "credit_legal_documents", "credit_id", id, "documentos_juridicos") });
  })
);

collectionsRouter.put(
  "/:id/legal-documents",
  requirePermission("collections:write"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { documentType, held, notes } = documentCheckSchema.parse(req.body);
    await requireCredit(id);
    if (!(await isKnownDocument(pool, "credit_legal_documents", "credit_id", id, "documentos_juridicos", documentType))) {
      throw new HttpError(400, "Ese documento no está en la lista de documentos jurídicos (Parámetros)");
    }
    await pool.query(
      `INSERT INTO credit_legal_documents (credit_id, document_type, held, notes, checked_by, checked_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE held = VALUES(held), notes = VALUES(notes), checked_by = VALUES(checked_by), checked_at = NOW()`,
      [id, documentType, held ? 1 : 0, notes || null, req.user!.id]
    );
    await recordAudit(pool, {
      entity: "credit",
      entityId: id,
      action: "LEGAL_DOCUMENT_CHECK",
      newValue: { documentType, held, notes },
      userId: req.user!.id,
      ipAddress: req.ip
    });
    res.json({ documentType, held });
  })
);

collectionsRouter.post(
  "/:id/actions",
  requirePermission("collections:write"),
  idempotent("credits.action"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { actionType, description } = collectionActionSchema.parse(req.body);
    await requireCredit(id);
    const [result] = await pool.query<any>(
      `INSERT INTO collection_actions (credit_id, action_type, description, status, created_by)
       VALUES (?, ?, ?, 'PENDIENTE', ?)`,
      [id, actionType, description, req.user!.id]
    );
    await recordAudit(pool, {
      entity: "collection_action",
      entityId: result.insertId,
      action: "COLLECTION_ACTION_CREATED",
      newValue: { creditId: id, actionType, description },
      userId: req.user!.id,
      ipAddress: req.ip
    });
    res.status(201).json({ id: result.insertId });
  })
);

collectionsRouter.post(
  "/actions/:actionId/complete",
  requirePermission("collections:write"),
  asyncHandler(async (req, res) => {
    const actionId = idParam.parse({ id: req.params.actionId }).id;
    const [result] = await pool.query<any>(
      `UPDATE collection_actions SET status = 'COMPLETADA' WHERE id = ? AND promise_date IS NULL`,
      [actionId]
    );
    if (!result.affectedRows) throw new HttpError(404, "Gestión no encontrada");
    await recordAudit(pool, {
      entity: "collection_action",
      entityId: actionId,
      action: "COLLECTION_ACTION_COMPLETED",
      userId: req.user!.id,
      ipAddress: req.ip
    });
    res.json({ id: actionId, status: "COMPLETADA" });
  })
);
