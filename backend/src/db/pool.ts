import pg from "pg";
import { env } from "../config/env.js";

// A diferencia de mysql2 con `dateStrings: true`, pg por defecto parsea
// DATE/TIMESTAMP a objetos Date de JS. Para una columna DATE (sin hora),
// esto puede desplazar el día al serializar en una zona horaria distinta a
// UTC (ej. "2026-09-19" -> medianoche UTC -> 18 de septiembre en Bogotá).
// Se devuelven como el string crudo que manda Postgres, igual que antes.
pg.types.setTypeParser(pg.types.builtins.DATE, (val: string) => val);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (val: string) => val);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (val: string) => val);

// mysql2 devolvía COUNT(*)/BIGINT como number de JS; pg los devuelve como
// string por defecto (para no perder precisión más allá de Number.MAX_SAFE_
// INTEGER). Nuestros conteos nunca se acercan a ese límite, así que se
// parsean como número para no romper aritmética como `total + 1`.
pg.types.setTypeParser(pg.types.builtins.INT8, (val: string) => Number(val));

/**
 * Compatibilidad con la interfaz que usaba mysql2 (`pool.query(sql, params)`
 * devolviendo `[rows, fields]`, `pool.getConnection()` con
 * begin/commit/rollback/release) para no tener que reescribir cada consulta
 * del proyecto al migrar de MySQL a Postgres (Supabase). Traduce:
 *  - Placeholders `?` → `$1, $2, ...` (respetando cadenas entre comillas).
 *  - Comillas invertidas `` ` `` de identificadores → comillas dobles.
 *  - INSERT INTO <tabla> sin RETURNING → agrega `RETURNING id` (salvo en
 *    las tablas de solo llave compuesta, que no tienen columna `id`), y
 *    expone `result.insertId` igual que mysql2.
 */

const NO_ID_TABLES = new Set(["role_permissions", "user_roles", "schema_migrations"]);

function translateSql(sql: string): string {
  let out = "";
  let paramIndex = 0;
  let inSingle = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inSingle) inSingle = true;
    else if (ch === "'" && inSingle) inSingle = false;

    if (!inSingle && ch === "`") {
      out += '"';
    } else if (!inSingle && ch === "?") {
      paramIndex++;
      out += `$${paramIndex}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function maybeAddReturningId(sql: string): string {
  const trimmed = sql.trim();
  if (!/^insert\s+into/i.test(trimmed)) return sql;
  if (/returning/i.test(trimmed)) return sql;
  const match = trimmed.match(/^insert\s+into\s+"?(\w+)"?/i);
  const table = match?.[1];
  if (table && NO_ID_TABLES.has(table)) return sql;
  return `${trimmed.replace(/;\s*$/, "")} RETURNING id`;
}

type QueryResultTuple<T> = [T, unknown[]];

function shapeResult<T>(sql: string, pgResult: pg.QueryResult): QueryResultTuple<T> {
  const trimmed = sql.trim();
  if (/^select/i.test(trimmed) || /^with/i.test(trimmed)) {
    return [pgResult.rows as unknown as T, []];
  }
  if (/^insert/i.test(trimmed)) {
    const first = pgResult.rows[0] ?? {};
    const resultObj = { ...first, insertId: (first as any).id, affectedRows: pgResult.rowCount ?? 0 };
    return [resultObj as unknown as T, []];
  }
  return [{ affectedRows: pgResult.rowCount ?? 0 } as unknown as T, []];
}

async function runQuery<T>(
  executor: { query: (text: string, params?: unknown[]) => Promise<pg.QueryResult> },
  sql: string,
  params?: unknown[]
): Promise<QueryResultTuple<T>> {
  const withReturning = maybeAddReturningId(sql);
  const translated = translateSql(withReturning);
  const pgResult = await executor.query(translated, params);
  return shapeResult<T>(sql, pgResult);
}

const ssl = env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined;

const pgPool = new pg.Pool(
  env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL, ssl }
    : {
        host: env.DB_HOST,
        port: env.DB_PORT,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
        ssl
      }
);

export interface PoolConnection {
  query<T>(sql: string, params?: unknown[]): Promise<QueryResultTuple<T>>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export const pool = {
  query<T>(sql: string, params?: unknown[]): Promise<QueryResultTuple<T>> {
    return runQuery<T>(pgPool, sql, params);
  },
  async getConnection(): Promise<PoolConnection> {
    const client = await pgPool.connect();
    return {
      query: <T>(sql: string, params?: unknown[]) => runQuery<T>(client, sql, params),
      beginTransaction: () => client.query("BEGIN").then(() => undefined),
      commit: () => client.query("COMMIT").then(() => undefined),
      rollback: () => client.query("ROLLBACK").then(() => undefined),
      release: () => client.release()
    };
  },
  end(): Promise<void> {
    return pgPool.end();
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
