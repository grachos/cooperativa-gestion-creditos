import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomPassword } from "./testSupport.js";

/**
 * Auditoría de transacciones, H8: la clave de idempotencia se confirma en la misma transacción del efecto. Contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
const TEST_PASSWORD = randomPassword();

describe.skipIf(process.env.TEST_DB !== "1")("Idempotencia dentro de la transacción (H8, MySQL real)", () => {
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
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba idempotencia H8')`, [
      `h8${run}@test.local`, `h8${run}`, bcrypt.default.hashSync(TEST_PASSWORD, 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`h8${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `h8${run}`, password: TEST_PASSWORD })
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

  async function newCredit(firstInstallmentDate = dayOffset(20)) {
    const n = ++seq;
    const a = await call("POST", "/associates", {
      idType: "CC", idNumber: `98${run}${n}`, firstName: "Tx", lastName: `Auditoria ${run}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `h8${run}${n}@test.local`, isEmployed: false, dataConsent: true
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
  const payBody = (creditId: number, amount: number) => ({ creditId, receivedDate: today, amount, paymentMethod: "EFECTIVO" });
  const paymentsOf = async (creditId: number) =>
    Number(((await pool.query<any[]>(`SELECT COUNT(*) AS n FROM payments WHERE credit_id = ?`, [creditId]))[0] as any[])[0].n);
  const keyRow = async (key: string) =>
    ((await pool.query<any[]>(`SELECT state, response_status FROM idempotency_keys WHERE idempotency_key = ?`, [key]))[0] as any[])[0];

  /** Simula una falla después del COMMIT (p. ej. se cae algo al avisar a las pantallas): la ruta responde 500. */
  function failNextBroadcast() {
    const original = sseHub.broadcastMany;
    sseHub.broadcastMany = () => {
      sseHub.broadcastMany = original;
      throw new Error("falla simulada después del COMMIT");
    };
  }

  it("un error después del COMMIT no permite duplicar el pago al reintentar con la misma clave", async () => {
    const creditId = await newCredit();
    const key = `h8-pago-${run}-${Date.now()}`;
    failNextBroadcast();
    const first = await call("POST", "/payments", payBody(creditId, 50_000), key);
    expect(first.status).toBe(500);
    expect(await paymentsOf(creditId)).toBe(1); // el pago quedó guardado
    expect((await keyRow(key)).state).toBe("COMPLETED"); // y la clave con él

    const retry = await call("POST", "/payments", payBody(creditId, 50_000), key);
    expect(retry.status).toBe(201);
    expect(retry.headers.get("idempotent-replayed")).toBe("true");
    expect(retry.body.paymentId).toBeGreaterThan(0);
    expect(await paymentsOf(creditId)).toBe(1); // sin duplicado
  });

  it("si la transacción se revierte, la clave se libera y el reintento sí ejecuta", async () => {
    const creditId = await newCredit();
    const key = `h8-rollback-${run}-${Date.now()}`;
    const tooMuch = await call("POST", "/payments", payBody(creditId, 99_000_000), key);
    expect(tooMuch.status).toBe(409); // excedente (H4): rollback después de aplicar el pago
    expect(await keyRow(key)).toBeUndefined();
    expect(await paymentsOf(creditId)).toBe(0);
  });

  it("la radicación también confirma la clave en su transacción", async () => {
    const a = await call("POST", "/associates", {
      idType: "CC", idNumber: `97${run}`, firstName: "H8", lastName: `Radica ${run}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `h8r${run}@test.local`, isEmployed: false, dataConsent: true
    });
    const key = `h8-radica-${run}-${Date.now()}`;
    const appBody = { titularAssociateId: a.body.id, requestedAmount: 1_000_000, termValue: 10, interestRate: 2 };
    failNextBroadcast();
    expect((await call("POST", "/applications", appBody, key)).status).toBe(500);
    const retry = await call("POST", "/applications", appBody, key);
    expect(retry.status).toBe(201);
    expect(retry.headers.get("idempotent-replayed")).toBe("true");
    const [rows] = await pool.query<any[]>(
      `SELECT COUNT(*) AS n FROM credit_participants WHERE associate_id = ? AND role = 'TITULAR'`,
      [a.body.id]
    );
    expect(Number((rows as any[])[0].n)).toBe(1);
  });
});
