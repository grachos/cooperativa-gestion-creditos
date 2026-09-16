import { Router } from "express";
import { pool } from "../../db/pool.js";
import { idParam, paginationQuery } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { registerSseClient } from "./sse.hub.js";
import { recalculateAlerts } from "./alerts.service.js";

export const alertsRouter = Router();

alertsRouter.get("/stream", requireAuth, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.write("retry: 3000\n\n");
  registerSseClient(req.user!.id, res);
});

alertsRouter.use(requireAuth);

alertsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationQuery.parse(req.query);
    const status = (req.query.status as string) || "ABIERTA";
    const priority = req.query.priority as string | undefined;
    const offset = (page - 1) * pageSize;

    const conditions = ["a.status = ?"];
    const args: unknown[] = [status];
    if (priority) {
      conditions.push("a.priority = ?");
      args.push(priority);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;

    const [rows] = await pool.query<any[]>(
      `SELECT a.*, c.credit_number FROM alerts a
       LEFT JOIN credits c ON c.id = a.credit_id
       ${where} ORDER BY a.priority DESC, a.created_at DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, offset]
    );
    const [countRows] = await pool.query<any[]>(`SELECT COUNT(*) as total FROM alerts a ${where}`, args);
    res.json({ data: rows, page, pageSize, total: (countRows as any[])[0].total });
  })
);

alertsRouter.post(
  "/:id/resolve",
  requirePermission("alerts:write"),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [rows] = await pool.query<any[]>(`SELECT id FROM alerts WHERE id = ?`, [id]);
    if ((rows as any[]).length === 0) throw new HttpError(404, "Alerta no encontrada");
    await pool.query(`UPDATE alerts SET status = 'ATENDIDA', resolved_at = NOW() WHERE id = ?`, [id]);
    res.json({ id, status: "ATENDIDA" });
  })
);

alertsRouter.post(
  "/recalculate",
  requirePermission("alerts:write"),
  asyncHandler(async (_req, res) => {
    const result = await recalculateAlerts();
    res.json(result);
  })
);
