import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Anti-bots con la aplicación completa y TURNSTILE_ENFORCE=true (como en producción): sin llave secreta el servidor
 * falla cerrado y nadie inicia sesión, y la política de contenido deja cargar el widget de Cloudflare.
 */
describe.skipIf(process.env.TEST_DB !== "1")("Anti-bots en las rutas reales (enforce activo)", () => {
  let server: Server;
  let base: string;
  let pool: typeof import("../src/db/pool.js").pool;

  beforeAll(async () => {
    process.env.TURNSTILE_ENFORCE = "true";
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.TURNSTILE_SITE_KEY = "clave-publica-de-prueba";
    const [{ app }, poolMod] = await Promise.all([import("./app.js"), import("./db/pool.js")]);
    pool = poolMod.pool as never;
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", r);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
  });

  // Identificador único por corrida: los fallos se acumulan 15 minutos por identificador y harían salir 429.
  const who = `anon${Date.now()}${Math.floor(Math.random() * 1e6)}@x.com`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}/api/v1/auth${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("las tres rutas públicas exigen el reto: sin llave secreta se rechazan (falla cerrado) con CAPTCHA-02", async () => {
    for (const [path, body] of [
      ["/login", { identifier: who, password: "x", "cf-turnstile-response": "token" }],
      ["/forgot-password", { identifier: who, "cf-turnstile-response": "token" }],
      ["/reset-password", { token: "t".repeat(20), newPassword: "Nueva-Clave-123!", uid: 1, "cf-turnstile-response": "token" }]
    ] as const) {
      const res = await post(path, body);
      expect(res.status, path).toBe(403);
      expect(await res.json()).toMatchObject({ code: "CAPTCHA-02", status: "validation_failed" });
    }
  });

  it("sin token: CAPTCHA-02 por configuración (el servidor no tiene llave) y nunca llega a validar la contraseña", async () => {
    const res = await post("/login", { identifier: who, password: "x" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toMatch(/^CAPTCHA-0[23]$/);
  });

  it("GET /auth/captcha-config entrega la clave pública y si se exige el reto, y nunca la clave secreta", async () => {
    const res = await fetch(`${base}/api/v1/auth/captcha-config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["enforce", "siteKey"]);
    expect(body).toEqual({ enforce: true, siteKey: "clave-publica-de-prueba" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("la política de contenido permite el script y el iframe de challenges.cloudflare.com", async () => {
    const res = await fetch(`${base}/api/v1/health`);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src[^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toMatch(/frame-src[^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toMatch(/default-src 'self'/);
  });
});
