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

const updateSchema = z.object({ value: z.unknown(), reason: z.string().optional() });

parametersRouter.put(
  "/:key",
  requirePermission("parameters:write"),
  asyncHandler(async (req, res) => {
    const key = z.string().min(1).parse(req.params.key);
    const { value, reason } = updateSchema.parse(req.body);

    const [rows] = await pool.query<any[]>(`SELECT * FROM parameters WHERE \`key\` = ?`, [key]);
    const before = (rows as any[])[0];
    if (!before) throw new HttpError(404, "Parámetro no encontrado");

    await pool.query(`UPDATE parameters SET value = ?, updated_by = ? WHERE \`key\` = ?`, [
      JSON.stringify(value),
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
