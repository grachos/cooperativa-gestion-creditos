import { env } from "../config/env.js";
import { createIdempotency } from "./idempotency.js";
import { MysqlIdempotencyStore } from "./idempotency.mysql.js";

export const idempotencyStore = new MysqlIdempotencyStore();

/**
 * Middleware `idempotent("operacion")` listo para usar en las rutas de
 * escritura vulnerables a duplicados. Ver middlewares/idempotency.ts.
 * Vigencia y espera: IDEMPOTENCY_TTL_HOURS e IDEMPOTENCY_WAIT_MS (config/env.ts).
 */
export const idempotent = createIdempotency({
  store: idempotencyStore,
  ttlSeconds: Math.round(env.IDEMPOTENCY_TTL_HOURS * 3600),
  waitMs: env.IDEMPOTENCY_WAIT_MS
});
