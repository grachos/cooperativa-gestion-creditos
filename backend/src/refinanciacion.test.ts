import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomPassword } from "./testSupport.js";

/**
 * Refinanciación según la regla de la cooperativa (H9) y redondeo de la cuota. Contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
const TEST_PASSWORD = randomPassword();

describe.skipIf(process.env.TEST_DB !== "1")("Refinanciación (regla de la cooperativa) y cuota redondeada (MySQL real)", () => {
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
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba refinanciación')`, [
      `rf${run}@test.local`, `rf${run}`, bcrypt.default.hashSync(TEST_PASSWORD, 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`rf${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `rf${run}`, password: TEST_PASSWORD })
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
      idType: "CC", idNumber: `96${run}${n}`, firstName: "Tx", lastName: `Auditoria ${run}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `rf${run}${n}@test.local`, isEmployed: false, dataConsent: true
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
  const cents = (n: number) => Math.round(n * 100) / 100;
  const sum = (rows: any[], k: string) => cents(rows.reduce((s, r) => s + Number(r[k]), 0));
  const pay = (creditId: number, amount: number) =>
    call("POST", "/payments", { creditId, receivedDate: today, amount, paymentMethod: "EFECTIVO" });

  it("cuota redondeada hacia arriba a $100: $2.000.000 al 4 % a 15 meses = $213.400", async () => {
    const id = await newCredit(dayOffset(20), 2_000_000, 15, 4);
    const d = (await call("GET", `/credits/${id}`)).body;
    expect(d.schedule).toHaveLength(15);
    for (const i of d.schedule) expect(Number(i.total_due)).toBe(213_400);
    expect(sum(d.schedule, "principal_due")).toBe(2_000_000);
    expect(Number(d.schedule[0].interest_due)).toBeCloseTo(80_066.67, 2);
  });

  it("ejemplo de la cooperativa: pagó 7 de 15 y refinancia a 15 meses", async () => {
    const id = await newCredit(dayOffset(20), 2_000_000, 15, 4);
    expect((await pay(id, 7 * 213_400)).status).toBe(201);

    const q = (await call("GET", `/credits/${id}/refinance-quote?termValue=15`)).body;
    expect(q.lastPaidInstallment).toBe(7);
    expect(q.pendingInstallments).toBe(8);
    expect(q.pendingTotal).toBe(1_707_200); // 8 cuotas de $213.400
    expect(q.originalMonthlyInterest).toBe(80_000);
    expect(q.additionalInterest).toBe(640_000); // $80.000 × 8
    expect(q.total).toBe(2_347_200);
    expect(q.installment).toBe(156_500); // $2.347.200 / 15 = $156.480, hacia arriba a $100
    expect(q.inheritedPrincipal).toBeCloseTo(1_066_666.69, 2); // el capital que faltaba
    expect(q.inheritedInterest).toBeCloseTo(1_280_533.31, 2);
    expect(q.paidPrincipal + q.paidInterest).toBeCloseTo(7 * 213_400, 2);

    const wrong = await call("POST", `/credits/${id}/refinance`, { termValue: 15, firstInstallmentDate: dayOffset(30), reason: "Refinanciación", expectedTotal: 2_000_000 });
    expect(wrong.status).toBe(409);
    const extra = await call("POST", `/credits/${id}/refinance`, { termValue: 15, firstInstallmentDate: dayOffset(30), reason: "Refinanciación", additionalCapital: 500_000 });
    expect(extra.status).toBe(400);

    const r = await call("POST", `/credits/${id}/refinance`, { termValue: 15, firstInstallmentDate: dayOffset(30), reason: "Refinanciación", expectedTotal: q.total });
    expect(r.status).toBe(201);
    const n = (await call("GET", `/credits/${r.body.id}`)).body;
    expect(n.schedule).toHaveLength(15);
    for (const i of n.schedule) expect(Number(i.total_due)).toBe(156_500);
    expect(sum(n.schedule, "principal_due")).toBeCloseTo(q.inheritedPrincipal, 2);
    expect(sum(n.schedule, "interest_due")).toBeCloseTo(q.inheritedInterest + 15 * 20, 2); // el redondeo ($20 por cuota) va al interés
    expect(Number(n.principal_balance)).toBeCloseTo(q.inheritedPrincipal, 2);
    const snap = typeof n.parameters_snapshot === "string" ? JSON.parse(n.parameters_snapshot) : n.parameters_snapshot;
    expect(snap.refinance.additionalInterest).toBe(640_000);
    expect((await call("GET", `/credits/${id}`)).body.status).toBe("REFINANCIADO");

    // Refinanciar de nuevo: el interés mensual sigue saliendo del préstamo inicial ($80.000).
    const q2 = (await call("GET", `/credits/${r.body.id}/refinance-quote?termValue=10`)).body;
    expect(q2.originalMonthlyInterest).toBe(80_000);
    expect(q2.pendingInstallments).toBe(15);
    expect(q2.additionalInterest).toBe(15 * 80_000);
  });

  it("sin pagos, con cuotas vencidas, se calcula desde la última pagada (ninguna)", async () => {
    const id = await newCredit(dayOffset(-40), 2_000_000, 15, 4);
    const q = (await call("GET", `/credits/${id}/refinance-quote?termValue=15`)).body;
    expect(q.lastPaidInstallment).toBeNull();
    expect(q.pendingInstallments).toBe(15);
    expect(q.total).toBe(15 * 213_400 + 15 * 80_000);
  });

  it("no refinancia con mora o gastos cobrados sin pagar", async () => {
    const id = await newCredit(dayOffset(20), 2_000_000, 15, 4);
    const adj = await call("POST", `/credits/${id}/adjustments`, { type: "GASTO_NOTIFICACION", amount: 100_000, reason: "Notificación" });
    expect(adj.status).toBe(201);
    const r = await call("POST", `/credits/${id}/refinance`, { termValue: 15, firstInstallmentDate: dayOffset(30), reason: "Refinanciación" });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("cargos sin pagar");
  });
});
