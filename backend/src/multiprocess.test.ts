import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomPassword } from "./testSupport.js";

/**
 * Protecciones para varios procesos / ejecuciones simultáneas, contra MySQL real
 * (opcional; crea datos de prueba, usar una base de pruebas):
 *   JOBS_TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
const TEST_PASSWORD = randomPassword();

describe.skipIf(process.env.JOBS_TEST_DB !== "1" && process.env.TEST_DB !== "1")("Varios procesos: candados, job diario, alertas únicas y buzón SSE (MySQL real)", () => {
  let pool: typeof import("./db/pool.js").pool;
  let jobLock: typeof import("./utils/jobLock.js");
  let service: typeof import("./modules/alerts/alerts.service.js");
  let server: Server;
  let base: string;
  let token: string;
  const run = Date.now().toString().slice(-7);

  beforeAll(async () => {
    const [{ app }, poolMod, bcrypt] = await Promise.all([import("./app.js"), import("./db/pool.js"), import("bcryptjs")]);
    pool = poolMod.pool;
    jobLock = await import("./utils/jobLock.js");
    service = await import("./modules/alerts/alerts.service.js");
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", r);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba jobs')`, [
      `jobs${run}@test.local`,
      `jobs${run}`,
      bcrypt.default.hashSync(TEST_PASSWORD, 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`jobs${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `jobs${run}`, password: TEST_PASSWORD })
    });
    token = ((await login.json()) as any).accessToken;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
  };

  /** Crédito con la primera cuota vencida hace `daysAgo` días. */
  async function overdueCredit(n: number, daysAgo: number): Promise<number> {
    const day = (o: number) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
    const a = await call("POST", "/associates", {
      idType: "CC", idNumber: `88${run}${n}`, firstName: "Job", lastName: `Prueba ${n}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `j${run}${n}@test.local`, isEmployed: false, dataConsent: true
    });
    const ap = await call("POST", "/applications", { titularAssociateId: a.body.id, requestedAmount: 1_200_000, termValue: 12, interestRate: 2 });
    const id = ap.body.id;
    const d = await call("GET", `/applications/${id}`);
    for (const x of d.body.documents) await call("PUT", `/applications/${id}/documents/${x.id}`, { status: "APROBADO" });
    for (const x of d.body.participants) await call("PUT", `/applications/${id}/participants/${x.id}`, { status: "APROBADO" });
    await call("POST", `/applications/${id}/approve`, {});
    const dis = await call("POST", `/credits/applications/${id}/disburse`, { disbursementDate: day(-daysAgo - 30), firstInstallmentDate: day(-daysAgo) });
    expect(dis.status).toBe(201);
    return dis.body.id as number;
  }

  it("candado del job: mientras una ejecución lo tiene, otra no corre (se omite) y al soltarlo vuelve a poder correr", async () => {
    const held = await jobLock.withJobLock("alerts-recalculate", async () => {
      const inner = await service.recalculateAlerts();
      expect(inner).toEqual({ created: 0, skipped: true });
      return "ok";
    });
    expect(held).toEqual({ ran: true, result: "ok" });
    const after = await service.recalculateAlerts();
    expect(after.skipped).toBeUndefined();
  });

  it("el botón 'Recalcular' responde 409 si ya hay un recálculo en curso", async () => {
    let status = 0;
    await jobLock.withJobLock("alerts-recalculate", async () => {
      status = (await call("POST", "/alerts/recalculate", {})).status;
    });
    expect(status).toBe(409);
    expect((await call("POST", "/alerts/recalculate", {})).status).toBe(200);
  });

  it("job diario: aunque lo intenten 6 procesos a la vez, solo uno lo ejecuta ese día", async () => {
    const day = "2031-03-15"; // fecha ficticia, no choca con ejecuciones reales
    await pool.query(`DELETE FROM job_runs WHERE job_name = 'alerts-daily' AND run_date = ?`, [day]);
    // Tarea falsa: así no se recalcula la cartera con una fecha ficticia (contaminaría otras pruebas).
    let executions = 0;
    const fakeJob = async () => {
      executions++;
      await new Promise((r) => setTimeout(r, 30));
      return { created: 0 };
    };
    const results = await Promise.all(Array.from({ length: 6 }, () => service.runDailyAlertsJob(new Date(`${day}T11:00:00Z`), fakeJob)));
    expect(results.filter((r) => r.ran)).toHaveLength(1);
    expect(executions).toBe(1);
    // al día siguiente vuelve a correr
    expect((await service.runDailyAlertsJob(new Date("2031-03-16T11:00:00Z"), fakeJob)).ran).toBe(true);
    expect(executions).toBe(2);
    // si la tarea falla, se devuelve la reserva y el siguiente intento puede ejecutarla
    const failing = async () => {
      throw new Error("falló");
    };
    await expect(service.runDailyAlertsJob(new Date("2031-03-17T11:00:00Z"), failing)).rejects.toThrow("falló");
    expect((await service.runDailyAlertsJob(new Date("2031-03-17T11:00:00Z"), fakeJob)).ran).toBe(true);
    await pool.query(`DELETE FROM job_runs WHERE job_name = 'alerts-daily' AND run_date IN ('2031-03-15','2031-03-16','2031-03-17')`);
  });

  it("reserva diaria: se puede devolver para reintentar tras un fallo", async () => {
    const day = "2031-04-01";
    expect(await jobLock.claimDailyRun("prueba-reserva", day)).toBe(true);
    expect(await jobLock.claimDailyRun("prueba-reserva", day)).toBe(false);
    await jobLock.releaseDailyRun("prueba-reserva", day);
    expect(await jobLock.claimDailyRun("prueba-reserva", day)).toBe(true);
    await jobLock.releaseDailyRun("prueba-reserva", day);
  });

  it("el job crea las alertas de mora una sola vez y es idempotente", async () => {
    const creditId = await overdueCredit(1, 40);
    await service.recalculateAlerts();
    const count = async () => {
      const [rows] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM alerts WHERE credit_id = ? AND status = 'ABIERTA'`, [creditId]);
      return Number((rows as any[])[0].n);
    };
    const first = await count();
    expect(first).toBeGreaterThan(0);
    await service.recalculateAlerts(); // segunda ejecución: no debe duplicar las alertas de ESTE crédito
    expect(await count()).toBe(first);
    const [credit] = await pool.query<any[]>(`SELECT status FROM credits WHERE id = ?`, [creditId]);
    expect((credit as any[])[0].status).toBe("EN_MORA");
  });

  it("llave única: no pueden existir dos alertas ABIERTAS iguales; al atenderla se puede crear otra", async () => {
    const creditId = await overdueCredit(2, 10);
    const [inst] = await pool.query<any[]>(`SELECT id FROM credit_schedule_installments WHERE credit_id = ? ORDER BY installment_number LIMIT 1`, [creditId]);
    const installmentId = (inst as any[])[0].id;
    const insert = () =>
      pool.query(`INSERT INTO alerts (credit_id, installment_id, type, priority, message, open_flag) VALUES (?, ?, 'PRUEBA_UNICA', 'BAJA', 'x', 1)`, [creditId, installmentId]);
    await insert();
    await expect(insert()).rejects.toMatchObject({ errno: 1062 });

    const [row] = await pool.query<any[]>(`SELECT id FROM alerts WHERE installment_id = ? AND type = 'PRUEBA_UNICA'`, [installmentId]);
    const resolve = await call("POST", `/alerts/${(row as any[])[0].id}/resolve`, {});
    expect(resolve.status).toBe(200);
    await insert(); // la anterior ya no está abierta (open_flag NULL)
    const [all] = await pool.query<any[]>(`SELECT status, open_flag FROM alerts WHERE installment_id = ? AND type = 'PRUEBA_UNICA' ORDER BY id`, [installmentId]);
    expect((all as any[]).map((r) => [r.status, r.open_flag])).toEqual([["ATENDIDA", null], ["ABIERTA", 1]]);
  });

  it("buzón de eventos en MySQL: lo publicado por un proceso lo reciben los demás", async () => {
    const { MysqlRealtimeStore } = await import("./modules/alerts/sse.hub.mysql.js");
    const { SseHub } = await import("./modules/alerts/sse.hub.core.js");
    const { EventEmitter } = await import("node:events");
    const store = new MysqlRealtimeStore();
    class Res extends EventEmitter {
      chunks: string[] = []; writableEnded = false; destroyed = false;
      write(c: string) { this.chunks.push(c); return true; }
      end() { this.writableEnded = true; }
    }
    const a = new SseHub({ instanceId: "pa" + run, store, pollMs: 20, heartbeatMs: 1000, log: () => {} });
    const b = new SseHub({ instanceId: "pb" + run, store, pollMs: 20, heartbeatMs: 1000, log: () => {} });
    const ra = new Res(), rb = new Res();
    a.register(1, ra as any); b.register(2, rb as any);
    await new Promise((r) => setTimeout(r, 80));
    a.broadcast("alert.created", { mensaje: "desde A" });
    await new Promise((r) => setTimeout(r, 150));
    a.stop(); b.stop();
    const got = (r: InstanceType<typeof Res>) => r.chunks.filter((c) => c.startsWith("event: alert.created"));
    expect(got(ra)).toHaveLength(1);
    expect(got(rb)).toHaveLength(1);
    expect(await store.purgeOlderThan(-1)).toBeGreaterThanOrEqual(1);
  });
});
