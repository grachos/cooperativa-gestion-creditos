import { Router } from "express";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { requireAuth, requirePermission } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { instanceId, sseHub } from "../alerts/sse.hub.js";
import { reportCache } from "../reports/reportCache.js";
import { metrics } from "../../utils/metrics.js";

export const adminRouter = Router();

/**
 * Estado en caliente de ESTE proceso (memoria, retraso del event loop, latencias, pool de
 * conexiones, consultas lentas, SSE, caché de reportes). Solo quien puede ver auditoría.
 * No sustituye a un monitor externo: se reinicia cuando el hosting recicla la aplicación.
 */
adminRouter.get(
  "/metrics",
  requireAuth,
  requirePermission("audit:read"),
  asyncHandler(async (_req, res) => {
    const snap = metrics.snapshot();
    res.json({
      instance: instanceId,
      pid: process.pid,
      ...snap,
      db: { pool: { ...pool.stats(), size: env.DB_POOL_SIZE, queueLimit: env.DB_QUEUE_LIMIT }, queries: snap.queries },
      sse: { clients: sseHub.size },
      reportCache: reportCache.stats()
    });
  })
);
