import type { Pool, PoolConnection } from "mysql2/promise";
import crypto from "node:crypto";

/**
 * Encola un evento contable usando el patrón Outbox: se inserta en la misma
 * transacción de negocio y un proceso posterior (o el endpoint /replay)
 * se encarga de "enviarlo" al software contable externo. En esta demo no
 * existe todavía el adaptador real: los eventos quedan en estado PENDIENTE
 * y pueden exportarse como CSV/JSON.
 */
export async function enqueueIntegrationEvent(
  conn: Pool | PoolConnection,
  eventType: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string
) {
  const key = idempotencyKey ?? `${eventType}:${crypto.randomUUID()}`;
  await conn.query(
    `INSERT INTO integration_events (event_type, idempotency_key, payload, status)
     VALUES (?, ?, ?, 'PENDIENTE')
     ON DUPLICATE KEY UPDATE id = id`,
    [eventType, key, JSON.stringify(payload)]
  );
}
