import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Reglas CHECK de montos (migración 028, docs/escalabilidad.md §3.17), contra MySQL real
 * (opcional; usar una base de pruebas): TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
describe.skipIf(process.env.TEST_DB !== "1")("Reglas CHECK de montos (MySQL real)", () => {
  let pool: typeof import("./db/pool.js").pool;
  let withTransaction: typeof import("./db/pool.js").withTransaction;

  beforeAll(async () => {
    const [{ runMigrations }, poolMod] = await Promise.all([import("./db/migrate.js"), import("./db/pool.js")]);
    await runMigrations();
    pool = poolMod.pool;
    withTransaction = poolMod.withTransaction;
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("están activas en la base de pruebas", async () => {
    const [rows] = await pool.query<any[]>(
      `SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'CHECK' AND CONSTRAINT_NAME LIKE 'chk\\_%'`
    );
    expect(Number((rows as any[])[0].n)).toBeGreaterThanOrEqual(10);
  });

  it("rechazan pagado > debido y saldo negativo, y la transacción no deja nada", async () => {
    const [[inst]] = (await pool.query(`SELECT id, principal_paid FROM credit_schedule_installments ORDER BY id LIMIT 1`)) as any;
    if (!inst) return; // base vacía: no hay con qué probar
    const err = await withTransaction(async (conn) => {
      await conn.query(`UPDATE credit_schedule_installments SET principal_paid = principal_due + 1 WHERE id = ?`, [inst.id]);
    }).catch((e) => e);
    expect([4025, 3819]).toContain(err?.errno);
    const [[after]] = (await pool.query(`SELECT principal_paid FROM credit_schedule_installments WHERE id = ?`, [inst.id])) as any;
    expect(after.principal_paid).toBe(inst.principal_paid);

    const err2 = await pool.query(`UPDATE credits SET principal_balance = -1 ORDER BY id LIMIT 1`).catch((e) => e);
    expect([4025, 3819]).toContain(err2?.errno);
  });
});
