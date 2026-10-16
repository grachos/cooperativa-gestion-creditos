import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { paginationQuery } from "../../shared/schemas.js";
import { csvRaw, csvText } from "../../utils/csv.js";
import { describeAudit, resolveEntities } from "./audit.describe.js";

export const auditRouter = Router();
auditRouter.use(requireAuth, requirePermission("audit:read"));

const filtersSchema = z.object({
  entity: z.string().max(60).optional(),
  // Una o varias acciones separadas por coma (p. ej. "APPROVE,REJECT").
  action: z.string().max(200).optional(),
  userId: z.coerce.number().int().positive().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  // Historial de un crédito (número CR-… o id), de una solicitud o de un asociado.
  credit: z.string().trim().max(40).optional(),
  application: z.coerce.number().int().positive().optional(),
  associate: z.coerce.number().int().positive().optional(),
  // Búsqueda libre: motivo, detalle, usuario o número de registro.
  q: z.string().trim().max(80).optional()
});

/** Filtros del visor "Actividad por usuario": quién, qué, sobre qué, cuándo y de qué crédito/solicitud/persona. */
async function buildWhere(query: unknown) {
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
    const actions = f.action.split(",").map((x) => x.trim()).filter(Boolean);
    if (actions.length) {
      conditions.push(`a.action IN (?)`);
      args.push(actions);
    }
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
  if (f.application) {
    conditions.push(`(a.entity = 'credit_application' AND a.entity_id = ?)`);
    args.push(String(f.application));
  }
  if (f.associate) {
    conditions.push(`(a.entity = 'associate' AND a.entity_id = ?)`);
    args.push(String(f.associate));
  }
  if (f.credit) {
    const [rows] = await pool.query<any[]>(
      `SELECT id, credit_application_id FROM credits WHERE credit_number = ? OR id = ? LIMIT 1`,
      [f.credit, /^\d+$/.test(f.credit) ? Number(f.credit) : 0]
    );
    const credit = (rows as any[])[0];
    if (!credit) {
      conditions.push(`1 = 0`); // crédito inexistente: sin resultados
    } else {
      // Todo lo que le pasó al crédito: el crédito mismo, su solicitud, sus pagos, ajustes y gestiones.
      // Los ids se leen aparte (en vez de una subconsulta con CAST) para no mezclar intercalaciones de texto.
      const idsOf = async (table: string) => {
        const [r] = await pool.query<any[]>(`SELECT id FROM ${table} WHERE credit_id = ?`, [credit.id]);
        const ids = (r as any[]).map((x) => String(x.id));
        return ids.length ? ids : ["-"];
      };
      const [payments, adjustments, actions] = await Promise.all([
        idsOf("payments"),
        idsOf("credit_adjustments"),
        idsOf("collection_actions")
      ]);
      conditions.push(
        `((a.entity = 'credit' AND a.entity_id = ?)
          OR (a.entity = 'credit_application' AND a.entity_id = ?)
          OR (a.entity = 'payment' AND a.entity_id IN (?))
          OR (a.entity = 'credit_adjustment' AND a.entity_id IN (?))
          OR (a.entity = 'collection_action' AND a.entity_id IN (?)))`
      );
      args.push(String(credit.id), String(credit.credit_application_id), payments, adjustments, actions);
    }
  }
  if (f.q) {
    conditions.push(`(a.reason LIKE ? OR a.new_value LIKE ? OR a.entity_id = ? OR u.full_name LIKE ?)`);
    args.push(`%${f.q}%`, `%${f.q}%`, f.q, `%${f.q}%`);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", args };
}

auditRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationQuery.parse(req.query);
    const { where, args } = await buildWhere(req.query);
    const offset = (page - 1) * pageSize;

    const [rows] = await pool.query<any[]>(
      `SELECT a.*, u.full_name AS user_name FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, offset]
    );
    const [countRows] = await pool.query<any[]>(
      `SELECT COUNT(*) as total FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${where}`,
      args
    );
    const refs = await resolveEntities(pool, rows as any[]);
    const data = (rows as any[]).map((r) => {
      const ref = refs.get(`${r.entity}:${r.entity_id}`);
      return { ...r, summary: describeAudit(r), entity_label: ref?.label ?? null, link: ref?.link ?? null };
    });
    res.json({ data, page, pageSize, total: (countRows as any[])[0].total });
  })
);

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
    const { where, args } = await buildWhere(req.query);
    const [rows] = await pool.query<any[]>(
      `SELECT a.id, a.created_at, u.full_name AS user_name, a.entity, a.entity_id, a.action, a.reason, a.ip_address, a.old_value, a.new_value
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
      [...args, MAX_EXPORT_ROWS]
    );
    const refs = await resolveEntities(pool, rows as any[]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="actividad.csv"');
    const lines = ["id,fecha,usuario,accion,detalle,sobre,motivo,ip"];
    for (const r of rows as any[]) {
      lines.push(
        [
          csvRaw(r.id),
          csvText(r.created_at),
          csvText(r.user_name ?? ""),
          csvText(r.action),
          csvText(describeAudit(r)),
          csvText(refs.get(`${r.entity}:${r.entity_id}`)?.label ?? `${r.entity} #${r.entity_id}`),
          csvText(r.reason ?? ""),
          csvText(r.ip_address ?? "")
        ].join(",")
      );
    }
    res.send(`﻿${lines.join("\n")}\n`);
  })
);
