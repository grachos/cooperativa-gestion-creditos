import { pool } from "../db/pool.js";

/**
 * Exclusión mutua entre procesos y ejecuciones, apoyada en la base de datos
 * (GET_LOCK es un candado de MySQL por nombre, ligado a la conexión). Sirve
 * aunque haya varios procesos Node o un reinicio a mitad.
 *
 * Si otra ejecución tiene el candado, NO espera: devuelve { ran: false } para
 * que el llamador decida (el job diario se omite; el botón "Recalcular"
 * responde 409). El candado se libera solo si la conexión se cae.
 */
export async function withJobLock<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ ran: true; result: T } | { ran: false }> {
  const lockName = `coop:${name}`;
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>(`SELECT GET_LOCK(?, 0) AS got`, [lockName]);
    if (Number((rows as any[])[0]?.got) !== 1) return { ran: false };
    try {
      return { ran: true, result: await fn() };
    } finally {
      await conn.query(`SELECT RELEASE_LOCK(?)`, [lockName]).catch(() => undefined);
    }
  } finally {
    conn.release();
  }
}

/**
 * Reserva la ejecución de un job "una vez por día" entre todos los procesos:
 * solo el primero que inserta la fila (job, fecha) obtiene true.
 */
export async function claimDailyRun(job: string, date: string): Promise<boolean> {
  const [result] = await pool.query<any>(`INSERT IGNORE INTO job_runs (job_name, run_date) VALUES (?, ?)`, [job, date]);
  return Number(result.affectedRows) === 1;
}

/** Devuelve la reserva (si el job falló) para que el siguiente intento pueda ejecutarlo. */
export async function releaseDailyRun(job: string, date: string): Promise<void> {
  await pool.query(`DELETE FROM job_runs WHERE job_name = ? AND run_date = ?`, [job, date]);
}
