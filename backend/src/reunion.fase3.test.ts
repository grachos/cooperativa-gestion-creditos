import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomPassword } from "./testSupport.js";

/**
 * Reunión 2026-10-16, Fases 3 y 4, contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
const TEST_PASSWORD = randomPassword();
const TEST_PASSWORD2 = randomPassword();

describe.skipIf(process.env.TEST_DB !== "1")("Fases 3 y 4 de la reunión: asesores, documentos del asociado y cobro jurídico (MySQL real)", () => {
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
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba fase 3')`, [
      `f3${run}@test.local`, `f3${run}`, bcrypt.default.hashSync(TEST_PASSWORD, 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`f3${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `f3${run}`, password: TEST_PASSWORD })
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

  async function newUser(label: string, roleCodes: string[] = []) {
    const n = ++seq;
    const username = `${label}${run}${n}`;
    const r = await call("POST", "/users", {
      fullName: `Asesor ${label} ${run}${n}`, email: `${username}@test.local`, username, password: PASSWORD, roleCodes
    });
    expect(r.status).toBe(201);
    return { id: r.body.id as number, username, fullName: `Asesor ${label} ${run}${n}` };
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
      idType: "CC", idNumber: `44${run}${n}`, firstName: "Asoc", lastName: `Fase3 ${run}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `h${run}${n}@test.local`, isEmployed: false, dataConsent: true
    });
    expect(a.status).toBe(201);
    return a.body.id as number;
  }
  async function approveAll(id: number) {
    const d = await call("GET", `/applications/${id}`);
    for (const x of d.body.documents) await call("PUT", `/applications/${id}/documents/${x.id}`, { status: "APROBADO" });
    for (const x of d.body.participants) await call("PUT", `/applications/${id}/participants/${x.id}`, { status: "APROBADO" });
    return call("POST", `/applications/${id}/approve`, {});
  }
  async function newCredit(sellerId?: number, disburseSellerId?: number) {
    const ap = await call("POST", "/applications", {
      titularAssociateId: await newAssociate(), requestedAmount: 1_000_000, termValue: 12, interestRate: 2, assignedSellerId: sellerId
    });
    expect(ap.status).toBe(201);
    expect((await approveAll(ap.body.id)).status).toBe(200);
    const dis = await call("POST", `/credits/applications/${ap.body.id}/disburse`, {
      disbursementDate: today, firstInstallmentDate: today, assignedSellerId: disburseSellerId
    });
    expect(dis.status).toBe(201);
    return { applicationId: ap.body.id as number, creditId: dis.body.id as number };
  }

  it("asesor: se asigna al radicar, pasa al crédito al desembolsar y se puede cambiar en el desembolso", async () => {
    const seller = await newUser("ases"); // usuario sin roles: no entra al sistema
    const other = await newUser("otro");
    const a = await newCredit(seller.id);
    const app = (await call("GET", `/applications/${a.applicationId}`)).body;
    expect(app.assigned_seller_id).toBe(seller.id);
    expect(app.seller_name).toBe(seller.fullName);
    expect((await call("GET", `/credits/${a.creditId}`)).body.seller_name).toBe(seller.fullName); // heredado

    const b = await newCredit(seller.id, other.id); // el desembolso manda
    expect((await call("GET", `/credits/${b.creditId}`)).body.seller_name).toBe(other.fullName);

    const none = await newCredit();
    expect((await call("GET", `/credits/${none.creditId}`)).body.assigned_seller_id).toBeNull();
  });

  it("asesor: no se puede asignar un usuario inexistente o inactivo", async () => {
    const t = await newAssociate();
    const body = { titularAssociateId: t, requestedAmount: 1_000_000, termValue: 12, interestRate: 2 };
    expect((await call("POST", "/applications", { ...body, assignedSellerId: 999999999 })).status).toBe(400);
    const inactive = await newUser("inact");
    await call("PATCH", `/users/${inactive.id}`, { status: "INACTIVO" });
    expect((await call("POST", "/applications", { ...body, assignedSellerId: inactive.id })).status).toBe(400);
  });

  it("créditos por asesor: filtro en el listado y reporte con totales", async () => {
    const seller = await newUser("rep");
    const c1 = await newCredit(seller.id);
    const c2 = await newCredit(seller.id);
    await newCredit(); // sin asesor

    const list = await call("GET", `/credits?sellerId=${seller.id}`);
    expect(list.body.total).toBe(2);
    expect(list.body.data.map((c: any) => c.id).sort()).toEqual([c1.creditId, c2.creditId].sort());
    expect(list.body.data.every((c: any) => c.seller_name === seller.fullName)).toBe(true);
    const unassigned = await call("GET", "/credits?sellerId=none");
    expect(unassigned.body.data.every((c: any) => c.assigned_seller_id === null)).toBe(true);
    expect((await call("GET", "/credits?sellerId=abc")).status).toBe(400);

    const rep = await call("GET", "/reports/by-seller");
    expect(rep.status).toBe(200);
    const row = rep.body.data.find((r: any) => r.sellerId === seller.id);
    expect(row).toMatchObject({ sellerName: seller.fullName, credits: 2, disbursedAmount: 2_000_000, creditsInArrears: 0 });
    expect(row.outstandingPrincipal).toBeCloseTo(2_000_000, 2);
    expect(rep.body.data.some((r: any) => r.sellerId === null && r.sellerName === "Sin asesor")).toBe(true);
  });

  it("documentos del asociado: lista de chequeo con quién y cuándo; solo documentos de la lista", async () => {
    const id = await newAssociate();
    const params = (await call("GET", "/parameters")).body as any[];
    const types: string[] = params.find((p) => p.key === "documentos_asociado").value;
    expect(types.length).toBeGreaterThan(0);

    const initial = (await call("GET", `/associates/${id}/documents`)).body.data;
    expect(initial.map((d: any) => d.document_type)).toEqual(types);
    expect(initial.every((d: any) => d.held === false && d.checked_by_name === null)).toBe(true);

    const put = await call("PUT", `/associates/${id}/documents`, { documentType: types[0], held: true, notes: "Copia en archivo" });
    expect(put.status).toBe(200);
    let list = (await call("GET", `/associates/${id}/documents`)).body.data;
    expect(list[0]).toMatchObject({ document_type: types[0], held: true, notes: "Copia en archivo", checked_by_name: "Prueba fase 3" });
    expect(list[1].held).toBe(false);
    await call("PUT", `/associates/${id}/documents`, { documentType: types[0], held: false });
    list = (await call("GET", `/associates/${id}/documents`)).body.data;
    expect(list[0].held).toBe(false);

    expect((await call("PUT", `/associates/${id}/documents`, { documentType: "Documento inventado", held: true })).status).toBe(400);
    expect((await call("PUT", "/associates/999999999/documents", { documentType: types[0], held: true })).status).toBe(404);
    const reader = await newUser("lector", ["CONSULTA"]);
    expect((await callAs(await loginAs(reader.username), "PUT", `/associates/${id}/documents`, { documentType: types[0], held: true })).status).toBe(403);
  });

  it("cobro jurídico: documentos que se tienen y bitácora de gestiones del crédito", async () => {
    const { creditId } = await newCredit();
    const types: string[] = ((await call("GET", "/parameters")).body as any[]).find((p) => p.key === "documentos_juridicos").value;
    const docs = (await call("GET", `/credits/${creditId}/legal-documents`)).body.data;
    expect(docs.map((d: any) => d.document_type)).toEqual(types);

    expect((await call("PUT", `/credits/${creditId}/legal-documents`, { documentType: types[1], held: true })).status).toBe(200);
    const after = (await call("GET", `/credits/${creditId}/legal-documents`)).body.data;
    expect(after[1]).toMatchObject({ held: true, checked_by_name: "Prueba fase 3" });
    expect((await call("PUT", `/credits/${creditId}/legal-documents`, { documentType: "Inventado", held: true })).status).toBe(400);
    expect((await call("GET", "/credits/999999999/legal-documents")).status).toBe(404);

    expect((await call("POST", `/credits/${creditId}/actions`, { actionType: "NOTIFICACION", description: "ab" })).status).toBe(400);
    const created = await call("POST", `/credits/${creditId}/actions`, { actionType: "PREPARACION_JURIDICA", description: "Se envió carta de cobro prejurídico" });
    expect(created.status).toBe(201);
    let detail = (await call("GET", `/credits/${creditId}`)).body;
    const action = detail.collectionActions.find((a: any) => a.id === created.body.id);
    expect(action).toMatchObject({ action_type: "PREPARACION_JURIDICA", status: "PENDIENTE", created_by_name: "Prueba fase 3" });
    expect(action.promise_date).toBeNull();

    expect((await call("POST", `/credits/actions/${created.body.id}/complete`)).status).toBe(200);
    detail = (await call("GET", `/credits/${creditId}`)).body;
    expect(detail.collectionActions.find((a: any) => a.id === created.body.id).status).toBe("COMPLETADA");

    // un compromiso de pago no se completa por esta vía
    const promise = await call("POST", `/credits/${creditId}/promises`, { promiseDate: today, description: "x" });
    expect((await call("POST", `/credits/actions/${promise.body.id}/complete`)).status).toBe(404);
  });
});
