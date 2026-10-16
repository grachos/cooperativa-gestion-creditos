import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomPassword } from "./testSupport.js";

/**
 * Reunión 2026-10-16, Permisos por módulo, contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
const TEST_PASSWORD = randomPassword();
const TEST_PASSWORD2 = randomPassword();

describe.skipIf(process.env.TEST_DB !== "1")("Permisos por módulo y acción (MySQL real)", () => {
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
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba fase 6')`, [
      `f6${run}@test.local`, `f6${run}`, bcrypt.default.hashSync(TEST_PASSWORD, 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`f6${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `f6${run}`, password: TEST_PASSWORD })
    });
    token = ((await login.json()) as any).accessToken;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
  });

  let seq = 0;
  const today = new Date().toISOString().slice(0, 10);
  const PASSWORD = TEST_PASSWORD2;

  async function newUser(label: string, role: string) {
    const n = ++seq;
    const username = `${label}${run}${n}`;
    const r = await call("POST", "/users", { fullName: `U ${label} ${run}${n}`, email: `${username}@test.local`, username, password: PASSWORD, roleCodes: [role] });
    expect(r.status).toBe(201);
    return { id: r.body.id as number, username };
  }
  async function loginAs(username: string) {
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: username, password: PASSWORD })
    });
    return ((await res.json()) as any).accessToken as string;
  }
  async function permsOf(userId: number): Promise<string[]> {
    return (await call("GET", "/users/manage")).body.data.find((u: any) => u.id === userId).permissions;
  }
  /** Deja al usuario con sus permisos de rol menos `remove` más `add`, y devuelve una sesión nueva. */
  async function tune(u: { id: number; username: string }, remove: string[] = [], add: string[] = []) {
    const base0 = await permsOf(u.id);
    const r = await call("PUT", `/users/${u.id}/permissions`, { permissions: [...base0.filter((p) => !remove.includes(p)), ...add] });
    expect(r.status).toBe(200);
    return loginAs(u.username);
  }
  async function newAssociate() {
    const n = ++seq;
    const a = await call("POST", "/associates", {
      idType: "CC", idNumber: `22${run}${n}`, firstName: "Asoc", lastName: `Fase6 ${run}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `p${run}${n}@test.local`, isEmployed: false, dataConsent: true
    });
    expect(a.status).toBe(201);
    return a.body.id as number;
  }

  it("el catálogo agrupa los permisos por módulo, con una acción por casilla", async () => {
    const catalog = (await call("GET", "/users/permissions")).body.data as Array<{ module: string; label: string; actions: Array<{ code: string; label: string }> }>;
    const byModule = Object.fromEntries(catalog.map((m) => [m.module, m.actions.map((a) => a.code)]));
    expect(byModule.associates).toEqual(["associates:read", "associates:create", "associates:update", "associates:documents"]);
    expect(byModule.applications).toEqual(["applications:read", "applications:write", "applications:cancel", "applications:review", "applications:approve"]);
    expect(byModule.payments).toEqual(["payments:write", "payments:verify", "payments:reverse", "payments:payoff"]);
    expect(catalog.every((m) => m.label && m.actions.every((a) => a.label))).toBe(true);
    expect(catalog.flatMap((m) => m.actions.map((a) => a.code))).not.toContain("associates:write"); // el permiso antiguo ya no se muestra
  });

  it("ver cada módulo es un permiso aparte: quitarlo corta la lectura (403) y devolverlo la restablece", async () => {
    const reader = await newUser("lector", "CONSULTA");
    const id = await newAssociate();
    const paths = ["/associates", `/associates/${id}`, "/applications", "/credits", "/alerts"];
    const tk0 = await loginAs(reader.username);
    for (const p of paths) expect((await callAs(tk0, "GET", p)).status).toBe(200); // Consulta ve todo, como antes

    const tk = await tune(reader, ["associates:read", "applications:read", "credits:read", "alerts:read"]);
    for (const p of paths) expect((await callAs(tk, "GET", p)).status).toBe(403);
    expect((await callAs(tk, "GET", "/reports/dashboard")).status).toBe(200); // los reportes siguen: es otro módulo

    const tk2 = await tune(reader, [], ["credits:read"]);
    expect((await callAs(tk2, "GET", "/credits")).status).toBe(200);
    expect((await callAs(tk2, "GET", "/applications")).status).toBe(403);
  });

  it("asociados: crear, editar y marcar documentos son permisos distintos", async () => {
    const op = await newUser("asoc", "OPERADOR");
    const id = await newAssociate();
    const body = {
      idType: "CC", idNumber: `21${run}${++seq}`, firstName: "Nuevo", lastName: "Asociado", birthDate: "1990-01-01",
      phone: "3001112233", email: `q${run}${seq}@test.local`, isEmployed: false, dataConsent: true
    };
    const tk = await tune(op, ["associates:create"]);
    expect((await callAs(tk, "POST", "/associates", body)).status).toBe(403);
    expect((await callAs(tk, "POST", `/associates/${id}/status`, { status: "INACTIVO", reason: "prueba" })).status).not.toBe(403); // editar sigue permitido
    const docs = (await callAs(tk, "GET", `/associates/${id}/documents`)).body.data;
    expect((await callAs(tk, "PUT", `/associates/${id}/documents`, { documentType: docs[0].document_type, held: true })).status).toBe(200);

    const tk2 = await tune(op, ["associates:documents", "associates:update"], ["associates:create"]);
    expect((await callAs(tk2, "POST", "/associates", body)).status).toBe(201);
    expect((await callAs(tk2, "PUT", `/associates/${id}/documents`, { documentType: docs[0].document_type, held: true })).status).toBe(403);
    expect((await callAs(tk2, "POST", `/associates/${id}/status`, { status: "ACTIVO", reason: "x" })).status).toBe(403);
  });

  it("pagos: registrar, verificar, reversar y cancelar por pago anticipado se autorizan por separado", async () => {
    // crédito de prueba
    const ap = await call("POST", "/applications", { titularAssociateId: await newAssociate(), requestedAmount: 1_000_000, termValue: 12, interestRate: 2 });
    const d = await call("GET", `/applications/${ap.body.id}`);
    for (const x of d.body.documents) await call("PUT", `/applications/${ap.body.id}/documents/${x.id}`, { status: "APROBADO" });
    for (const x of d.body.participants) await call("PUT", `/applications/${ap.body.id}/participants/${x.id}`, { status: "APROBADO" });
    await call("POST", `/applications/${ap.body.id}/approve`, {});
    const dis = await call("POST", `/credits/applications/${ap.body.id}/disburse`, { disbursementDate: today, firstInstallmentDate: today });
    const creditId = dis.body.id;

    const op = await newUser("pagos", "OPERADOR");
    const tk = await tune(op, ["payments:verify", "payments:reverse", "payments:payoff"]);
    const paid = await callAs(tk, "POST", "/payments", { creditId, receivedDate: today, amount: 1000, paymentMethod: "EFECTIVO" });
    expect(paid.status).toBe(201); // registrar sigue permitido
    expect((await callAs(tk, "PUT", `/payments/${paid.body.paymentId}/verified`, { verified: true })).status).toBe(403);
    expect((await callAs(tk, "POST", `/payments/${paid.body.paymentId}/reverse`, { reason: "prueba de reverso" })).status).toBe(403);
    expect((await callAs(tk, "POST", "/payments/early-payoff", { creditId, receivedDate: today, paymentMethod: "EFECTIVO", expectedTotal: 1 })).status).toBe(403);

    const tk2 = await tune(op, [], ["payments:verify", "payments:reverse"]);
    expect((await callAs(tk2, "PUT", `/payments/${paid.body.paymentId}/verified`, { verified: true })).status).toBe(200);
    expect((await callAs(tk2, "POST", `/payments/${paid.body.paymentId}/reverse`, { reason: "prueba de reverso" })).status).toBe(200);
  });

  it("solicitudes: cancelar, desembolsar y refinanciar son permisos aparte", async () => {
    const op = await newUser("cancela", "OPERADOR");
    const ap = await call("POST", "/applications", { titularAssociateId: await newAssociate(), requestedAmount: 1_000_000, termValue: 12, interestRate: 2 });
    const tk = await tune(op, ["applications:cancel"]);
    expect((await callAs(tk, "POST", `/applications/${ap.body.id}/cancel`, { reason: "x" })).status).toBe(403);
    const tk2 = await tune(op, [], ["applications:cancel"]);
    expect((await callAs(tk2, "POST", `/applications/${ap.body.id}/cancel`, { reason: "x" })).status).toBe(200);

    const approver = await newUser("refi", "APROBADOR");
    const tk3 = await tune(approver, ["credits:refinance"]);
    expect((await callAs(tk3, "POST", "/credits/1/refinance", { termValue: 6, interestRate: 2, firstInstallmentDate: today, reason: "prueba" })).status).toBe(403);
  });

  it("exportar a CSV es un permiso aparte del de ver reportes", async () => {
    const viewer = await newUser("exporta", "CONSULTA");
    const tk = await tune(viewer, ["reports:export"]);
    expect((await callAs(tk, "GET", "/reports/dashboard")).status).toBe(200);
    expect((await callAs(tk, "GET", "/reports/payments.csv")).status).toBe(403);
    const tk2 = await tune(viewer, [], ["reports:export"]);
    expect((await callAs(tk2, "GET", "/reports/payments.csv")).status).toBe(200);
  });
});
