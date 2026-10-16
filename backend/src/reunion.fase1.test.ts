import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Reunión 2026-10-16, Fase 1, contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
describe.skipIf(process.env.TEST_DB !== "1")("Fase 1 de la reunión: documentos por participante, compromisos, pagos verificados, desembolso y búsqueda (MySQL real)", () => {
  let pool: typeof import("./db/pool.js").pool;
  let server: Server;
  let base: string;
  let token: string;
  const run = Date.now().toString().slice(-7);

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
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

  beforeAll(async () => {
    const [{ app }, poolMod, bcrypt] = await Promise.all([import("./app.js"), import("./db/pool.js"), import("bcryptjs")]);
    pool = poolMod.pool;
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", r);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba fase 1')`, [
      `f1${run}@test.local`, `f1${run}`, bcrypt.default.hashSync("Fase1-123*", 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`f1${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `f1${run}`, password: "Fase1-123*" })
    });
    token = ((await login.json()) as any).accessToken;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
  });

  let seq = 0;
  const today = new Date().toISOString().slice(0, 10);
  async function newAssociate(label: string) {
    const n = ++seq;
    const idNumber = `66${run}${n}`;
    const a = await call("POST", "/associates", {
      idType: "CC", idNumber, firstName: label, lastName: `Fase1 ${run}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `f${run}${n}@test.local`, isEmployed: false, dataConsent: true
    });
    expect(a.status).toBe(201);
    return { id: a.body.id as number, idNumber };
  }
  async function approveAll(id: number) {
    const d = await call("GET", `/applications/${id}`);
    for (const x of d.body.documents) await call("PUT", `/applications/${id}/documents/${x.id}`, { status: "APROBADO" });
    for (const x of d.body.participants) await call("PUT", `/applications/${id}/participants/${x.id}`, { status: "APROBADO" });
    return call("POST", `/applications/${id}/approve`, {});
  }

  it("documentos por participante: el titular y cada codeudor reciben la lista parametrizada de su rol", async () => {
    // No se modifican los parámetros: los otros archivos de prueba corren en paralelo y comparten la base
    // (cambiar la lista mientras otra prueba aprueba solicitudes le agrega documentos pendientes).
    const params = (await call("GET", "/parameters")).body as any[];
    const list = (k: string): string[] => params.find((p) => p.key === k).value;
    const titularDocs = list("documentos_requeridos_titular");
    const codeudorDocs = list("documentos_requeridos_codeudor");
    expect(titularDocs.length).toBeGreaterThan(0);
    expect(codeudorDocs.length).toBeGreaterThan(0);

    const t = await newAssociate("Titular");
    const c1 = await newAssociate("Codeudor1");
    const c2 = await newAssociate("Codeudor2");
    const ap = await call("POST", "/applications", {
      titularAssociateId: t.id, coDebtorAssociateIds: [c1.id, c2.id], requestedAmount: 1_000_000, termValue: 12, interestRate: 2
    });
    const id = ap.body.id;
    const d = await call("GET", `/applications/${id}`);
    const docs = d.body.documents as any[];
    expect(docs).toHaveLength(titularDocs.length + 2 * codeudorDocs.length);
    const roleOf = (pid: number) => d.body.participants.find((p: any) => p.id === pid).role;
    expect(docs.filter((x) => roleOf(x.credit_participant_id) === "TITULAR").map((x) => x.document_type).sort()).toEqual([...titularDocs].sort());
    for (const cp of (d.body.participants as any[]).filter((p) => p.role === "CODEUDOR")) {
      expect(docs.filter((x) => x.credit_participant_id === cp.id).map((x) => x.document_type).sort()).toEqual([...codeudorDocs].sort());
    }
    // pedir el detalle otra vez no duplica
    expect(((await call("GET", `/applications/${id}`)).body.documents as any[]).length).toBe(docs.length);

    // aprobar con documentos pendientes: el error dice de qué participante
    const blocked = await call("POST", `/applications/${id}/approve`, {});
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body)).toContain("CODEUDOR");
    expect((await approveAll(id)).status).toBe(200);
  });

  it("solicitudes anteriores (documentos sin participante) conservan su lista y no se les agregan filas", async () => {
    const t = await newAssociate("Legado");
    const ap = await call("POST", "/applications", { titularAssociateId: t.id, requestedAmount: 1_000_000, termValue: 12, interestRate: 2 });
    const id = ap.body.id;
    await pool.query(`DELETE FROM credit_application_documents WHERE credit_application_id = ?`, [id]);
    await pool.query(`INSERT INTO credit_application_documents (credit_application_id, document_type) VALUES (?, 'Documento antiguo')`, [id]);
    const d = await call("GET", `/applications/${id}`);
    expect(d.body.documents).toHaveLength(1);
    expect(d.body.documents[0].credit_participant_id).toBeNull();
  });

  async function newCredit(extra: Record<string, unknown> = {}) {
    const t = await newAssociate("Credito");
    const ap = await call("POST", "/applications", { titularAssociateId: t.id, requestedAmount: 1_200_000, termValue: 12, interestRate: 2 });
    expect((await approveAll(ap.body.id)).status).toBe(200);
    const dis = await call("POST", `/credits/applications/${ap.body.id}/disburse`, { disbursementDate: today, firstInstallmentDate: today, ...extra });
    expect(dis.status).toBe(201);
    return { creditId: dis.body.id as number, creditNumber: dis.body.creditNumber as string, applicationId: ap.body.id as number, associate: t };
  }

  it("desembolso: guarda la cuenta destino, la cuenta de la cooperativa y si el soporte quedó archivado", async () => {
    const c = await newCredit({
      disbursementToAccount: "Bancolombia ahorros 111-222", disbursementFromAccount: "Davivienda corriente 999", disbursementProofFiled: true
    });
    const d = (await call("GET", `/credits/${c.creditId}`)).body;
    expect(d.disbursement_to_account).toBe("Bancolombia ahorros 111-222");
    expect(d.disbursement_from_account).toBe("Davivienda corriente 999");
    expect(d.disbursement_proof_filed).toBe(true);
    const plain = await newCredit();
    expect((await call("GET", `/credits/${plain.creditId}`)).body.disbursement_proof_filed).toBe(false);
  });

  it("compromiso de pago: la observación se guarda aparte de la nota", async () => {
    const c = await newCredit();
    const r = await call("POST", `/credits/${c.creditId}/promises`, {
      promiseDate: today, description: "Pagará el viernes", observation: "Titular se retiró de la empresa, pasa a PU"
    });
    expect(r.status).toBe(201);
    const action = ((await call("GET", `/credits/${c.creditId}`)).body.collectionActions as any[]).find((a) => a.id === r.body.id);
    expect(action.description).toBe("Pagará el viernes");
    expect(action.observation).toBe("Titular se retiró de la empresa, pasa a PU");
  });

  it("pago verificado: se marca al registrar o después, con quién lo verificó", async () => {
    const c = await newCredit();
    const p1 = await call("POST", "/payments", { creditId: c.creditId, receivedDate: today, amount: 1000, paymentMethod: "TRANSFERENCIA", verified: true });
    const p2 = await call("POST", "/payments", { creditId: c.creditId, receivedDate: today, amount: 2000, paymentMethod: "TRANSFERENCIA" });
    const list = async () => (await call("GET", `/credits/${c.creditId}`)).body.payments as any[];
    let rows = await list();
    const r1 = rows.find((r) => r.id === p1.body.paymentId);
    const r2 = rows.find((r) => r.id === p2.body.paymentId);
    expect(r1.verified).toBe(true);
    expect(r1.verified_by_name).toBe("Prueba fase 1");
    expect(r2.verified).toBe(false);
    expect((await call("PUT", `/payments/${p2.body.paymentId}/verified`, { verified: true })).status).toBe(200);
    expect((await list()).find((r) => r.id === p2.body.paymentId).verified).toBe(true);
    expect((await call("PUT", `/payments/${p2.body.paymentId}/verified`, { verified: false })).status).toBe(200);
    expect((await list()).find((r) => r.id === p2.body.paymentId).verified).toBe(false);
    expect((await call("PUT", "/payments/999999999/verified", { verified: true })).status).toBe(404);

    // cronograma: la cuota que recibió pagos muestra cuántos siguen sin verificar
    const sched = async () => ((await call("GET", `/credits/${c.creditId}`)).body.schedule as any[])[0];
    expect((await sched()).payments_count).toBe(2);
    expect((await sched()).unverified_payments).toBe(1); // p2 quedó sin verificar
    await call("PUT", `/payments/${p2.body.paymentId}/verified`, { verified: true });
    expect((await sched()).unverified_payments).toBe(0);
    const untouched = ((await call("GET", `/credits/${c.creditId}`)).body.schedule as any[]).at(-1);
    expect(untouched.payments_count).toBe(0);
  });

  it("búsqueda en solicitudes y créditos: por cédula (prefijo), nombre y número de crédito; el total respeta el filtro", async () => {
    const c = await newCredit();
    const byId = await call("GET", `/applications?search=${c.associate.idNumber}`);
    expect(byId.body.total).toBe(1);
    expect(byId.body.data[0].id).toBe(c.applicationId);
    const byPrefix = await call("GET", `/applications?search=${c.associate.idNumber.slice(0, 8)}`);
    expect(byPrefix.body.total).toBeGreaterThanOrEqual(1);
    expect((await call("GET", "/applications?search=zzzNoExiste")).body.total).toBe(0);
    expect((await call("GET", `/applications?search=Credito Fase1 ${run}&status=DESEMBOLSADA`)).body.data.every((a: any) => a.status === "DESEMBOLSADA")).toBe(true);

    const credits = await call("GET", `/credits?search=${c.creditNumber}`);
    expect(credits.body.total).toBe(1);
    expect(credits.body.data[0].id).toBe(c.creditId);
    expect((await call("GET", `/credits?search=${c.associate.idNumber}`)).body.data[0].id).toBe(c.creditId);
    expect((await call("GET", `/credits?search=Credito Fase1 ${run}`)).body.total).toBeGreaterThanOrEqual(1);
    expect((await call("GET", "/credits?search=zzzNoExiste")).body.total).toBe(0);
  });
});
