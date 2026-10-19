import mysql from "mysql2/promise";
import type { PoolConnection as MysqlConnection } from "mysql2/promise";
import { env } from "../config/env.js";
import { recordQueryTiming } from "../utils/queryTiming.js";

/**
 * Pool de MySQL/MariaDB (Hostinger). Tamaño y cola: DB_POOL_SIZE / DB_QUEUE_LIMIT. Expone la misma interfaz que usa todo el
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
  connectionLimit: env.DB_POOL_SIZE,
  // Sin esto la cola de espera era ilimitada: con la base lenta, las peticiones
  // se acumulaban sin fin. Pasado el límite, mysql2 rechaza (se responde 503).
  queueLimit: env.DB_QUEUE_LIMIT,
  connectTimeout: env.DB_CONNECT_TIMEOUT_MS,
  enableKeepAlive: true,
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
  const started = process.hrtime.bigint();
  try {
    const [result, fields] = await executor.query(sql, params);
    return [result as T, (fields ?? []) as unknown[]];
  } finally {
    recordQueryTiming(Number(process.hrtime.bigint() - started) / 1e6, sql, env.SLOW_QUERY_MS);
  }
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
  },
  /** Estado del pool (campos internos de mysql2; si cambian, devuelve null en vez de fallar). */
  stats(): { total: number | null; free: number | null; queued: number | null } {
    try {
      const p = (mysqlPool as any).pool;
      return { total: p._allConnections.length, free: p._freeConnections.length, queued: p._connectionQueue.length };
    } catch {
      return { total: null, free: null, queued: null };
    }
  }
};

export type PoolLike = typeof pool | PoolConnection;

const DEADLOCK_ERRNO = 1213;
const DEADLOCK_RETRIES = 2;

/**
 * Transacción con rollback ante cualquier error. Si MySQL la elige como víctima de un deadlock (1213), toda la
 * transacción ya se deshizo, así que se reintenta desde el principio (hasta 2 veces, con una pausa corta al azar)
 * en vez de responder 500. Por eso `fn` debe hacer solo trabajo de base de datos: nada externo (correos,
 * eventos en vivo) dentro de la transacción.
 */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err: any) {
      await conn.rollback().catch(() => undefined);
      if (err?.errno === DEADLOCK_ERRNO && attempt < DEADLOCK_RETRIES) {
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 80));
        continue;
      }
      throw err;
    } finally {
      conn.release();
    }
  }
}

/**
 * Ejecuta sentencias sueltas (autocommit) en una conexión con aislamiento READ COMMITTED y la devuelve al pool
 * en REPEATABLE READ. Para procesos masivos que escriben sin bloquear créditos (job de alertas): en
 * REPEATABLE READ, un `UPDATE … WHERE EXISTS (SELECT … cuotas)` deja bloqueos compartidos de rango sobre las
 * cuotas y choca en deadlock con un pago o reverso que tiene el crédito y quiere escribir esas cuotas.
 */
export async function withReadCommitted<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
    return await fn(conn);
  } finally {
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ").catch(() => undefined);
    conn.release();
  }
}
