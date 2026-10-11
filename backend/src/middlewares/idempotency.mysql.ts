import { pool } from "../db/pool.js";
import type { IdempotencyRecord, IdempotencyScope, IdempotencyStore } from "./idempotency.js";

const ER_DUP_ENTRY = 1062;

function toRecord(row: any): IdempotencyRecord {
  return {
    id: String(row.id),
    requestHash: row.request_hash,
    state: row.state,
    responseStatus: row.response_status === null ? null : Number(row.response_status),
    responseBody: row.response_body,
    responseContentType: row.response_content_type,
    expired: Boolean(Number(row.expired))
  };
}

const SELECT_COLUMNS = `id, request_hash, state, response_status, response_body, response_content_type,
  (expires_at <= NOW()) AS expired`;

/**
 * Store MySQL. La serialización de peticiones simultáneas la da la llave única
 * (user_id, operation, idempotency_key): solo un INSERT gana. Todos los
 * tiempos se calculan con NOW() de la base (la sesión corre en UTC).
 */
export class MysqlIdempotencyStore implements IdempotencyStore {
  async find(scope: IdempotencyScope) {
    const [rows] = await pool.query<any[]>(
      `SELECT ${SELECT_COLUMNS} FROM idempotency_keys
       WHERE user_id = ? AND operation = ? AND idempotency_key = ?`,
      [scope.userId, scope.operation, scope.key]
    );
    const row = (rows as any[])[0];
    if (!row) return null;
    const record = toRecord(row);
    return record.expired ? null : record;
  }

  async begin(scope: IdempotencyScope, requestHash: string, ttlSeconds: number) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const [result] = await pool.query<any>(
          `INSERT INTO idempotency_keys (user_id, operation, idempotency_key, request_hash, state, expires_at)
           VALUES (?, ?, ?, ?, 'IN_PROGRESS', DATE_ADD(NOW(), INTERVAL ? SECOND))`,
          [scope.userId, scope.operation, scope.key, requestHash, ttlSeconds]
        );
        return { created: true as const, id: String(result.insertId) };
      } catch (err: any) {
        if (err?.errno !== ER_DUP_ENTRY) throw err;
      }

      const [rows] = await pool.query<any[]>(
        `SELECT ${SELECT_COLUMNS} FROM idempotency_keys
         WHERE user_id = ? AND operation = ? AND idempotency_key = ?`,
        [scope.userId, scope.operation, scope.key]
      );
      const row = (rows as any[])[0];
      if (!row) continue; // se liberó entre el INSERT y el SELECT: reintentar
      const record = toRecord(row);
      if (!record.expired) return { created: false as const, existing: record };

      // Vencida: se borra (atómico; solo uno de los concurrentes la borra) y se reintenta.
      await pool.query(`DELETE FROM idempotency_keys WHERE id = ? AND expires_at <= NOW()`, [row.id]);
    }
    throw new Error("No se pudo reservar la clave de idempotencia");
  }

  async complete(id: string, status: number, body: string, contentType: string | null) {
    await pool.query(
      `UPDATE idempotency_keys
       SET state = 'COMPLETED', response_status = ?, response_body = ?, response_content_type = ?, completed_at = NOW()
       WHERE id = ?`,
      [status, body, contentType, id]
    );
  }

  async release(id: string) {
    await pool.query(`DELETE FROM idempotency_keys WHERE id = ? AND state = 'IN_PROGRESS'`, [id]);
  }

  async purgeExpired() {
    const [result] = await pool.query<any>(`DELETE FROM idempotency_keys WHERE expires_at <= NOW()`);
    return Number(result.affectedRows ?? 0);
  }
}
