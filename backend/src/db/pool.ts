import mysql from "mysql2/promise";
import type { PoolConnection as MysqlConnection } from "mysql2/promise";
import { env } from "../config/env.js";

/**
 * Pool de MySQL/MariaDB (Hostinger). Expone la misma interfaz que usa todo el
 * proyecto: `pool.query(sql, params)` devuelve `[rows, fields]` y
 * `getConnection()` entrega begin/commit/rollback/release.
 *
 *  - Fechas y DATE/TIMESTAMP como string crudo (`dateStrings`), para que un
 *    DATE no se desplace de día al serializarse en otra zona horaria.
 *  - DECIMAL llega como string (el código ya lo convierte con Number()).
 *  - BOOLEAN (TINYINT(1)) se devuelve como true/false.
 *  - La sesión corre en UTC y con ANSI_QUOTES + PIPES_AS_CONCAT, de modo que
 *    los alias entre comillas dobles y el operador `||` de las consultas
 *    funcionan igual que en el resto del código.
 */
const mysqlPool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
  dateStrings: true,
  timezone: "Z",
  typeCast(field, next) {
    if (field.type === "TINY" && field.length === 1) {
      const v = field.string();
      return v === null ? null : v === "1";
    }
    return next();
  }
});

mysqlPool.pool.on("connection", (conn) => {
  conn.query(
    "SET time_zone = '+00:00', sql_mode = CONCAT(@@sql_mode, ',ANSI_QUOTES,PIPES_AS_CONCAT')"
  );
});

type QueryResultTuple<T> = [T, unknown[]];

async function runQuery<T>(
  executor: { query: (sql: string, params?: unknown[]) => Promise<any> },
  sql: string,
  params?: unknown[]
): Promise<QueryResultTuple<T>> {
  const [result, fields] = await executor.query(sql, params);
  return [result as T, (fields ?? []) as unknown[]];
}

export interface PoolConnection {
  query<T>(sql: string, params?: unknown[]): Promise<QueryResultTuple<T>>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export const pool = {
  query<T>(sql: string, params?: unknown[]): Promise<QueryResultTuple<T>> {
    return runQuery<T>(mysqlPool, sql, params);
  },
  async getConnection(): Promise<PoolConnection> {
    const conn: MysqlConnection = await mysqlPool.getConnection();
    return {
      query: <T>(sql: string, params?: unknown[]) => runQuery<T>(conn, sql, params),
      beginTransaction: () => conn.beginTransaction(),
      commit: () => conn.commit(),
      rollback: () => conn.rollback(),
      release: () => conn.release()
    };
  },
  end(): Promise<void> {
    return mysqlPool.end();
  }
};

export type PoolLike = typeof pool | PoolConnection;

export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
