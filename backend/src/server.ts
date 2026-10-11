import { app } from "./app.js";
import { env } from "./config/env.js";
import { runMigrations } from "./db/migrate.js";
import { idempotencyStore } from "./middlewares/idempotent.js";
import { recalculateAlerts } from "./modules/alerts/alerts.service.js";

// Sin top-level await: el hosting carga este archivo con require().
const ready = env.AUTO_MIGRATE ? runMigrations() : Promise.resolve();

ready
  .then(() => {
    app.listen(env.PORT, () => {
      console.log(`Backend cooperativa escuchando en puerto ${env.PORT}`);
    });
  })
  .catch((err) => {
    console.error("No se pudo iniciar el backend", err);
    process.exit(1);
  });

// Limpieza de claves de idempotencia vencidas (cada hora).
setInterval(() => {
  idempotencyStore.purgeExpired().catch((err) => console.error("Limpieza de idempotency_keys falló", err));
}, 60 * 60 * 1000).unref();

// Job diario de mora/alertas (equivale al Vercel Cron). 11:00 UTC = 06:00
// Colombia. Revisa cada 10 min y corre una sola vez por día.
if (env.INTERNAL_CRON) {
  let lastRunDay = "";
  setInterval(async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== 11 || day === lastRunDay) return;
    lastRunDay = day;
    try {
      const result = await recalculateAlerts();
      console.log("Job diario de alertas:", JSON.stringify(result));
    } catch (err) {
      console.error("Job diario de alertas falló", err);
    }
  }, 10 * 60 * 1000);
}
