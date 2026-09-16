import { Router } from "express";
import { pool } from "../../db/pool.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { paginationQuery } from "../../shared/schemas.js";

export const auditRouter = Router();
auditRouter.use(requireAuth, requirePermission("audit:read"));

auditRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationQuery.parse(req.query);
    const entity = req.query.entity as string | undefined;
    const offset = (page - 1) * pageSize;
    const where = entity ? `WHERE entity = ?` : "";
    const args = entity ? [entity] : [];

    const [rows] = await pool.query<any[]>(
      `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, offset]
    );
    const [countRows] = await pool.query<any[]>(`SELECT COUNT(*) as total FROM audit_logs ${where}`, args);
    res.json({ data: rows, page, pageSize, total: (countRows as any[])[0].total });
  })
);
