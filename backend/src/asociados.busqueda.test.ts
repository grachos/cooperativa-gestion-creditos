import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomPassword } from "./testSupport.js";

/**
 * Búsqueda de asociados por varias palabras (nombre, apellido o cédula), usada por el selector con búsqueda. Contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
const TEST_PASSWORD = randomPassword();

describe.skipIf(process.env.TEST_DB !== "1")("Búsqueda de asociados por varias palabras (MySQL real)", () => {
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
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba búsqueda')`, [
      `bq${run}@test.local`, `bq${run}`, bcrypt.default.hashSync(TEST_PASSWORD, 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`bq${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `bq${run}`, password: TEST_PASSWORD })
    });
    token = ((await login.json()) as any).accessToken;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
  });

  it("encuentra por nombre, apellido o cédula, con varias palabras en cualquier orden", async () => {
    const doc = `95${run}`;
    const created = await call("POST", "/associates", {
      idType: "CC", idNumber: doc, firstName: `Zoila Marcela${run}`, lastName: "Quintero Valbuena", birthDate: "1990-01-01",
      phone: "3001112233", email: `bq${run}a@test.local`, isEmployed: false, dataConsent: true
    });
    expect(created.status).toBe(201);
    const find = async (q: string) =>
      (await call("GET", `/associates?selectable=true&pageSize=20&search=${encodeURIComponent(q)}`)).body.data.map((a: any) => a.id);

    expect(await find(`zoila quintero`)).toContain(created.body.id);
    expect(await find(`quintero marcela${run}`)).toContain(created.body.id);
    expect(await find(`${doc} valbuena`)).toContain(created.body.id);
    expect(await find(doc)).toEqual([created.body.id]);
    expect(await find(`zoila apellido-inexistente`)).not.toContain(created.body.id);
  });
});
