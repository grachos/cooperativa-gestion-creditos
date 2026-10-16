import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomPassword } from "./testSupport.js";

/**
 * Pruebas de CARRERAS contra MySQL/MariaDB real: operaciones de dinero que dos
 * usuarios (o dos pestañas) pueden disparar a la vez. Verifican invariantes en
 * la base de datos, no solo códigos HTTP.
 *
 * Opcionales (requieren una base con las migraciones aplicadas):
 *   CONCURRENCY_TEST_DB=1 DB_HOST=127.0.0.1 DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 * ¡Usan datos de prueba y crean registros! Apúntelas a una base de pruebas.
 */
const enabled = process.env.CONCURRENCY_TEST_DB === "1" || process.env.TEST_DB === "1";

const TEST_PASSWORD = randomPassword();

describe.skipIf(!enabled)("Concurrencia en operaciones de dinero (MySQL real)", () => {
  let server: Server;
  let base: string;
  let token: string;
  let pool: typeof import("./db/pool.js").pool;
  const run = Date.now().toString().slice(-7);
  let seq = 0;

  async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
  }

  beforeAll(async () => {
    const [{ app }, poolMod, bcrypt] = await Promise.all([
      import("./app.js"),
      import("./db/pool.js"),
      import("bcryptjs")
    ]);
    pool = poolMod.pool;
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const hash = await bcrypt.default.hash(TEST_PASSWORD, 4);
    await pool.query(
      `INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba carreras')
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), status = 'ACTIVO'`,
      [`conc${run}@test.local`, `conc${run}`, hash]
    );
    await pool.query(
      `INSERT IGNORE INTO user_roles (user_id, role_id)
       SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'ADMIN'`,
      [`conc${run}`]
    );
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `conc${run}`, password: TEST_PASSWORD })
    });
    token = ((await login.json()) as any).accessToken;
    expect(token).toBeTruthy();
  });

  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
  });

  /** Crea asociado + solicitud aprobada (lista para desembolsar). */
  async function approvedApplication(amount = 1_200_000): Promise<number> {
    const n = ++seq;
    const assoc = await call("POST", "/associates", {
      idType: "CC",
      idNumber: `9${run}${String(n).padStart(3, "0")}`,
      firstName: "Prueba",
      lastName: `Carrera ${n}`,
      birthDate: "1990-01-01",
      phone: "3001112233",
      email: `c${run}${n}@test.local`,
      isEmployed: false,
      dataConsent: true
    });
    expect(assoc.status).toBe(201);
    const app = await call("POST", "/applications", {
      titularAssociateId: assoc.body.id,
      requestedAmount: amount,
      termValue: 12,
      interestRate: 2
    });
    expect(app.status).toBe(201);
    const id = app.body.id as number;
    const detail = await call("GET", `/applications/${id}`);
    for (const d of detail.body.documents) await call("PUT", `/applications/${id}/documents/${d.id}`, { status: "APROBADO" });
    for (const p of detail.body.participants) await call("PUT", `/applications/${id}/participants/${p.id}`, { status: "APROBADO" });
    expect((await call("POST", `/applications/${id}/approve`, {})).status).toBe(200);
    return id;
  }

  const disburseBody = { disbursementDate: "2026-08-10", firstInstallmentDate: "2026-09-10" };

  async function newCredit(): Promise<number> {
    const appId = await approvedApplication();
    const res = await call("POST", `/credits/applications/${appId}/disburse`, disburseBody);
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function installments(creditId: number) {
    const [rows] = await pool.query<any[]>(
      `SELECT id, principal_due, principal_paid, interest_paid, late_fee_paid FROM credit_schedule_installments WHERE credit_id = ?`,
      [creditId]
    );
    return (rows as any[]).map((r) => ({
      id: r.id as number,
      due: Number(r.principal_due),
      principalPaid: Number(r.principal_paid),
      paid: Number(r.principal_paid) + Number(r.interest_paid) + Number(r.late_fee_paid)
    }));
  }

  it("pagos simultáneos al mismo crédito no pierden ni duplican abonos", async () => {
    const creditId = await newCredit();
    const payments = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        call("POST", "/payments", {
          creditId,
          receivedDate: "2026-09-10",
          amount: 100_000,
          paymentMethod: "TRANSFERENCIA",
          reference: `conc-${run}-${i}`
        })
      )
    );
    expect(payments.map((p) => p.status)).toEqual(Array(8).fill(201));

    const inst = await installments(creditId);
    // (1) lo aplicado a cuotas = lo que hay en las cuotas (nada perdido ni duplicado)
    const [allocRows] = await pool.query<any[]>(
      `SELECT COALESCE(SUM(pa.amount), 0) AS total FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       WHERE p.credit_id = ? AND p.status = 'CONFIRMADO' AND pa.installment_id IS NOT NULL`,
      [creditId]
    );
    const allocated = Number((allocRows as any[])[0].total);
    expect(Math.round(inst.reduce((s, i) => s + i.paid, 0) * 100)).toBe(Math.round(allocated * 100));
    // (2) ninguna cuota abonada por encima de su capital
    for (const i of inst) expect(i.principalPaid).toBeLessThanOrEqual(i.due + 0.005);
    // (3) el saldo del crédito coincide con las cuotas
    const [credit] = await pool.query<any[]>(`SELECT principal_balance FROM credits WHERE id = ?`, [creditId]);
    const remaining = inst.reduce((s, i) => s + (i.due - i.principalPaid), 0);
    expect(Math.round(Number((credit as any[])[0].principal_balance) * 100)).toBe(Math.round(remaining * 100));
  });

  it("dos reversos simultáneos del mismo pago: solo uno se aplica", async () => {
    const creditId = await newCredit();
    const pay = await call("POST", "/payments", {
      creditId,
      receivedDate: "2026-09-10",
      amount: 300_000,
      paymentMethod: "EFECTIVO"
    });
    expect(pay.status).toBe(201);
    const results = await Promise.all(
      Array.from({ length: 3 }, () => call("POST", `/payments/${pay.body.paymentId}/reverse`, { reason: "error de captura" }))
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);

    const inst = await installments(creditId);
    for (const i of inst) expect(i.paid).toBeCloseTo(0, 2); // sin valores negativos ni residuos
  });

  it("una solicitud se desembolsa una sola vez aunque dos usuarios lo intenten a la vez", async () => {
    const appId = await approvedApplication();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => call("POST", `/credits/applications/${appId}/disburse`, disburseBody))
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 409)).toBe(true);
    const [rows] = await pool.query<any[]>(
      `SELECT COUNT(*) AS n FROM credits WHERE credit_application_id = ? AND refinanced_from_credit_id IS NULL`,
      [appId]
    );
    expect(Number((rows as any[])[0].n)).toBe(1);
  });

  it("desembolsos simultáneos de solicitudes distintas reciben números de crédito distintos", async () => {
    const appIds = await Promise.all(Array.from({ length: 5 }, () => approvedApplication()));
    const results = await Promise.all(appIds.map((id) => call("POST", `/credits/applications/${id}/disburse`, disburseBody)));
    expect(results.map((r) => r.status)).toEqual(Array(5).fill(201));
    const numbers = results.map((r) => r.body.creditNumber as string);
    expect(new Set(numbers).size).toBe(5);
  });

  it("dos refinanciaciones simultáneas del mismo crédito: solo una", async () => {
    const creditId = await newCredit();
    const body = { additionalCapital: 0, termValue: 6, interestRate: 2, firstInstallmentDate: "2026-12-10", reason: "refinanciación de prueba" };
    const results = await Promise.all(Array.from({ length: 3 }, () => call("POST", `/credits/${creditId}/refinance`, body)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 409)).toBe(true);
    const [rows] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM credits WHERE refinanced_from_credit_id = ?`, [creditId]);
    expect(Number((rows as any[])[0].n)).toBe(1);
  });
});
