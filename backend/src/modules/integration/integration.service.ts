import type { PoolLike } from "../../db/pool.js";
import crypto from "node:crypto";

/**
 * Encola un evento contable usando el patrón Outbox: se inserta en la misma
 * transacción de negocio y un proceso posterior (o el endpoint /replay)
 * se encarga de "enviarlo" al software contable externo. En esta demo no
 * existe todavía el adaptador real: los eventos quedan en estado PENDIENTE
 * y pueden exportarse como CSV/JSON.
 */
export async function enqueueIntegrationEvent(
  conn: PoolLike,
  eventType: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string
) {
  const key = idempotencyKey ?? `${eventType}:${crypto.randomUUID()}`;
  await conn.query(
    `INSERT INTO integration_events (event_type, idempotency_key, payload, status)
     VALUES (?, ?, ?, 'PENDIENTE')
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [eventType, key, JSON.stringify(payload)]
  );
}
