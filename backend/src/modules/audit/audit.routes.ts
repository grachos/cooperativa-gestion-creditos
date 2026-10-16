import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { paginationQuery } from "../../shared/schemas.js";
import { csvRaw, csvText } from "../../utils/csv.js";

export const auditRouter = Router();
auditRouter.use(requireAuth, requirePermission("audit:read"));

const filtersSchema = z.object({
  entity: z.string().max(60).optional(),
  action: z.string().max(60).optional(),
  userId: z.coerce.number().int().positive().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional()
});

/** Filtros del reporte "Actividad por usuario": quién, qué, sobre qué y cuándo. */
function buildWhere(query: unknown) {
  const parsed = filtersSchema.safeParse(query);
  if (!parsed.success) throw new HttpError(400, "Filtros inválidos (fechas AAAA-MM-DD)");
  const f = parsed.data;
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (f.entity) {
    conditions.push(`a.entity = ?`);
    args.push(f.entity);
  }
  if (f.action) {
    conditions.push(`a.action = ?`);
    args.push(f.action);
  }
  if (f.userId) {
    conditions.push(`a.user_id = ?`);
    args.push(f.userId);
  }
  if (f.from) {
    conditions.push(`a.created_at >= ?`);
    args.push(`${f.from} 00:00:00`);
  }
  if (f.to) {
    conditions.push(`a.created_at < DATE_ADD(?, INTERVAL 1 DAY)`);
    args.push(f.to);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", args };
}

auditRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationQuery.parse(req.query);
    const { where, args } = buildWhere(req.query);
    const offset = (page - 1) * pageSize;

    const [rows] = await pool.query<any[]>(
      `SELECT a.*, u.full_name AS user_name FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, offset]
    );
    const [countRows] = await pool.query<any[]>(`SELECT COUNT(*) as total FROM audit_logs a ${where}`, args);
    res.json({ data: rows, page, pageSize, total: (countRows as any[])[0].total });
  })
);

/** Valores para los filtros de la pantalla (acciones y entidades que existen). */
auditRouter.get(
  "/filters",
  asyncHandler(async (_req, res) => {
    const [actions] = await pool.query<any[]>(`SELECT DISTINCT action FROM audit_logs ORDER BY action ASC`);
    const [entities] = await pool.query<any[]>(`SELECT DISTINCT entity FROM audit_logs ORDER BY entity ASC`);
    const [users] = await pool.query<any[]>(
      `SELECT DISTINCT u.id, u.full_name FROM audit_logs a JOIN users u ON u.id = a.user_id ORDER BY u.full_name ASC`
    );
    res.json({
      actions: (actions as any[]).map((r) => r.action),
      entities: (entities as any[]).map((r) => r.entity),
      users
    });
  })
);

const MAX_EXPORT_ROWS = 50_000;

auditRouter.get(
  "/export.csv",
  asyncHandler(async (req, res) => {
    const { where, args } = buildWhere(req.query);
    const [rows] = await pool.query<any[]>(
      `SELECT a.id, a.created_at, u.full_name AS user_name, a.entity, a.entity_id, a.action, a.reason, a.ip_address
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
      [...args, MAX_EXPORT_ROWS]
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="actividad.csv"');
    const lines = ["id,fecha,usuario,entidad,id_entidad,accion,motivo,ip"];
    for (const r of rows as any[]) {
      lines.push(
        [
          csvRaw(r.id),
          csvText(r.created_at),
          csvText(r.user_name ?? ""),
          csvText(r.entity),
          csvText(r.entity_id),
          csvText(r.action),
          csvText(r.reason ?? ""),
          csvText(r.ip_address ?? "")
        ].join(",")
      );
    }
    res.send(`﻿${lines.join("\n")}\n`);
  })
);
