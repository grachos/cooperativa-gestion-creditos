import type { PoolLike } from "../../db/pool.js";

export async function recordAudit(
  conn: PoolLike,
  params: {
    entity: string;
    entityId: string | number;
    action: string;
    oldValue?: unknown;
    newValue?: unknown;
    userId?: number | null;
    ipAddress?: string | null;
    reason?: string | null;
  }
) {
  await conn.query(
    `INSERT INTO audit_logs (entity, entity_id, action, old_value, new_value, user_id, ip_address, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.entity,
      String(params.entityId),
      params.action,
      params.oldValue ? JSON.stringify(params.oldValue) : null,
      params.newValue ? JSON.stringify(params.newValue) : null,
      params.userId ?? null,
      params.ipAddress ?? null,
      params.reason ?? null
    ]
  );
}
