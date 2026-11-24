import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomPassword } from "./testSupport.js";

/**
 * Numeración consecutiva sin año (CR-NNNNN), búsqueda por el número anterior y estado coherente al desembolsar. Contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
const TEST_PASSWORD = randomPassword();

describe.skipIf(process.env.TEST_DB !== "1")("Numeración de créditos y estado al desembolsar (MySQL real)", () => {
  let pool: typeof import("./db/pool.js").pool;
  let sseHub: typeof import("./modules/alerts/sse.hub.js").sseHub;
  let server: Server;
  let base: string;
  let token: string;
  const run = Date.now().toString().slice(-7);

  const callAs = async (tk: string, method: string, path: string, body?: unknown, key?: string) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", Authorization: `Bearer ${tk}`, ...(key ? { "Idempotency-Key": key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* CSV */
    }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  const call = (method: string, path: string, body?: unknown, key?: string) => callAs(token, method, path, body, key);

  beforeAll(async () => {
    const [{ app }, poolMod, bcrypt, hub] = await Promise.all([import("./app.js"), import("./db/pool.js"), import("bcryptjs"), import("./modules/alerts/sse.hub.js")]);
    pool = poolMod.pool;
    sseHub = hub.sseHub;
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", r);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba numeración')`, [
      `nm${run}@test.local`, `nm${run}`, bcrypt.default.hashSync(TEST_PASSWORD, 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`nm${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `nm${run}`, password: TEST_PASSWORD })
    });
    token = ((await login.json()) as any).accessToken;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
  });

  let seq = 0;
  const DAY = 86_400_000;
  const dayOffset = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
  const today = dayOffset(0);

  async function newCredit(firstInstallmentDate = dayOffset(20), amount = 1_200_000, term = 12, rate = 2) {
    const n = ++seq;
    const a = await call("POST", "/associates", {
      idType: "CC", idNumber: `93${run}${n}`, firstName: "Tx", lastName: `Auditoria ${run}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `nm${run}${n}@test.local`, isEmployed: false, dataConsent: true
    });
    const ap = await call("POST", "/applications", { titularAssociateId: a.body.id, requestedAmount: amount, termValue: term, interestRate: rate });
    const d = await call("GET", `/applications/${ap.body.id}`);
    for (const x of d.body.documents) await call("PUT", `/applications/${ap.body.id}/documents/${x.id}`, { status: "APROBADO" });
    for (const x of d.body.participants) await call("PUT", `/applications/${ap.body.id}/participants/${x.id}`, { status: "APROBADO" });
    await call("POST", `/applications/${ap.body.id}/approve`, {});
    const dis = await call("POST", `/credits/applications/${ap.body.id}/disburse`, { disbursementDate: today, firstInstallmentDate });
    expect(dis.status).toBe(201);
    return dis.body.id as number;
  }
  const detail = async (id: number) => (await call("GET", `/credits/${id}`)).body;
  const num = (c: any) => Number(String(c.credit_number).replace("CR-", ""));

  it("los créditos nuevos reciben un consecutivo CR-NNNNN sin año, siempre creciente y sin repetirse", async () => {
    const ids = [await newCredit(), await newCredit(), await newCredit()];
    const credits = await Promise.all(ids.map(detail));
    for (const c of credits) expect(c.credit_number).toMatch(/^CR-\d{5}$/);
    expect(credits.map((c) => c.credit_number).some((n) => /20\d\d/.test(String(n).slice(3)))).toBe(false);
    expect(num(credits[1])).toBeGreaterThan(num(credits[0]));
    expect(num(credits[2])).toBeGreaterThan(num(credits[1]));
    expect(new Set(credits.map((c) => c.credit_number)).size).toBe(3);
  });

  it("créditos simultáneos no repiten número", async () => {
    const ids = await Promise.all([newCredit(), newCredit(), newCredit(), newCredit()]);
    const numbers = (await Promise.all(ids.map(detail))).map((c) => c.credit_number);
    expect(new Set(numbers).size).toBe(4);
  });

  it("un crédito renumerado se sigue encontrando por su número anterior (listado y actividad)", async () => {
    const id = await newCredit();
    const legacy = `CR-2025-9${run}`;
    await pool.query(`UPDATE credits SET legacy_credit_number = ? WHERE id = ?`, [legacy, id]);
    const list = await call("GET", `/credits?search=${encodeURIComponent(legacy)}`);
    expect(list.body.data.map((c: any) => c.id)).toContain(id);
    const act = await call("GET", `/audit?credit=${encodeURIComponent(legacy)}`);
    expect(act.status).toBe(200);
    expect(act.body.total).toBeGreaterThan(0);
    // El actual también sigue funcionando.
    const current = (await detail(id)).credit_number;
    expect((await call("GET", `/credits?search=${encodeURIComponent(current)}`)).body.data.map((c: any) => c.id)).toContain(id);
    // La actividad describe el desembolso sin repetir un número histórico.
    const lines = JSON.stringify((await call("GET", `/audit?credit=${current}`)).body);
    expect(lines).toContain("Desembolsó el crédito");
  });

  it("un crédito cargado con fechas antiguas queda EN_MORA al desembolsarse, sin esperar al job diario", async () => {
    const id = await newCredit(dayOffset(-200), 2_000_000, 15, 4);
    const d = await detail(id);
    expect(d.status).toBe("EN_MORA");
    expect(d.schedule[0].status).toBe("EN_MORA");
    expect(Number(d.schedule[0].overdue_days)).toBeGreaterThanOrEqual(199);
    expect(d.schedule[14].status).toBe("PENDIENTE"); // la última cuota aún no vence
    expect(Number(d.principal_balance)).toBeCloseTo(2_000_000, 2);
    const list = await call("GET", `/credits?search=${encodeURIComponent(d.credit_number)}`);
    expect(list.body.data[0]).toMatchObject({ status: "EN_MORA", moraCode: expect.any(String) });
  });

  it("un crédito con fechas futuras sigue VIGENTE con todas las cuotas PENDIENTE", async () => {
    const d = await detail(await newCredit(dayOffset(20), 2_000_000, 15, 4));
    expect(d.status).toBe("VIGENTE");
    expect(d.schedule.every((i: any) => i.status === "PENDIENTE")).toBe(true);
  });
});
