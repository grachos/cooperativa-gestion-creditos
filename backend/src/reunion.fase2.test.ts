import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomPassword } from "./testSupport.js";

/**
 * Reunión 2026-10-16, Fase 2, contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
const TEST_PASSWORD = randomPassword();
const TEST_PASSWORD2 = randomPassword();

describe.skipIf(process.env.TEST_DB !== "1")("Fase 2 de la reunión: permisos por usuario, referencias, trazabilidad y reporte de actividad (MySQL real)", () => {
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
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba fase 2')`, [
      `f2${run}@test.local`, `f2${run}`, bcrypt.default.hashSync(TEST_PASSWORD, 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`f2${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `f2${run}`, password: TEST_PASSWORD })
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

  async function newUser(role: string, label: string) {
    const n = ++seq;
    const username = `${label}${run}${n}`;
    const r = await call("POST", "/users", {
      fullName: `Usuario ${label} ${run}${n}`, email: `${username}@test.local`, username, password: PASSWORD, roleCodes: [role]
    });
    expect(r.status).toBe(201);
    return { id: r.body.id as number, username, fullName: `Usuario ${label} ${run}${n}` };
  }
  async function loginAs(username: string) {
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: username, password: PASSWORD })
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as any).accessToken as string;
  }
  async function permsOf(userId: number): Promise<string[]> {
    const r = await call("GET", "/users/manage");
    return r.body.data.find((u: any) => u.id === userId).permissions;
  }
  async function newApplication(coDebtor = false) {
    const n = ++seq;
    const mk = async (label: string) => {
      const idNumber = `55${run}${n}${label.length}`;
      const a = await call("POST", "/associates", {
        idType: "CC", idNumber, firstName: label, lastName: `Fase2 ${run}`, birthDate: "1990-01-01",
        phone: "3001112233", email: `g${run}${n}${label}@test.local`, isEmployed: false, dataConsent: true
      });
      expect(a.status).toBe(201);
      return a.body.id as number;
    };
    const t = await mk("Titular");
    const co = coDebtor ? [await mk("Codeudora")] : [];
    const ap = await call("POST", "/applications", { titularAssociateId: t, coDebtorAssociateIds: co, requestedAmount: 1_000_000, termValue: 12, interestRate: 2 });
    expect(ap.status).toBe(201);
    return ap.body.id as number;
  }
  async function approveAll(id: number) {
    const d = await call("GET", `/applications/${id}`);
    for (const x of d.body.documents) await call("PUT", `/applications/${id}/documents/${x.id}`, { status: "APROBADO" });
    for (const x of d.body.participants) await call("PUT", `/applications/${id}/participants/${x.id}`, { status: "APROBADO" });
    return call("POST", `/applications/${id}/approve`, {});
  }

  it("el rol Aprobador conserva sus permisos (revisar y aprobar) y el Operador no puede revisar", async () => {
    const approver = await newUser("APROBADOR", "aprob");
    const operator = await newUser("OPERADOR", "oper");
    const id = await newApplication();
    const tApprover = await loginAs(approver.username);
    const tOperator = await loginAs(operator.username);
    expect((await callAs(tOperator, "POST", `/applications/${id}/review`)).status).toBe(403);
    expect((await callAs(tApprover, "POST", `/applications/${id}/review`)).status).toBe(200);
    // Aprobar y revisar son permisos distintos
    expect((await permsOf(approver.id))).toEqual(expect.arrayContaining(["applications:review", "applications:approve"]));
    expect((await permsOf(operator.id))).not.toContain("applications:review");
  });

  it("casillas por usuario: agregar y quitar permisos sobre los del rol, con efecto al volver a entrar", async () => {
    const operator = await newUser("OPERADOR", "casilla");
    const base0 = await permsOf(operator.id);
    expect(base0).toContain("payments:write");
    expect(base0).not.toContain("applications:review");

    const desired = [...base0.filter((p) => p !== "payments:write"), "applications:review"];
    const saved = await call("PUT", `/users/${operator.id}/permissions`, { permissions: desired });
    expect(saved.status).toBe(200);
    expect(saved.body.granted).toEqual(["applications:review"]);
    expect(saved.body.denied).toEqual(["payments:write"]);
    expect((await permsOf(operator.id)).sort()).toEqual([...desired].sort());

    const tk = await loginAs(operator.username);
    const id = await newApplication();
    expect((await callAs(tk, "POST", `/applications/${id}/review`)).status).toBe(200); // permiso agregado
    expect((await callAs(tk, "POST", "/payments", { creditId: 1, receivedDate: today, amount: 1000, paymentMethod: "EFECTIVO" })).status).toBe(403); // permiso quitado

    // volver a dejar exactamente lo del rol borra las diferencias
    const reset = await call("PUT", `/users/${operator.id}/permissions`, { permissions: base0 });
    expect(reset.body.granted).toEqual([]);
    expect(reset.body.denied).toEqual([]);
    const [rows] = await pool.query<any[]>(`SELECT COUNT(*) c FROM user_permissions WHERE user_id = ?`, [operator.id]);
    expect(Number((rows as any[])[0].c)).toBe(0);
  });

  it("casillas: validaciones y protección contra quitarse la administración de usuarios", async () => {
    const me = (await call("GET", "/auth/me")).body;
    const mine = await permsOf(me.id);
    expect((await call("PUT", `/users/${me.id}/permissions`, { permissions: mine.filter((p) => p !== "users:write") })).status).toBe(400);
    const other = await newUser("CONSULTA", "val");
    expect((await call("PUT", `/users/${other.id}/permissions`, { permissions: ["reports:read", "no:existe"] })).status).toBe(400);
    expect((await call("PUT", "/users/999999999/permissions", { permissions: [] })).status).toBe(404);
    // sin el permiso de administrar usuarios no se pueden tocar casillas
    const tk = await loginAs(other.username);
    expect((await callAs(tk, "PUT", `/users/${other.id}/permissions`, { permissions: ["reports:read", "users:write"] })).status).toBe(403);
    const catalog = (await call("GET", "/users/permissions")).body.data as Array<{ module: string; actions: Array<{ code: string; label: string }> }>;
    expect(catalog.map((m) => m.module)).toEqual(expect.arrayContaining(["associates", "applications", "credits", "payments", "reports", "audit"]));
    expect(catalog.flatMap((m) => m.actions.map((a) => a.code))).toContain("applications:review");
  });

  it("referencias: se registra quién las verificó y el resultado; solo en solicitudes abiertas", async () => {
    const id = await newApplication();
    const base = { referenceType: "PERSONAL", referenceName: "María Pérez", phone: "3001234567" };
    expect((await call("POST", `/applications/${id}/references`, { ...base, contacted: true })).status).toBe(400); // contactada sin resultado
    const ok = await call("POST", `/applications/${id}/references`, { ...base, contacted: true, result: "POSITIVA", notes: "Confirma ingresos" });
    expect(ok.status).toBe(201);
    const pending = await call("POST", `/applications/${id}/references`, { referenceType: "LABORAL", referenceName: "Recursos Humanos ACME", contacted: false });
    expect(pending.status).toBe(201);

    let detail = (await call("GET", `/applications/${id}`)).body;
    expect(detail.references).toHaveLength(2);
    const first = detail.references.find((r: any) => r.id === ok.body.id);
    expect(first).toMatchObject({ reference_type: "PERSONAL", contacted: true, result: "POSITIVA", checked_by_name: "Prueba fase 2" });
    expect(detail.references.find((r: any) => r.id === pending.body.id).result).toBeNull();

    const upd = await call("PUT", `/applications/${id}/references/${pending.body.id}`, {
      referenceType: "LABORAL", referenceName: "Recursos Humanos ACME", contacted: true, result: "NEGATIVA", notes: "No reconocen al titular"
    });
    expect(upd.status).toBe(200);
    detail = (await call("GET", `/applications/${id}`)).body;
    expect(detail.references.find((r: any) => r.id === pending.body.id).result).toBe("NEGATIVA");
    expect((await call("PUT", `/applications/${id}/references/999999`, { ...base, contacted: false })).status).toBe(404);

    expect((await approveAll(id)).status).toBe(200);
    expect((await call("POST", `/applications/${id}/references`, { ...base, contacted: false })).status).toBe(409); // ya no está abierta
  });

  it("trazabilidad: la solicitud y el crédito muestran quién hizo cada paso", async () => {
    const id = await newApplication();
    expect((await call("POST", `/applications/${id}/review`)).status).toBe(200);
    expect((await approveAll(id)).status).toBe(200);
    const dis = await call("POST", `/credits/applications/${id}/disburse`, { disbursementDate: today, firstInstallmentDate: today });
    expect(dis.status).toBe(201);
    const pay = await call("POST", "/payments", { creditId: dis.body.id, receivedDate: today, amount: 5000, paymentMethod: "EFECTIVO" });
    expect(pay.status).toBe(201);
    await call("POST", `/credits/${dis.body.id}/promises`, { promiseDate: today, description: "x" });

    const app = (await call("GET", `/applications/${id}`)).body;
    expect(app.created_by_name).toBe("Prueba fase 2");
    expect(app.decided_by_name).toBe("Prueba fase 2");
    expect(app.documents.every((d: any) => d.reviewed_by_name === "Prueba fase 2")).toBe(true);
    expect(app.participants.every((p: any) => p.reviewed_by_name === "Prueba fase 2")).toBe(true);
    expect(app.history.length).toBeGreaterThanOrEqual(3);
    expect(app.history.every((h: any) => h.user_name === "Prueba fase 2")).toBe(true);

    const credit = (await call("GET", `/credits/${dis.body.id}`)).body;
    expect(credit.disbursed_by_name).toBe("Prueba fase 2");
    expect(credit.payments[0].created_by_name).toBe("Prueba fase 2");
    expect(credit.collectionActions[0].created_by_name).toBe("Prueba fase 2");
  });

  it("actividad por usuario: filtros por usuario, acción y fechas, con el nombre de quien actuó", async () => {
    const actor = await newUser("APROBADOR", "act");
    const tk = await loginAs(actor.username);
    const id = await newApplication();
    expect((await callAs(tk, "POST", `/applications/${id}/review`)).status).toBe(200);
    const d = (await call("GET", `/applications/${id}`)).body;
    await callAs(tk, "PUT", `/applications/${id}/documents/${d.documents[0].id}`, { status: "RECHAZADO", notes: "ilegible" });

    const mine = await call("GET", `/audit?userId=${actor.id}`);
    expect(mine.status).toBe(200);
    expect(mine.body.total).toBeGreaterThanOrEqual(2);
    expect(mine.body.data.every((r: any) => r.user_id === actor.id && r.user_name === actor.fullName)).toBe(true);
    const actions = mine.body.data.map((r: any) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["REVIEW_START", "DOCUMENT_REVIEW"]));

    const onlyDocs = await call("GET", `/audit?userId=${actor.id}&action=DOCUMENT_REVIEW`);
    expect(onlyDocs.body.data.every((r: any) => r.action === "DOCUMENT_REVIEW")).toBe(true);
    expect(onlyDocs.body.total).toBe(1);
    expect((await call("GET", `/audit?userId=${actor.id}&from=2999-01-01`)).body.total).toBe(0);
    expect((await call("GET", `/audit?userId=${actor.id}&from=${today}&to=${today}`)).body.total).toBe(mine.body.total);
    expect((await call("GET", "/audit?from=ayer")).status).toBe(400);

    const filters = (await call("GET", "/audit/filters")).body;
    expect(filters.actions).toContain("DOCUMENT_REVIEW");
    expect(filters.users.map((u: any) => u.id)).toContain(actor.id);

    const csv = await call("GET", `/audit/export.csv?userId=${actor.id}`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const lines = csv.text.replace(/^\uFEFF/, "").trimEnd().split("\n");
    expect(lines[0]).toBe("id,fecha,usuario,accion,detalle,sobre,motivo,ip");
    expect(lines).toHaveLength(1 + mine.body.total);

    // sin audit:read no se ve la actividad
    const op = await newUser("OPERADOR", "sinaudit");
    expect((await callAs(await loginAs(op.username), "GET", "/audit")).status).toBe(403);
  });
});
