import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Anti-bots (incremento 2): límites por IP e identificador en la base, reto de Turnstile y auditoría. Contra MySQL real
 * (opcional; crea filas en auth_attempts/auth_audit, usar una base de pruebas): TEST_DB=1 DB_HOST=… npm test
 * Los límites se pasan a mano (no por variables de entorno) y cada prueba usa su propia IP (X-Forwarded-For).
 */
describe.skipIf(process.env.TEST_DB !== "1")("authGuard (MySQL real)", () => {
  let pool: typeof import("../db/pool.js").pool;
  let server: Server;
  let base: string;
  const run = Date.now().toString().slice(-6);
  // IPv6 única por corrida (prefijo aleatorio): las filas de corridas anteriores siguen en la ventana de 15 min.
  const prefix = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  let seq = 0;
  const newIp = () => `2001:db8:${prefix.slice(0, 4)}:${prefix.slice(4)}::${(++seq).toString(16)}`;
  const verify = vi.fn();
  let limits = { windowMinutes: 15, ipTotal: 100, ipFailed: 100, identifierFailed: 100 };
  let enforce = false;

  beforeAll(async () => {
    const [{ default: express }, poolMod, guard] = await Promise.all([import("express"), import("../db/pool.js"), import("./authGuard.js")]);
    pool = poolMod.pool;
    const app = express();
    app.set("trust proxy", true);
    app.use(express.json());
    app.post(
      "/login",
      guard.authRateLimit("login", () => limits),
      guard.requireTurnstile("login", { enforce: undefined, verify: ((...a: unknown[]) => verify(...a)) as never }),
      async (req, res) => {
        if (req.body.password === "correcta") {
          await guard.markAuthSuccess(res);
          res.locals.authOutcome = "SUCCESS";
          return res.json({ ok: true });
        }
        return res.status(401).json({ error: "Credenciales inválidas" });
      }
    );
    // Segunda ruta con enforce encendido, para el reto.
    app.post(
      "/protegida",
      guard.authRateLimit("login", () => limits),
      guard.requireTurnstile("login", { enforce: true, verify: ((...a: unknown[]) => verify(...a)) as never }),
      (_req, res) => res.json({ ok: true })
    );
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", r);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
  });

  const post = (path: string, body: unknown, ip: string, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, "user-agent": "prueba-antibots/1.0", ...headers },
      body: JSON.stringify(body)
    });
  const login = (identifier: string, password: string, ip: string) => post("/login", { identifier, password }, ip);

  it("limita los intentos fallidos por IP (429) y no afecta a otra IP", async () => {
    limits = { windowMinutes: 15, ipTotal: 100, ipFailed: 3, identifierFailed: 100 };
    const ip = newIp();
    for (let i = 0; i < 3; i++) expect((await login(`u${run}-${i}@x.com`, "mala", ip)).status).toBe(401);
    const blocked = await login(`u${run}-9@x.com`, "mala", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("900");
    expect((await blocked.json()).code).toBe("RATE_LIMITED");
    expect((await login(`u${run}-1@x.com`, "mala", newIp())).status).toBe(401);
  });

  it("limita por identificador, exista o no la cuenta, desde cualquier IP; un acceso exitoso reinicia el contador", async () => {
    limits = { windowMinutes: 15, ipTotal: 100, ipFailed: 100, identifierFailed: 3 };
    const ghost = `fantasma${run}@x.com`;
    for (let i = 0; i < 3; i++) expect((await login(ghost, "mala", newIp())).status).toBe(401);
    expect((await login(ghost, "mala", newIp())).status).toBe(429); // la cuenta no existe y se bloquea igual
    expect((await login(ghost.toUpperCase(), "mala", newIp())).status).toBe(429); // mayúsculas no la libran
    expect((await login(`otra${run}@x.com`, "mala", newIp())).status).toBe(401); // otro identificador no se afecta

    const id = `real${run}@x.com`;
    const ip = newIp();
    for (let i = 0; i < 2; i++) expect((await login(id, "mala", ip)).status).toBe(401);
    expect((await login(id, "correcta", ip)).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await login(id, "mala", ip)).status).toBe(401); // contador reiniciado
    expect((await login(id, "mala", ip)).status).toBe(429);
  });

  it("limita las peticiones totales por IP", async () => {
    limits = { windowMinutes: 15, ipTotal: 3, ipFailed: 100, identifierFailed: 100 };
    const ip = newIp();
    for (let i = 0; i < 3; i++) expect((await login(`t${run}${i}@x.com`, "correcta", ip)).status).toBe(200);
    expect((await login(`t${run}9@x.com`, "correcta", ip)).status).toBe(429);
  });

  it("una ráfaga simultánea no se cuela por encima del límite", async () => {
    limits = { windowMinutes: 15, ipTotal: 100, ipFailed: 100, identifierFailed: 5 };
    const id = `rafaga${run}@x.com`;
    const results = await Promise.all(Array.from({ length: 14 }, () => login(id, "mala", newIp())));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s === 401 || s === 429).length).toBe(14);
  });

  it("el reto: sin superar → 403 con code/status/message, sin motivo ni códigos de Cloudflare, y cuenta como intento fallido", async () => {
    limits = { windowMinutes: 15, ipTotal: 100, ipFailed: 2, identifierFailed: 100 };
    verify.mockReset();
    verify.mockResolvedValue({ ok: false, code: "CAPTCHA-03", reason: "token_rejected", errorCodes: ["timeout-or-duplicate"] });
    const ip = newIp();
    const r = await post("/protegida", { identifier: `c${run}@x.com`, "cf-turnstile-response": "token-del-usuario-123" }, ip);
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(Object.keys(body).sort()).toEqual(["code", "message", "status"]);
    expect(body).toMatchObject({ code: "CAPTCHA-03", status: "validation_failed" });
    expect(JSON.stringify(body)).not.toContain("timeout-or-duplicate");
    expect(verify).toHaveBeenCalledWith("token-del-usuario-123", "login", ip);

    // Dos fallos más de reto agotan el límite de fallidos de esa IP: ya ni se consulta a Cloudflare.
    await post("/protegida", { identifier: `c${run}@x.com` }, ip);
    verify.mockClear();
    const blocked = await post("/protegida", { identifier: `c${run}@x.com`, "cf-turnstile-response": "otro" }, ip);
    expect(blocked.status).toBe(429);
    expect(verify).not.toHaveBeenCalled();
  });

  it("el reto superado deja pasar, y con enforce apagado se omite (queda como SKIPPED)", async () => {
    limits = { windowMinutes: 15, ipTotal: 100, ipFailed: 100, identifierFailed: 100 };
    verify.mockReset();
    verify.mockResolvedValue({ ok: true, hostname: "coomulnissi.cc", action: "login" });
    expect((await post("/protegida", { "cf-turnstile-response": "bueno" }, newIp())).status).toBe(200);
    // Token también por cabecera.
    expect((await post("/protegida", {}, newIp(), { "cf-turnstile-response": "bueno-cabecera" })).status).toBe(200);
    expect(verify).toHaveBeenLastCalledWith("bueno-cabecera", "login", expect.any(String));

    verify.mockClear();
    expect((await login(`s${run}@x.com`, "correcta", newIp())).status).toBe(200); // /login usa enforce de entorno (apagado en pruebas)
    expect(verify).not.toHaveBeenCalled();
  });

  it("audita cada petición con IP, agente, acción y resultados; nunca guarda contraseñas, tokens ni el identificador en claro", async () => {
    limits = { windowMinutes: 15, ipTotal: 100, ipFailed: 100, identifierFailed: 100 };
    verify.mockReset();
    verify.mockResolvedValue({ ok: false, code: "CAPTCHA-02", reason: "verification_failed", errorCodes: ["internal-error"] });
    const ip = newIp();
    const identifier = `Auditado.${run}@x.com`;
    await post("/protegida", { identifier, password: "CLAVE-SECRETA-777", "cf-turnstile-response": "TOKEN-SECRETO-777" }, ip);
    await login(identifier, "CLAVE-SECRETA-777", ip);

    let rows: any[] = [];
    for (let i = 0; i < 30 && rows.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 50));
      [rows] = (await pool.query(`SELECT * FROM auth_audit WHERE ip_address = ? ORDER BY id`, [ip])) as any;
    }
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      action: "login",
      user_agent: "prueba-antibots/1.0",
      turnstile_result: "CAPTCHA-02",
      turnstile_reason: "verification_failed",
      outcome: "CAPTCHA_FAILED",
      http_status: 403
    });
    expect(rows[1]).toMatchObject({ turnstile_result: "SKIPPED", outcome: "INVALID_CREDENTIALS", http_status: 401 });
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("CLAVE-SECRETA-777");
    expect(dump).not.toContain("TOKEN-SECRETO-777");
    expect(dump).not.toContain(identifier);
    expect(rows[0].identifier_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
