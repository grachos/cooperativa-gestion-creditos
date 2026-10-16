import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomPassword } from "./testSupport.js";

/**
 * Reunión 2026-10-16, Visor de actividad, contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
const TEST_PASSWORD = randomPassword();

describe.skipIf(process.env.TEST_DB !== "1")("Visor de actividad: quién autorizó, aprobó o dio un descuento (MySQL real)", () => {
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
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba fase 7')`, [
      `f7${run}@test.local`, `f7${run}`, bcrypt.default.hashSync(TEST_PASSWORD, 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`f7${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `f7${run}`, password: TEST_PASSWORD })
    });
    token = ((await login.json()) as any).accessToken;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
  });

  let seq = 0;
  const today = new Date().toISOString().slice(0, 10);

  async function newAssociate() {
    const n = ++seq;
    const a = await call("POST", "/associates", {
      idType: "CC", idNumber: `11${run}${n}`, firstName: "Visor", lastName: `Fase7 ${run}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `v${run}${n}@test.local`, isEmployed: false, dataConsent: true
    });
    return a.body.id as number;
  }
  /** Crédito con primera cuota en el futuro, para poder cancelarlo con descuento. */
  async function newCredit() {
    const ap = await call("POST", "/applications", { titularAssociateId: await newAssociate(), requestedAmount: 1_000_000, termValue: 12, interestRate: 2 });
    const d = await call("GET", `/applications/${ap.body.id}`);
    for (const x of d.body.documents) await call("PUT", `/applications/${ap.body.id}/documents/${x.id}`, { status: "APROBADO" });
    for (const x of d.body.participants) await call("PUT", `/applications/${ap.body.id}/participants/${x.id}`, { status: "APROBADO" });
    expect((await call("POST", `/applications/${ap.body.id}/approve`, { approvedAmount: 900_000, observations: "ok" })).status).toBe(200);
    const first = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const dis = await call("POST", `/credits/applications/${ap.body.id}/disburse`, { disbursementDate: today, firstInstallmentDate: first });
    expect(dis.status).toBe(201);
    return { applicationId: ap.body.id as number, creditId: dis.body.id as number, creditNumber: dis.body.creditNumber as string };
  }
  const audit = async (qs: string) => (await call("GET", `/audit?${qs}&pageSize=100`)).body;

  it("cada registro dice en palabras qué hizo la persona y a qué crédito o solicitud se refiere", async () => {
    const c = await newCredit();
    const rows = (await audit(`credit=${c.creditNumber}`)).data as any[];
    const bySummary = (text: RegExp) => rows.find((r) => text.test(r.summary));

    const approve = bySummary(/^Aprobó la solicitud/);
    expect(approve.summary).toContain("monto $");
    expect(approve.entity_label).toMatch(/^Solicitud #\d+ de Visor/);
    expect(approve.link).toBe(`/solicitudes/${c.applicationId}`);
    expect(approve.user_name).toBe("Prueba fase 7");

    const disburse = bySummary(/^Desembolsó el crédito/);
    expect(disburse.summary).toContain(c.creditNumber);
    expect(disburse.entity_label).toBe(`Crédito ${c.creditNumber}`);
    expect(disburse.link).toBe(`/creditos/${c.creditId}`);
  });

  it("quién dio un descuento: ajustes manuales y descuento por pago anticipado", async () => {
    const c = await newCredit();
    // descuento manual
    const adj = await call("POST", `/credits/${c.creditId}/adjustments`, { type: "DESCUENTO", amount: 25_000, reason: "Pidió rebaja" });
    expect(adj.status).toBe(201);
    // cancelación anticipada con descuento
    const quote = (await call("GET", `/payments/quote?creditId=${c.creditId}&date=${today}`)).body.payoff;
    const payoff = await call("POST", "/payments/early-payoff", { creditId: c.creditId, receivedDate: today, paymentMethod: "EFECTIVO", expectedTotal: quote.total });
    expect(payoff.status).toBe(201);

    const discounts = (await audit(`credit=${c.creditNumber}&entity=credit_adjustment`)).data as any[];
    expect(discounts.map((r) => r.summary).sort()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Dio un descuento de \$\s?25\.000/), expect.stringMatching(/^Dio un descuento de .*50% del interés futuro/)])
    );
    expect(discounts.every((r) => r.user_name === "Prueba fase 7" && r.entity_label?.includes(c.creditNumber))).toBe(true);
    expect(discounts.find((r) => /25\.000/.test(r.summary)).reason).toBe("Pidió rebaja");

    const payoffRow = ((await audit(`credit=${c.creditNumber}&action=EARLY_PAYOFF`)).data as any[])[0];
    expect(payoffRow.summary).toMatch(/^Canceló el crédito por pago anticipado con \$/);
  });

  it("filtros: por crédito, por varias acciones a la vez, por usuario y búsqueda libre; el total respeta el filtro", async () => {
    const c1 = await newCredit();
    const c2 = await newCredit();
    const only1 = await audit(`credit=${c1.creditNumber}`);
    expect(only1.total).toBeGreaterThan(0);
    expect(only1.data.every((r: any) => !r.entity_label?.includes(c2.creditNumber))).toBe(true);
    expect((await audit(`credit=CR-0000-NO-EXISTE`)).total).toBe(0);

    const decisions = await audit(`credit=${c1.creditNumber}&action=APPROVE,REJECT`);
    expect(decisions.total).toBe(1);
    expect(decisions.data[0].action).toBe("APPROVE");

    const app = await audit(`application=${c1.applicationId}`);
    expect(app.data.every((r: any) => r.entity === "credit_application" && r.entity_id === String(c1.applicationId))).toBe(true);

    await call("POST", `/credits/${c1.creditId}/adjustments`, { type: "DESCUENTO", amount: 1111, reason: `Rebaja especial zxqv${run}` });
    const search = await audit(`q=zxqv${run}`);
    expect(search.total).toBe(1);
    expect(search.data[0].reason).toBe(`Rebaja especial zxqv${run}`);
    expect((await audit(`q=${encodeURIComponent("Prueba fase 7")}`)).total).toBeGreaterThan(5); // por nombre de usuario

    const assoc = await audit(`associate=999999999`);
    expect(assoc.total).toBe(0);
  });

  it("la exportación lleva la descripción y a qué se refiere cada registro", async () => {
    const c = await newCredit();
    const csv = await call("GET", `/audit/export.csv?credit=${c.creditNumber}`);
    expect(csv.status).toBe(200);
    const lines = csv.text.replace(/^\uFEFF/, "").trimEnd().split("\n");
    expect(lines[0]).toBe("id,fecha,usuario,accion,detalle,sobre,motivo,ip");
    expect(lines.some((l) => l.includes("Desembolsó el crédito") && l.includes(`Crédito ${c.creditNumber}`))).toBe(true);
  });
});
