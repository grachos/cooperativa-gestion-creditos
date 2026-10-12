import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { instanceId } from "./modules/alerts/sse.hub.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { associatesRouter } from "./modules/associates/associates.routes.js";
import { societiesRouter } from "./modules/societies/societies.routes.js";
import { applicationsRouter } from "./modules/applications/applications.routes.js";
import { creditsRouter } from "./modules/credits/credits.routes.js";
import { paymentsRouter } from "./modules/payments/payments.routes.js";
import { alertsRouter } from "./modules/alerts/alerts.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";
import { parametersRouter } from "./modules/parameters/parameters.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { integrationRouter } from "./modules/integration/integration.routes.js";
import { adjustmentsRouter } from "./modules/credits/adjustments.routes.js";
import { collectionsRouter } from "./modules/collections/collections.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { adminRouter } from "./modules/admin/metrics.routes.js";
import { createRequestLog } from "./middlewares/requestLog.js";

export const app = express();

// Detrás del proxy de Vercel: sin esto req.ip es la IP del proxy y la
// auditoría/registro de accesos guarda la misma IP para todos.
app.set("trust proxy", 1);
// Primero de todo: asigna X-Request-Id y registra respuestas 5xx / lentas (ver middlewares/requestLog.ts).
app.use(createRequestLog({ mode: env.REQUEST_LOG, slowMs: env.SLOW_REQUEST_MS, instanceId }));
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// Salud: verifica la base de datos (antes devolvía "ok" fijo aunque la base estuviera caída).
// `instance` identifica al proceso: si en logs o respuestas aparecen varios, hay varios procesos.
app.get("/health", async (_req, res) => {
  const startedAt = process.uptime();
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000).unref())
    ]);
    res.json({ status: "ok", db: "ok", instance: instanceId, uptimeSec: Math.round(startedAt) });
  } catch {
    res.status(503).json({ status: "degraded", db: "error", instance: instanceId, uptimeSec: Math.round(startedAt) });
  }
});

// La API devuelve datos por usuario y datos personales: nunca debe guardarse en una
// caché compartida (navegador, CDN o LiteSpeed Cache de Hostinger).
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Límite por IP en autenticación (complementa el bloqueo por cuenta del
// login): frena la prueba de contraseñas en muchas cuentas y el abuso del
// correo de restablecimiento.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." }
});
app.use("/api/v1/auth/login", authLimiter);
app.use("/api/v1/auth/forgot-password", authLimiter);
app.use("/api/v1/auth/reset-password", authLimiter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/associates", associatesRouter);
app.use("/api/v1/societies", societiesRouter);
app.use("/api/v1/applications", applicationsRouter);
app.use("/api/v1/credits", creditsRouter);
app.use("/api/v1/credits", adjustmentsRouter);
app.use("/api/v1/credits", collectionsRouter);
app.use("/api/v1/payments", paymentsRouter);
app.use("/api/v1/alerts", alertsRouter);
app.use("/api/v1/reports", reportsRouter);
app.use("/api/v1/parameters", parametersRouter);
app.use("/api/v1/audit", auditRouter);
app.use("/api/v1/integration", integrationRouter);
app.use("/api/v1/users", usersRouter);
app.use("/api/v1/admin", adminRouter);

// Frontend compilado (SPA): lo sirve el mismo proceso cuando STATIC_DIR existe.
// Por defecto busca ../frontend/dist relativo al backend compilado.
const staticDir = path.resolve(
  env.STATIC_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/dist")
);
if (fs.existsSync(path.join(staticDir, "index.html"))) {
  // Los archivos de /assets llevan hash en el nombre: nunca cambian, se pueden
  // cachear un año. El resto (logo, etc.) se revalida.
  app.use(
    "/assets",
    express.static(path.join(staticDir, "assets"), { immutable: true, maxAge: "1y" })
  );
  app.use(express.static(staticDir, { index: false, maxAge: "1h" }));

  // index.html NUNCA se cachea: referencia los archivos con hash del despliegue
  // actual. Si un navegador conserva uno viejo, pide JS que ya no existe y la
  // pantalla queda en blanco hasta recargar.
  const sendIndex = (_req: express.Request, res: express.Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(staticDir, "index.html"));
  };
  // Solo las rutas de la SPA (sin extensión) reciben index.html; un archivo
  // inexistente (/algo.js) debe ser un 404 real, no HTML con estado 200.
  app.get(/^\/(?!api\/)[^.]*$/, sendIndex);
}

app.use(notFoundHandler);
app.use(errorHandler);
