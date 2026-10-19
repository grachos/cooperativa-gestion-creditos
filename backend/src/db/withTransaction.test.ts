import { afterAll, describe, expect, it } from "vitest";

/**
 * withTransaction ante un deadlock real (MySQL de pruebas): dos transacciones bloquean dos filas en orden
 * contrario; MySQL aborta una (1213) y withTransaction la reintenta desde cero, así que ambas terminan bien
 * y el resultado es el mismo que si hubieran corrido una detrás de otra.
 */
describe.skipIf(process.env.TEST_DB !== "1")("withTransaction: reintento ante deadlock (MySQL real)", () => {
  let pool: typeof import("./pool.js").pool;
  afterAll(async () => {
    await pool?.end();
  });

  it("dos transacciones cruzadas: una cae en deadlock, se reintenta sola y ambas aplican su cambio", async () => {
    const mod = await import("./pool.js");
    pool = mod.pool;
    const run = Date.now().toString(36);
    const a = `test-deadlock-a-${run}`;
    const b = `test-deadlock-b-${run}`;
    await pool.query(`INSERT INTO sequences (name, value) VALUES (?, 0), (?, 0)`, [a, b]);

    let attempts = 0;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const crossed = (first: string, second: string) =>
      mod.withTransaction(async (conn) => {
        attempts++;
        await conn.query(`UPDATE sequences SET value = value + 1 WHERE name = ?`, [first]);
        await sleep(150); // da tiempo a que la otra tome su primera fila
        await conn.query(`UPDATE sequences SET value = value + 1 WHERE name = ?`, [second]);
      });

    await Promise.all([crossed(a, b), crossed(b, a)]);
    expect(attempts).toBeGreaterThanOrEqual(3); // hubo al menos un reintento
    const [rows] = await pool.query<any[]>(`SELECT name, value FROM sequences WHERE name IN (?, ?) ORDER BY name`, [a, b]);
    expect((rows as any[]).map((r) => Number(r.value))).toEqual([2, 2]); // cada fila sumó una vez por transacción
    await pool.query(`DELETE FROM sequences WHERE name IN (?, ?)`, [a, b]);
  });
});
