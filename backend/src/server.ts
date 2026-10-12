import { app } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { idempotencyStore } from "./middlewares/idempotent.js";
import { instanceId, purgeRealtimeEvents, sseHub } from "./modules/alerts/sse.hub.js";
import { runDailyAlertsJob } from "./modules/alerts/alerts.service.js";
import { passwordImplementationName } from "./utils/password.js";

// Sin top-level await: el hosting carga este archivo con require().
const ready = env.AUTO_MIGRATE ? runMigrations() : Promise.resolve();

ready
  .then(() => {
    const server = app.listen(env.PORT, () => {
      console.log(`Backend cooperativa escuchando en puerto ${env.PORT} (pid ${process.pid}, instancia ${instanceId})`);
    });
    // Corta clientes lentos que nunca terminan de enviar la petición (no afecta a SSE,
    // que es una respuesta larga).
    server.requestTimeout = env.REQUEST_TIMEOUT_MS;
    server.headersTimeout = Math.min(30_000, env.REQUEST_TIMEOUT_MS);
    void passwordImplementationName().then((name) => console.log(`[password] hash de contraseñas: ${name}`));

    // Apagado ordenado: al reiniciar (cada despliegue) se cierran las conexiones SSE y se
    // devuelven las conexiones MySQL en vez de dejarlas colgadas hasta su timeout.
    let closing = false;
    const shutdown = (signal: string) => {
      if (closing) return;
      closing = true;
      console.log(`[server] ${signal}: apagando`);
      sseHub.stop();
      server.close(() => void pool.end().finally(() => process.exit(0)));
      setTimeout(() => process.exit(0), 10_000).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })
  .catch((err) => {
    console.error("No se pudo iniciar el backend", err);
    process.exit(1);
  });

// Limpieza horaria de tablas de vida corta (vencidas): claves de idempotencia y eventos en vivo.
setInterval(() => {
  idempotencyStore.purgeExpired().catch((err) => console.error("Limpieza de idempotency_keys falló", err));
  purgeRealtimeEvents().catch((err) => console.error("Limpieza de realtime_events falló", err));
}, 60 * 60 * 1000).unref();

// Job diario de mora/alertas (equivale al Vercel Cron). 11:00 UTC = 06:00 Colombia.
// Todos los procesos revisan cada 10 min, pero la reserva (job_runs) hace que lo ejecute
// UNO solo por día aunque haya varios procesos Node.
if (env.INTERNAL_CRON) {
  setInterval(async () => {
    const now = new Date();
    if (now.getUTCHours() !== 11) return;
    try {
      const result = await runDailyAlertsJob(now);
      if (result.ran) console.log("Job diario de alertas:", JSON.stringify(result));
    } catch (err) {
      console.error("Job diario de alertas falló", err);
    }
  }, 10 * 60 * 1000).unref();
}
