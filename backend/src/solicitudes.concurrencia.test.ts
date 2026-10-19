import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomPassword } from "./testSupport.js";

/**
 * Reunión 2026-10-16, Correcciones H6 y H7 (solicitudes), contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
const TEST_PASSWORD = randomPassword();

describe.skipIf(process.env.TEST_DB !== "1")("Auditoría de transacciones: decisiones y radicación de solicitudes (MySQL real)", () => {
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
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba solicitudes')`, [
      `sol${run}@test.local`, `sol${run}`, bcrypt.default.hashSync(TEST_PASSWORD, 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`sol${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `sol${run}`, password: TEST_PASSWORD })
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
      idType: "CC", idNumber: `88${run}${n}`, firstName: "Sol", lastName: `Concurrencia ${run}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `sol${run}${n}@test.local`, isEmployed: false, dataConsent: true
    });
    expect(a.status).toBe(201);
    return a.body.id as number;
  }
  async function newApplication() {
    const ap = await call("POST", "/applications", { titularAssociateId: await newAssociate(), requestedAmount: 1_000_000, termValue: 12, interestRate: 2 });
    expect(ap.status).toBe(201);
    return ap.body.id as number;
  }
  async function approveAllItems(id: number) {
    const d = await call("GET", `/applications/${id}`);
    for (const x of d.body.documents) await call("PUT", `/applications/${id}/documents/${x.id}`, { status: "APROBADO" });
    for (const x of d.body.participants) await call("PUT", `/applications/${id}/participants/${x.id}`, { status: "APROBADO" });
  }
  async function history(id: number) {
    const [rows] = await pool.query<any[]>(`SELECT to_status FROM credit_application_status_history WHERE credit_application_id = ? ORDER BY id`, [id]);
    return (rows as any[]).map((r) => r.to_status as string);
  }

  it("H6: aprobar y rechazar a la vez: solo una decisión tiene efecto y el historial lo refleja", async () => {
    for (let i = 0; i < 4; i++) {
      const id = await newApplication();
      await approveAllItems(id);
      const [approve, reject] = await Promise.all([
        call("POST", `/applications/${id}/approve`, {}),
        call("POST", `/applications/${id}/reject`, { rejectionReason: "Prueba de concurrencia" })
      ]);
      const statuses = [approve.status, reject.status].sort();
      expect(statuses).toEqual([200, 409]);
      const final = (await call("GET", `/applications/${id}`)).body.status;
      expect(final).toBe(approve.status === 200 ? "APROBADA" : "RECHAZADA");
      const decisions = (await history(id)).filter((s) => s === "APROBADA" || s === "RECHAZADA");
      expect(decisions).toEqual([final]);
    }
  });

  it("H6: cancelar y desembolsar a la vez: nunca queda una solicitud cancelada con un crédito activo", async () => {
    for (let i = 0; i < 4; i++) {
      const id = await newApplication();
      await approveAllItems(id);
      expect((await call("POST", `/applications/${id}/approve`, {})).status).toBe(200);
      const [cancel, disburse] = await Promise.all([
        call("POST", `/applications/${id}/cancel`, { reason: "Prueba de concurrencia" }),
        call("POST", `/credits/applications/${id}/disburse`, { disbursementDate: today, firstInstallmentDate: today })
      ]);
      expect([cancel.status, disburse.status].filter((s) => s === 200 || s === 201)).toHaveLength(1);
      const app = (await call("GET", `/applications/${id}`)).body;
      const [credits] = await pool.query<any[]>(`SELECT COUNT(*) n FROM credits WHERE credit_application_id = ?`, [id]);
      if (disburse.status === 201) {
        expect(app.status).toBe("DESEMBOLSADA");
        expect(cancel.status).toBe(409);
        expect(Number((credits as any[])[0].n)).toBe(1);
      } else {
        expect(app.status).toBe("CANCELADA");
        expect(disburse.status).toBe(409);
        expect(Number((credits as any[])[0].n)).toBe(0);
      }
    }
  });

  it("H6: rechazar un documento mientras se aprueba: nunca queda APROBADA con un documento rechazado", async () => {
    for (let i = 0; i < 4; i++) {
      const id = await newApplication();
      await approveAllItems(id);
      const docId = (await call("GET", `/applications/${id}`)).body.documents[0].id;
      await Promise.all([
        call("POST", `/applications/${id}/approve`, {}),
        call("PUT", `/applications/${id}/documents/${docId}`, { status: "RECHAZADO", notes: "ilegible" })
      ]);
      const d = (await call("GET", `/applications/${id}`)).body;
      if (d.status === "APROBADA") expect(d.documents.every((x: any) => x.status === "APROBADO")).toBe(true);
      else expect(d.documents.find((x: any) => x.id === docId).status).toBe("RECHAZADO");
    }
  });

  it("H6: una solicitud ya decidida no acepta otra decisión ni revisiones", async () => {
    const id = await newApplication();
    await approveAllItems(id);
    expect((await call("POST", `/applications/${id}/approve`, {})).status).toBe(200);
    expect((await call("POST", `/applications/${id}/reject`, { rejectionReason: "tarde" })).status).toBe(409);
    expect((await call("POST", `/applications/${id}/approve`, {})).status).toBe(409);
    const docId = (await call("GET", `/applications/${id}`)).body.documents[0].id;
    expect((await call("PUT", `/applications/${id}/documents/${docId}`, { status: "RECHAZADO" })).status).toBe(409);
    expect((await call("POST", `/applications/${id}/references`, { referenceType: "PERSONAL", referenceName: "Ana", contacted: false })).status).toBe(409);
  });

  it("H7: radicar con un codeudor inexistente o el titular como codeudor responde 400 y no guarda nada", async () => {
    const titular = await newAssociate();
    const count = async () => {
      const [rows] = await pool.query<any[]>(`SELECT COUNT(*) n FROM credit_applications WHERE titular_associate_id = ?`, [titular]);
      return Number((rows as any[])[0].n);
    };
    const base = { titularAssociateId: titular, requestedAmount: 1_000_000, termValue: 12, interestRate: 2 };
    const missing = await call("POST", "/applications", { ...base, coDebtorAssociateIds: [999_999_999] });
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain("999999999");
    expect((await call("POST", "/applications", { ...base, coDebtorAssociateIds: [titular] })).status).toBe(400);
    expect((await call("POST", "/applications", { ...base, assignedSellerId: 999_999_999 })).status).toBe(400);
    expect(await count()).toBe(0);

    const ok = await call("POST", "/applications", { ...base, coDebtorAssociateIds: [await newAssociate()] });
    expect(ok.status).toBe(201);
    expect(await count()).toBe(1);
    expect(await history(ok.body.id)).toEqual(["RADICADA"]);
    const d = (await call("GET", `/applications/${ok.body.id}`)).body;
    expect(d.participants.map((p: any) => p.role).sort()).toEqual(["CODEUDOR", "TITULAR"]);
  });

  it("cancelar deja registro en la actividad", async () => {
    const id = await newApplication();
    expect((await call("POST", `/applications/${id}/cancel`, { reason: "El cliente desistió" })).status).toBe(200);
    const rows = (await call("GET", `/audit?application=${id}&action=CANCEL`)).body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toMatch(/^Canceló la solicitud/);
    expect(rows[0].reason).toBe("El cliente desistió");
  });
});
