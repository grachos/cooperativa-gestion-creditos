import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomPassword } from "./testSupport.js";

/**
 * Cambio de la fecha de una solicitud por el administrador, con registro de quién y por qué. Contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
const TEST_PASSWORD = randomPassword();

describe.skipIf(process.env.TEST_DB !== "1")("Cambio de fecha de una solicitud (MySQL real)", () => {
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
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba fecha')`, [
      `fd${run}@test.local`, `fd${run}`, bcrypt.default.hashSync(TEST_PASSWORD, 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`fd${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `fd${run}`, password: TEST_PASSWORD })
    });
    token = ((await login.json()) as any).accessToken;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
  });

  async function newApplication() {
    const a = await call("POST", "/associates", {
      idType: "CC", idNumber: `94${run}${Math.floor(Math.random() * 900 + 100)}`, firstName: "Fecha", lastName: `Prueba ${run}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `fd${run}${Math.floor(Math.random() * 9000)}@test.local`, isEmployed: false, dataConsent: true
    });
    const ap = await call("POST", "/applications", { titularAssociateId: a.body.id, requestedAmount: 1_000_000, termValue: 10, interestRate: 2 });
    expect(ap.status).toBe(201);
    return ap.body.id as number;
  }
  const dateChanges = async (id: number) => {
    const [rows] = await pool.query<any[]>(
      `SELECT user_id, reason, old_value, new_value FROM audit_logs WHERE entity = 'credit_application' AND entity_id = ? AND action = 'DATE_CHANGE'`,
      [id]
    );
    return rows as any[];
  };

  it("el administrador cambia la fecha y queda registrado quién, la fecha anterior, la nueva y el motivo", async () => {
    const id = await newApplication();
    const before = (await call("GET", `/applications/${id}`)).body;
    const r = await call("PATCH", `/applications/${id}/date`, { date: "2024-03-15", reason: "Carga de solicitud antigua" });
    expect(r.status).toBe(200);
    const after = (await call("GET", `/applications/${id}`)).body;
    expect(String(after.created_at)).toMatch(/^2024-03-15/);
    expect(String(after.created_at)).not.toBe(String(before.created_at));

    const rows = await dateChanges(id);
    expect(rows).toHaveLength(1);
    const parse = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
    expect(rows[0].reason).toBe("Carga de solicitud antigua");
    expect(parse(rows[0].old_value).date).toBe(String(before.created_at).slice(0, 10));
    expect(parse(rows[0].new_value).date).toBe("2024-03-15");
    const [[me]] = (await pool.query(`SELECT id FROM users WHERE username = ?`, [`fd${run}`])) as any;
    expect(rows[0].user_id).toBe(me.id);

    // El visor de actividad lo describe.
    const act = await call("GET", `/audit?application=${id}&action=DATE_CHANGE`);
    expect(act.status).toBe(200);
    expect(JSON.stringify(act.body)).toContain("Cambió la fecha de la solicitud");
  });

  it("rechaza fecha futura, inválida, sin motivo y solicitud inexistente, sin dejar registro", async () => {
    const id = await newApplication();
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await call("PATCH", `/applications/${id}/date`, { date: future, reason: "Prueba" })).status).toBe(400);
    expect((await call("PATCH", `/applications/${id}/date`, { date: "no-es-fecha", reason: "Prueba" })).status).toBe(400);
    expect((await call("PATCH", `/applications/${id}/date`, { date: "2024-01-01", reason: " " })).status).toBe(400);
    expect((await call("PATCH", `/applications/999999999/date`, { date: "2024-01-01", reason: "Prueba" })).status).toBe(404);
    expect(await dateChanges(id)).toHaveLength(0);
  });

  it("quien no tiene el permiso no puede cambiarla", async () => {
    const id = await newApplication();
    const bcrypt = await import("bcryptjs");
    const pwd = randomPassword();
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Aprobador sin permiso de fecha')`, [
      `fd${run}b@test.local`, `fd${run}b`, bcrypt.default.hashSync(pwd, 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'APROBADOR'`, [`fd${run}b`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `fd${run}b`, password: pwd })
    });
    const tk = ((await login.json()) as any).accessToken;
    expect((await callAs(tk, "PATCH", `/applications/${id}/date`, { date: "2024-01-01", reason: "Prueba" })).status).toBe(403);
    expect(await dateChanges(id)).toHaveLength(0);
  });
});
