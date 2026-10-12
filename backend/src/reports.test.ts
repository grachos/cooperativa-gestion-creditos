import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Reportes contra MySQL real (opcional; crea datos de prueba, usar una base de pruebas):
 *   TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
describe.skipIf(process.env.REPORTS_TEST_DB !== "1" && process.env.TEST_DB !== "1")("Reportes: caché con invalidación y exportación CSV (MySQL real)", () => {
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
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba reportes')`, [
      `rep${run}@test.local`, `rep${run}`, bcrypt.default.hashSync("Reportes-123*", 4)
    ]);
    await pool.query(`INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`, [`rep${run}`]);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `rep${run}`, password: "Reportes-123*" })
    });
    token = ((await login.json()) as any).accessToken;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
  });

  let seq = 0;
  async function newCredit(): Promise<number> {
    const n = ++seq;
    const a = await call("POST", "/associates", {
      idType: "CC", idNumber: `77${run}${n}`, firstName: "Rep", lastName: `Prueba ${n}`, birthDate: "1990-01-01",
      phone: "3001112233", email: `r${run}${n}@test.local`, isEmployed: false, dataConsent: true
    });
    const ap = await call("POST", "/applications", { titularAssociateId: a.body.id, requestedAmount: 1_200_000, termValue: 12, interestRate: 2 });
    const id = ap.body.id;
    const d = await call("GET", `/applications/${id}`);
    for (const x of d.body.documents) await call("PUT", `/applications/${id}/documents/${x.id}`, { status: "APROBADO" });
    for (const x of d.body.participants) await call("PUT", `/applications/${id}/participants/${x.id}`, { status: "APROBADO" });
    await call("POST", `/applications/${id}/approve`, {});
    const today = new Date().toISOString().slice(0, 10);
    const dis = await call("POST", `/credits/applications/${id}/disburse`, { disbursementDate: today, firstInstallmentDate: today });
    expect(dis.status).toBe(201);
    return dis.body.id as number;
  }

  it("el dashboard se sirve de la caché y se INVALIDA al registrar un pago (los números cambian al instante)", async () => {
    const creditId = await newCredit();
    const first = await call("GET", "/reports/dashboard");
    expect(first.status).toBe(200);
    const again = await call("GET", "/reports/dashboard");
    expect(again.headers.get("x-cache")).toBe("HIT");
    expect(again.body.pagosUltimos30Dias).toBe(first.body.pagosUltimos30Dias);

    const today = new Date().toISOString().slice(0, 10);
    const pay = await call("POST", "/payments", { creditId, receivedDate: today, amount: 123_456, paymentMethod: "EFECTIVO" });
    expect(pay.status).toBe(201);

    const after = await call("GET", "/reports/dashboard");
    expect(after.headers.get("x-cache")).not.toBe("HIT"); // se invalidó
    expect(after.body.pagosUltimos30Dias).toBeCloseTo(first.body.pagosUltimos30Dias + 123_456, 2);
  });

  it("pagos.csv: cabecera, filas = pagos en la base, escapado de fórmulas y comas", async () => {
    const creditId = await newCredit();
    const today = new Date().toISOString().slice(0, 10);
    expect((await call("POST", "/payments", { creditId, receivedDate: today, amount: 1000, paymentMethod: "=1+1" })).status).toBe(201);
    expect((await call("POST", "/payments", { creditId, receivedDate: today, amount: 2000, paymentMethod: "Pago, con coma" })).status).toBe(201);

    const res = await call("GET", "/reports/payments.csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const lines = res.text.trimEnd().split("\n");
    expect(lines[0]).toBe("id,credit_id,credit_number,received_date,amount,payment_method,status");
    const [{ n }] = (await pool.query<any[]>(`SELECT COUNT(*) AS n FROM payments`))[0] as any[];
    expect(lines.length - 1).toBe(Number(n));
    expect(lines.some((l) => l.includes(",'=1+1,"))).toBe(true); // fórmula neutralizada
    expect(lines.some((l) => l.includes('"Pago, con coma"'))).toBe(true);
  });

  it("/reports/overdue: sin page devuelve todo; con page devuelve una página con total", async () => {
    const all = await call("GET", "/reports/overdue");
    expect(all.status).toBe(200);
    const paged = await call("GET", "/reports/overdue?page=1&pageSize=1");
    expect(paged.status).toBe(200);
    expect(paged.body.total).toBe(all.body.data.length);
    expect(paged.body.data.length).toBe(Math.min(1, all.body.data.length));
    expect((await call("GET", "/reports/overdue?page=0")).status).toBe(400);
  });

  it("pagos.csv con filtro de fechas y validación", async () => {
    const out = await call("GET", "/reports/payments.csv?from=2000-01-01&to=2000-01-02");
    expect(out.status).toBe(200);
    expect(out.text.trimEnd().split("\n")).toHaveLength(1); // solo la cabecera
    expect((await call("GET", "/reports/payments.csv?from=ayer")).status).toBe(400);
  });

  it("los reportes mensuales siguen funcionando con caché (misma respuesta, X-Cache en la segunda)", async () => {
    const a = await call("GET", "/reports/monthly-summary");
    const b = await call("GET", "/reports/monthly-summary");
    expect(a.status).toBe(200);
    expect(b.headers.get("x-cache")).toBe("HIT");
    expect(b.body).toEqual(a.body);
    const m = new Date();
    const detail = await call("GET", `/reports/credits-monthly-detail?year=${m.getFullYear()}&month=${m.getMonth() + 1}`);
    expect(detail.status).toBe(200);
  });
});
