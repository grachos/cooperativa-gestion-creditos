import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { recordAudit } from "../audit/audit.service.js";

export const parametersRouter = Router();
parametersRouter.use(requireAuth);

parametersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<any[]>(`SELECT * FROM parameters ORDER BY \`key\` ASC`);
    res.json(rows);
  })
);

const createSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_]+$/, "La llave solo puede tener minúsculas, números y guiones bajos"),
  value: z.unknown(),
  description: z.string().max(500).optional()
});

parametersRouter.post(
  "/",
  requirePermission("parameters:write"),
  asyncHandler(async (req, res) => {
    const { key, value, description } = createSchema.parse(req.body);

    const [existing] = await pool.query<any[]>(`SELECT 1 FROM parameters WHERE \`key\` = ?`, [key]);
    if (existing.length > 0) throw new HttpError(409, "Ya existe un parámetro con esa llave");

    await pool.query(`INSERT INTO parameters (\`key\`, value, description, updated_by) VALUES (?, ?, ?, ?)`, [
      key,
      JSON.stringify(value),
      description ?? null,
      req.user!.id
    ]);

    await recordAudit(pool, {
      entity: "parameter",
      entityId: key,
      action: "CREATE",
      oldValue: null,
      newValue: value,
      userId: req.user!.id,
      ipAddress: req.ip
    });

    res.status(201).json({ key, value, description: description ?? null });
  })
);

const updateSchema = z.object({
  value: z.unknown(),
  description: z.string().max(500).optional(),
  reason: z.string().optional()
});

parametersRouter.put(
  "/:key",
  requirePermission("parameters:write"),
  asyncHandler(async (req, res) => {
    const key = z.string().min(1).parse(req.params.key);
    const { value, description, reason } = updateSchema.parse(req.body);

    const [rows] = await pool.query<any[]>(`SELECT * FROM parameters WHERE \`key\` = ?`, [key]);
    const before = (rows as any[])[0];
    if (!before) throw new HttpError(404, "Parámetro no encontrado");

    await pool.query(`UPDATE parameters SET value = ?, description = COALESCE(?, description), updated_by = ? WHERE \`key\` = ?`, [
      JSON.stringify(value),
      description ?? null,
      req.user!.id,
      key
    ]);

    await recordAudit(pool, {
      entity: "parameter",
      entityId: key,
      action: "UPDATE",
      oldValue: before.value,
      newValue: value,
      userId: req.user!.id,
      ipAddress: req.ip,
      reason
    });

    res.json({ key, value });
  })
);

parametersRouter.delete(
  "/:key",
  requirePermission("parameters:write"),
  asyncHandler(async (req, res) => {
    const key = z.string().min(1).parse(req.params.key);

    const [rows] = await pool.query<any[]>(`SELECT * FROM parameters WHERE \`key\` = ?`, [key]);
    const before = (rows as any[])[0];
    if (!before) throw new HttpError(404, "Parámetro no encontrado");

    await pool.query(`DELETE FROM parameters WHERE \`key\` = ?`, [key]);

    await recordAudit(pool, {
      entity: "parameter",
      entityId: key,
      action: "DELETE",
      oldValue: before.value,
      newValue: null,
      userId: req.user!.id,
      ipAddress: req.ip
    });

    res.status(204).send();
  })
);
