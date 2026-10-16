import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Reunión 2026-10-16, Fase 5, contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
describe.skipIf(process.env.TEST_DB !== "1")("Fase 5 de la reunión: mora sugerida, gasto de notificación y cancelación anticipada (MySQL real)", () => {
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
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba fase 5')`, [
      `f5${run}@test.local`, `f5${run}`, bcrypt.default.hashSync("Fase5-123*", 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`f5${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `f5${run}`, password: "Fase5-123*" })
    });
    token = ((await login.json()) as any).accessToken;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
  });

  let seq = 0;
  const DAY = 86_400_000;
  const dayOffset = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
  const today = dayOffset(0);
  const PASSWORD = "Fase5-Usuario-123*";
  const cents = (n: number) => Math.round(n * 100) / 100;

  async function newUser(label: string, roleCodes: string[]) {
    const n = ++seq;
    const username = `${label}${run}${n}`;
    const r = await call("POST", "/users", { fullName: `U ${label} ${run}${n}`, email: `${username}@test.local`, username, password: PASSWORD, roleCodes });
    expect(r.status).toBe(201);
    return username;
  }
  async function loginAs(username: string) {
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: username, password: PASSWORD })
    });
    return ((await res.json()) as any).accessToken as string;
  }
  async function newAssociate() {
    const n = ++seq;
    const a = await call("POST", "/associates", {
      idType: "CC", idNumber: `33${run}${n}`, firstName: "Asoc", lastName: `Fase5 ${run}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `m${run}${n}@test.local`, isEmployed: false, dataConsent: true
    });
    expect(a.status).toBe(201);
    return a.body.id as number;
  }
  /** Crédito de $1.200.000 a 12 meses; firstInstallmentDate decide cuántas cuotas ya están vencidas. */
  async function newCredit(firstInstallmentDate: string) {
    const ap = await call("POST", "/applications", { titularAssociateId: await newAssociate(), requestedAmount: 1_200_000, termValue: 12, interestRate: 2 });
    const d = await call("GET", `/applications/${ap.body.id}`);
    for (const x of d.body.documents) await call("PUT", `/applications/${ap.body.id}/documents/${x.id}`, { status: "APROBADO" });
    for (const x of d.body.participants) await call("PUT", `/applications/${ap.body.id}/participants/${x.id}`, { status: "APROBADO" });
    expect((await call("POST", `/applications/${ap.body.id}/approve`, {})).status).toBe(200);
    const dis = await call("POST", `/credits/applications/${ap.body.id}/disburse`, { disbursementDate: firstInstallmentDate, firstInstallmentDate });
    expect(dis.status).toBe(201);
    return dis.body.id as number;
  }
  const quote = async (creditId: number, extra = "", tk = token) => (await callAs(tk, "GET", `/payments/quote?creditId=${creditId}&date=${today}${extra}`));
  const detail = async (creditId: number) => (await call("GET", `/credits/${creditId}`)).body;
  const pay = (creditId: number, amount: number, extra: Record<string, unknown> = {}, tk = token) =>
    callAs(tk, "POST", "/payments", { creditId, receivedDate: today, amount, paymentMethod: "TRANSFERENCIA", ...extra });

  it("la mora se calcula con el parámetro (% por día, días de gracia, base) y se SUGIERE, no se cobra sola", async () => {
    const creditId = await newCredit(dayOffset(-40));
    const q = (await quote(creditId)).body;
    expect(q.mora.mode).toBe("SUGERIDO");
    expect(q.mora.rateType).toBe("DIARIA");
    expect(q.mora.items.length).toBeGreaterThan(0);

    const d = await detail(creditId);
    let expected = 0;
    for (const item of q.mora.items) {
      const inst = d.schedule.find((i: any) => i.id === item.installmentId);
      const base = q.mora.base === "CUOTA_VENCIDA" ? Number(inst.principal_due) + Number(inst.interest_due) : Number(inst.principal_due);
      const days = Math.max(0, item.overdueDays - q.mora.graceDays);
      const accrued = cents((base * q.mora.rateOrValue * days) / 100);
      expect(item.accrued).toBeCloseTo(accrued, 2);
      expect(item.charged).toBe(0);
      expected += item.pending;
    }
    expect(q.mora.suggested).toBeCloseTo(expected, 2);
    expect(q.mora.suggested).toBeGreaterThan(0);

    // un pago sin decidir cobros NO genera mora: todo va a la cuota
    const first = Number(d.schedule[0].total_due);
    const p = await pay(creditId, first);
    expect(p.status).toBe(201);
    expect(p.body.allocations.some((a: any) => a.concept === "MORA")).toBe(false);
    expect((await detail(creditId)).adjustments.filter((a: any) => a.type === "INTERES_MORA")).toHaveLength(0);
  });

  it("cobrar mora: solo con permiso de ajustes, hasta lo calculado, repartida por cuota y sin cobrarla dos veces", async () => {
    const creditId = await newCredit(dayOffset(-40));
    const q1 = (await quote(creditId)).body;
    const suggested = q1.mora.suggested;

    const operator = await loginAs(await newUser("oper", ["OPERADOR"]));
    expect((await pay(creditId, 1000, { moraAmount: 10 }, operator)).status).toBe(403); // sin permiso de ajustes
    const asOperator = (await quote(creditId, "", operator)).body;
    expect(asOperator.canNegotiate).toBe(false);
    expect(asOperator.mora.suggested).toBe(suggested); // la ve, pero no la decide

    expect((await pay(creditId, 1000, { moraAmount: suggested + 1 })).status).toBe(400); // más de lo calculado

    const half = cents(suggested / 2);
    const first = Number((await detail(creditId)).schedule[0].total_due);
    const p = await pay(creditId, first + half, { moraAmount: half, chargeReason: "Negociado con el cliente" });
    expect(p.status).toBe(201);
    const moraLines = p.body.allocations.filter((a: any) => a.concept === "MORA");
    expect(moraLines.length).toBeGreaterThan(0);
    expect(cents(moraLines.reduce((s: number, l: any) => s + l.amount, 0))).toBeCloseTo(half, 2); // la mora se paga primero

    const adjustments = (await detail(creditId)).adjustments.filter((a: any) => a.type === "INTERES_MORA");
    expect(cents(adjustments.reduce((s: number, a: any) => s + Number(a.amount), 0))).toBeCloseTo(half, 2);
    expect(adjustments.every((a: any) => Number(a.paid_amount) === Number(a.amount) && a.approved_by_name)).toBe(true);

    // lo que quedó sin cobrar vuelve a sugerirse; lo ya cobrado no
    const q2 = (await quote(creditId)).body;
    expect(q2.mora.suggested).toBeLessThanOrEqual(suggested - half + 0.05);

    // reversar el pago devuelve la mora cobrada a pendiente (no queda como pagada)
    expect((await call("POST", `/payments/${p.body.paymentId}/reverse`, { reason: "Error de digitación" })).status).toBe(200);
    const after = (await detail(creditId)).adjustments.filter((a: any) => a.type === "INTERES_MORA");
    expect(after.every((a: any) => Number(a.paid_amount) === 0)).toBe(true);
  });

  it("gasto de notificación: se sugiere al llegar al umbral de mora, se cobra una vez y respeta el tope", async () => {
    const fresh = await newCredit(dayOffset(5)); // sin mora
    expect((await quote(fresh)).body.notification.suggested).toBe(0);
    expect((await pay(fresh, 1000, { notificationAmount: 50_000 })).status).toBe(400);

    const creditId = await newCredit(dayOffset(-40)); // 40 días: pasó el umbral de 30
    const n = (await quote(creditId)).body.notification;
    expect(n.enabled).toBe(true);
    expect(n.suggested).toBe(n.amount);
    expect(n.amount).toBeGreaterThan(0);
    expect((await pay(creditId, 1000, { notificationAmount: n.amount + 1 })).status).toBe(400);

    const ok = await pay(creditId, n.amount, { notificationAmount: n.amount });
    expect(ok.status).toBe(201);
    expect(ok.body.allocations.some((a: any) => a.concept === "GASTOS" && a.amount === n.amount)).toBe(true);
    expect((await detail(creditId)).adjustments.filter((a: any) => a.type === "GASTO_NOTIFICACION")).toHaveLength(1);
    expect((await quote(creditId)).body.notification.suggested).toBe(0); // ya se cobró el de este umbral
  });

  it("cancelación anticipada: descuento sobre el interés futuro, total confirmado, crédito pagado y sin reverso", async () => {
    const creditId = await newCredit(dayOffset(20)); // todas las cuotas por vencer
    const q = (await quote(creditId)).body.payoff;
    expect(q.futureInterest).toBeGreaterThan(0);
    expect(q.defaultPercent).toBeGreaterThan(0);
    expect(q.discount).toBeCloseTo(cents((q.futureInterest * q.percent) / 100), 1);
    expect(q.total).toBeCloseTo(q.outstandingPrincipal + q.outstandingInterest - q.discount, 1);

    // quien no tiene permiso de ajustes no recibe descuento ni lo puede fijar
    const operator = await loginAs(await newUser("oper", ["OPERADOR"]));
    const plain = (await quote(creditId, "", operator)).body;
    expect(plain.canNegotiate).toBe(false);
    expect(plain.payoff.discount).toBe(0);
    expect(plain.payoff.total).toBeCloseTo(q.outstandingPrincipal + q.outstandingInterest, 1);
    const body = { creditId, receivedDate: today, paymentMethod: "TRANSFERENCIA" };
    expect((await callAs(operator, "POST", "/payments/early-payoff", { ...body, discountPercent: 50, expectedTotal: plain.payoff.total })).status).toBe(403);

    // el total debe coincidir con lo visto en pantalla
    expect((await call("POST", "/payments/early-payoff", { ...body, expectedTotal: q.total + 5000 })).status).toBe(409);

    const done = await call("POST", "/payments/early-payoff", { ...body, expectedTotal: q.total, verified: true });
    expect(done.status).toBe(201);
    expect(done.body.creditStatus).toBe("PAGADO");
    expect(done.body.total).toBeCloseTo(q.total, 2);
    expect(done.body.discount).toBeCloseTo(q.discount, 2);
    expect(cents(done.body.allocations.reduce((s: number, a: any) => s + a.amount, 0))).toBeCloseTo(q.total, 2);

    const d = await detail(creditId);
    expect(d.status).toBe("PAGADO");
    expect(Number(d.principal_balance)).toBe(0);
    expect(d.schedule.every((i: any) => i.status === "PAGADA")).toBe(true);
    expect(d.adjustments.some((a: any) => a.type === "DESCUENTO" && Number(a.amount) === done.body.discount)).toBe(true);
    expect(d.payments[0].verified).toBe(true);

    expect((await call("POST", `/payments/${done.body.paymentId}/reverse`, { reason: "Prueba de reverso" })).status).toBe(409);
    expect((await call("POST", "/payments/early-payoff", { ...body, expectedTotal: q.total })).status).toBe(409); // ya pagado
  });

  it("cancelación anticipada sin descuento si quien negocia lo fija en 0 %, y cobrando la mora decidida", async () => {
    const creditId = await newCredit(dayOffset(-40));
    const q0 = (await quote(creditId, "&discountPercent=0")).body;
    const mora = q0.mora.suggested;
    expect(mora).toBeGreaterThan(0);
    // total con 0 % de descuento y la mora completa
    const total = cents(q0.payoff.outstandingPrincipal + q0.payoff.outstandingInterest + q0.payoff.pendingCharges + mora);
    const done = await call("POST", "/payments/early-payoff", {
      creditId, receivedDate: today, paymentMethod: "TRANSFERENCIA", discountPercent: 0, moraAmount: mora, expectedTotal: total
    });
    expect(done.status).toBe(201);
    expect(done.body.discount).toBe(0);
    expect(done.body.creditStatus).toBe("PAGADO");
    const adjustments = (await detail(creditId)).adjustments;
    expect(adjustments.filter((a: any) => a.type === "INTERES_MORA").length).toBeGreaterThan(0);
    expect(adjustments.filter((a: any) => a.type === "DESCUENTO")).toHaveLength(0);
  });
});
