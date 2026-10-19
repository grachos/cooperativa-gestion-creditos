import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomPassword } from "./testSupport.js";

/**
 * Reunión 2026-10-16, Correcciones de la auditoría de transacciones (H1–H5), contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
const TEST_PASSWORD = randomPassword();

describe.skipIf(process.env.TEST_DB !== "1")("Auditoría de transacciones: reverso, job de alertas, créditos cerrados y excedentes (MySQL real)", () => {
  let pool: typeof import("./db/pool.js").pool;
  let server: Server;
  let base: string;
  let token: string;
  const run = Date.now().toString().slice(-7);

  const callAs = async (tk: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", Authorization: `Bearer ${tk}` },
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
  const call = (method: string, path: string, body?: unknown) => callAs(token, method, path, body);

  beforeAll(async () => {
    const [{ app }, poolMod, bcrypt] = await Promise.all([import("./app.js"), import("./db/pool.js"), import("bcryptjs")]);
    pool = poolMod.pool;
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", r);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba transacciones')`, [
      `tx${run}@test.local`, `tx${run}`, bcrypt.default.hashSync(TEST_PASSWORD, 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`tx${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `tx${run}`, password: TEST_PASSWORD })
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
  const cents = (n: number) => Math.round(n * 100) / 100;

  async function newCredit(firstInstallmentDate = dayOffset(20)) {
    const n = ++seq;
    const a = await call("POST", "/associates", {
      idType: "CC", idNumber: `99${run}${n}`, firstName: "Tx", lastName: `Auditoria ${run}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `tx${run}${n}@test.local`, isEmployed: false, dataConsent: true
    });
    const ap = await call("POST", "/applications", { titularAssociateId: a.body.id, requestedAmount: 1_200_000, termValue: 12, interestRate: 2 });
    const d = await call("GET", `/applications/${ap.body.id}`);
    for (const x of d.body.documents) await call("PUT", `/applications/${ap.body.id}/documents/${x.id}`, { status: "APROBADO" });
    for (const x of d.body.participants) await call("PUT", `/applications/${ap.body.id}/participants/${x.id}`, { status: "APROBADO" });
    await call("POST", `/applications/${ap.body.id}/approve`, {});
    const dis = await call("POST", `/credits/applications/${ap.body.id}/disburse`, { disbursementDate: today, firstInstallmentDate });
    expect(dis.status).toBe(201);
    return dis.body.id as number;
  }
  const detail = async (id: number) => (await call("GET", `/credits/${id}`)).body;
  const pay = (creditId: number, amount: number) =>
    call("POST", "/payments", { creditId, receivedDate: today, amount, paymentMethod: "EFECTIVO" });
  /** El saldo de capital del crédito debe ser lo que les falta a sus cuotas, y cada cuota su propio saldo. */
  function expectConsistent(d: any) {
    const remaining = cents(d.schedule.filter((i: any) => i.status !== "ANULADA").reduce((s: number, i: any) => s + Number(i.principal_due) - Number(i.principal_paid), 0));
    expect(Number(d.principal_balance)).toBeCloseTo(remaining, 2);
    for (const i of d.schedule) {
      const outstanding = Math.max(0, cents(Number(i.principal_due) - Number(i.principal_paid) + Number(i.interest_due) - Number(i.interest_paid)));
      expect(Number(i.balance)).toBeCloseTo(outstanding, 2);
      const paidSomething = Number(i.principal_paid) > 0 || Number(i.interest_paid) > 0;
      if (i.status === "PARCIAL") expect(paidSomething).toBe(true);
    }
  }

  it("H1: reversar un pago devuelve el saldo de capital, el saldo de la cuota y su estado", async () => {
    const creditId = await newCredit();
    const first = Number((await detail(creditId)).schedule[0].total_due);
    const p = await pay(creditId, first);
    expect(p.status).toBe(201);
    const paid = await detail(creditId);
    expect(paid.schedule[0].status).toBe("PAGADA");
    expect(Number(paid.principal_balance)).toBeLessThan(1_200_000);

    expect((await call("POST", `/payments/${p.body.paymentId}/reverse`, { reason: "Prueba de reverso" })).status).toBe(200);
    const after = await detail(creditId);
    expect(Number(after.principal_balance)).toBeCloseTo(1_200_000, 2);
    expect(after.schedule[0].status).toBe("PENDIENTE"); // aún no vence y quedó sin abonos (antes: PARCIAL)
    expect(Number(after.schedule[0].balance)).toBeCloseTo(first, 2);
    expectConsistent(after);
  });

  it("H1: reversar uno de dos pagos deja solo el efecto del otro", async () => {
    const creditId = await newCredit();
    const p1 = await pay(creditId, 50_000);
    const p2 = await pay(creditId, 30_000);
    expect((await call("POST", `/payments/${p1.body.paymentId}/reverse`, { reason: "Prueba de reverso" })).status).toBe(200);
    const d = await detail(creditId);
    expect(d.schedule[0].status).toBe("PARCIAL"); // queda el abono de 30.000
    expect(cents(Number(d.schedule[0].principal_paid) + Number(d.schedule[0].interest_paid))).toBeCloseTo(30_000, 2);
    expectConsistent(d);
    expect(p2.status).toBe(201);
  });

  it("H1: reversar el último pago de un crédito PAGADO lo devuelve a VIGENTE con su saldo", async () => {
    const creditId = await newCredit();
    const total = cents((await detail(creditId)).schedule.reduce((s: number, i: any) => s + Number(i.total_due), 0));
    const p = await pay(creditId, total);
    expect(p.status).toBe(201);
    expect(p.body.creditStatus).toBe("PAGADO");
    expect(Number((await detail(creditId)).principal_balance)).toBe(0);
    expect((await call("POST", `/payments/${p.body.paymentId}/reverse`, { reason: "Prueba de reverso" })).status).toBe(200);
    const d = await detail(creditId);
    expect(d.status).toBe("VIGENTE");
    expect(Number(d.principal_balance)).toBeCloseTo(1_200_000, 2);
    expectConsistent(d);
  });

  it("H2: el job de alertas no pisa una cuota que un pago dejó PAGADA mientras el job corría", async () => {
    const { persistInstallmentStates } = await import("./modules/alerts/alerts.service.js");
    const creditId = await newCredit(dayOffset(-40));
    const before = await detail(creditId);
    const [inst1, inst2] = before.schedule;
    // El job "leyó" las cuotas cuando estaban vencidas…
    const staleStatus = inst1.status;
    // …y en ese intervalo entra un pago que deja la cuota 1 PAGADA.
    expect((await pay(creditId, Number(inst1.total_due))).status).toBe(201);
    expect((await detail(creditId)).schedule[0].status).toBe("PAGADA");

    const updated = await persistInstallmentStates([
      { overdueDays: 40, status: "EN_MORA", fromStatus: staleStatus, ids: [inst1.id] }, // dato viejo: se omite
      { overdueDays: 9, status: "VENCIDA", fromStatus: inst2.status, ids: [inst2.id] } // sin cambios de por medio: se escribe
    ]);
    expect(updated).toBe(1);
    const after = await detail(creditId);
    expect(after.schedule[0].status).toBe("PAGADA");
    expect(after.schedule[1].status).toBe("VENCIDA");
    expect(after.schedule[1].overdue_days).toBe(9);
  });

  it("H3 y H5: un crédito refinanciado no recibe pagos, cancelaciones ni reversos", async () => {
    const creditId = await newCredit();
    const p = await pay(creditId, 40_000);
    expect(p.status).toBe(201);
    const refi = await call("POST", `/credits/${creditId}/refinance`, { additionalCapital: 0, termValue: 6, interestRate: 2, firstInstallmentDate: dayOffset(30), reason: "Prueba de refinanciación" });
    expect(refi.status).toBe(201);
    const [before] = await pool.query<any[]>(`SELECT COUNT(*) n FROM payments WHERE credit_id = ?`, [creditId]);

    expect((await pay(creditId, 10_000)).status).toBe(409);
    expect((await call("POST", "/payments/early-payoff", { creditId, receivedDate: today, paymentMethod: "EFECTIVO", expectedTotal: 1 })).status).toBe(409);
    expect((await call("POST", `/payments/${p.body.paymentId}/reverse`, { reason: "Prueba de reverso" })).status).toBe(409);

    const [after] = await pool.query<any[]>(`SELECT COUNT(*) n FROM payments WHERE credit_id = ?`, [creditId]);
    expect(Number((after as any[])[0].n)).toBe(Number((before as any[])[0].n)); // no se guardó nada
    expect((await detail(creditId)).payments.find((x: any) => x.id === p.body.paymentId).status).toBe("CONFIRMADO");
  });

  it("H4: un pago mayor a lo adeudado se rechaza sin guardar nada; el máximo exacto sí se acepta", async () => {
    const creditId = await newCredit();
    const total = cents((await detail(creditId)).schedule.reduce((s: number, i: any) => s + Number(i.total_due), 0));
    const over = await pay(creditId, total + 5_000);
    expect(over.status).toBe(409);
    expect(JSON.stringify(over.body)).toContain(String(total));
    expect((await detail(creditId)).payments).toHaveLength(0);

    const exact = await pay(creditId, total);
    expect(exact.status).toBe(201);
    expect(cents(exact.body.allocations.reduce((s: number, a: any) => s + a.amount, 0))).toBeCloseTo(total, 2);
    expect(exact.body.creditStatus).toBe("PAGADO");
    expect((await pay(creditId, 1_000)).status).toBe(409); // ya pagado
  });
});
