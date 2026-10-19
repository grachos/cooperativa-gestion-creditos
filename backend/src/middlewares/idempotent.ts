import type { Response } from "express";
import type { PoolConnection } from "../db/pool.js";
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

/**
 * Confirma la clave de idempotencia DENTRO de la transacción de la operación (hallazgo H8).
 *
 * Sin esto, la clave se marcaba COMPLETED después del COMMIT: si el proceso caía, se perdía la
 * conexión o fallaba algo entre el COMMIT y esa escritura, el efecto quedaba guardado pero la
 * clave seguía IN_PROGRESS, se liberaba con el error y el reintento con la misma clave volvía a
 * ejecutar la operación (pago duplicado). Ahora la clave y el efecto se confirman o se revierten
 * juntos. Se llama como última sentencia de la transacción, con el mismo estado y cuerpo que luego
 * se envía con `res.status(status).json(body)`. Sin Idempotency-Key no hace nada.
 */
export async function completeIdempotencyInTransaction(
  conn: PoolConnection,
  res: Response,
  status: number,
  body: unknown
): Promise<void> {
  const id = res.locals.idempotencyKeyId as string | undefined;
  if (!id) return;
  await conn.query(
    `UPDATE idempotency_keys
     SET state = 'COMPLETED', response_status = ?, response_body = ?, response_content_type = ?, completed_at = NOW()
     WHERE id = ?`,
    [status, JSON.stringify(body), "application/json; charset=utf-8", id]
  );
  res.locals.idempotencyCommitted = true;
}
