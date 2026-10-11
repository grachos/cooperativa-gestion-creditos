import { describe } from "vitest";
import { defineIdempotencySuite } from "./idempotency.suite.js";

/**
 * Corre la misma suite contra MySQL/MariaDB real. Es opcional: requiere una
 * base con las migraciones aplicadas y las variables DB_* (y secretos JWT) en
 * el entorno:
 *   IDEMPOTENCY_TEST_DB=1 DB_HOST=127.0.0.1 DB_USER=... DB_PASSWORD=... DB_NAME=... \
 *   JWT_ACCESS_SECRET=xxxxxxxxxxxx JWT_REFRESH_SECRET=xxxxxxxxxxxx npm test
 */
const enabled = process.env.IDEMPOTENCY_TEST_DB === "1";

if (!enabled) {
  describe.skip("Idempotency-Key (mysql) — defina IDEMPOTENCY_TEST_DB=1 para ejecutarla", () => {});
} else {
  const { pool } = await import("../db/pool.js");
  const { MysqlIdempotencyStore } = await import("./idempotency.mysql.js");

  async function ensureUsers(): Promise<[number, number]> {
    const ids: number[] = [];
    for (const n of ["idem_test_a", "idem_test_b"]) {
      await pool.query(
        `INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, 'x', ?)
         ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)`,
        [`${n}@test.local`, n, n]
      );
      const [rows] = await pool.query<any[]>(`SELECT id FROM users WHERE username = ?`, [n]);
      ids.push((rows as any[])[0].id);
    }
    return [ids[0]!, ids[1]!];
  }
  const users = await ensureUsers();

  defineIdempotencySuite(
    "mysql",
    async () => {
      await pool.query(`DELETE FROM idempotency_keys WHERE operation LIKE 'test.%'`);
      return {
        store: new MysqlIdempotencyStore(),
        expireAll: async () => {
          await pool.query(`UPDATE idempotency_keys SET expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE operation LIKE 'test.%'`);
        }
      };
    },
    users
  );
}
