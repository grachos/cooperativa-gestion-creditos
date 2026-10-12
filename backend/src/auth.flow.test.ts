import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcryptjs from "bcryptjs";

// Captura el enlace de restablecimiento en vez de enviar un correo.
const sentLinks: string[] = [];
vi.mock("./modules/auth/mailer.js", () => ({
  sendPasswordResetEmail: async (_to: string, url: string) => {
    sentLinks.push(url);
  }
}));

/**
 * Flujo de autenticación contra MySQL real (opcional):
 *   AUTH_TEST_DB=1 DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… npm test
 */
describe.skipIf(process.env.AUTH_TEST_DB !== "1")("Autenticación: tokens con SHA-256 y compatibilidad con bcrypt", () => {
  let server: Server;
  let base: string;
  let pool: typeof import("./db/pool.js").pool;
  const run = Date.now().toString().slice(-7);
  const username = `auth${run}`;
  const password = "Auth-flow-123*";

  const post = (path: string, body: unknown, token?: string) =>
    fetch(`${base}/api/v1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    });
  const storedRefresh = async () => {
    const [rows] = await pool.query<any[]>(`SELECT id, refresh_token_hash FROM users WHERE username = ?`, [username]);
    return (rows as any[])[0] as { id: number; refresh_token_hash: string | null };
  };

  beforeAll(async () => {
    const [{ app }, poolMod] = await Promise.all([import("./app.js"), import("./db/pool.js")]);
    pool = poolMod.pool;
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", r);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Usuario con hash de contraseña de bcryptjs (como los creados antes del cambio).
    await pool.query(`INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, 'Prueba auth')`, [
      `${username}@test.local`,
      username,
      bcryptjs.hashSync(password, 10)
    ]);
    await pool.query(
      `INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = ? AND r.code = 'CONSULTA'`,
      [username]
    );
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
  });

  it("login con una contraseña hasheada con bcryptjs funciona, y la sesión se guarda con SHA-256", async () => {
    const res = await post("/auth/login", { identifier: username, password });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.accessToken && body.refreshToken).toBeTruthy();
    const { refresh_token_hash } = await storedRefresh();
    expect(refresh_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(refresh_token_hash).not.toContain(body.refreshToken);

    const refreshed = await post("/auth/refresh", { refreshToken: body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(((await refreshed.json()) as any).accessToken).toBeTruthy();
    expect((await post("/auth/refresh", { refreshToken: body.refreshToken + "x" })).status).toBe(401);
  });

  it("una sesión antigua (refresh token con hash bcrypt) sigue funcionando y se migra a SHA-256", async () => {
    const res = await post("/auth/login", { identifier: username, password });
    const { refreshToken } = (await res.json()) as any;
    const user = await storedRefresh();
    // Simula la sesión guardada por la versión anterior.
    await pool.query(`UPDATE users SET refresh_token_hash = ? WHERE id = ?`, [bcryptjs.hashSync(refreshToken, 10), user.id]);
    expect((await storedRefresh()).refresh_token_hash).toMatch(/^\$2/);

    expect((await post("/auth/refresh", { refreshToken })).status).toBe(200);
    expect((await storedRefresh()).refresh_token_hash).toMatch(/^[0-9a-f]{64}$/); // migrada
    expect((await post("/auth/refresh", { refreshToken })).status).toBe(200); // y sigue válida
  });

  it("cerrar sesión invalida el refresh token", async () => {
    const login = (await (await post("/auth/login", { identifier: username, password })).json()) as any;
    expect((await post("/auth/logout", {}, login.accessToken)).status).toBe(204);
    expect((await post("/auth/refresh", { refreshToken: login.refreshToken })).status).toBe(401);
  });

  it("restablecer contraseña: el token se guarda con SHA-256, sirve una sola vez y el viejo password deja de valer", async () => {
    sentLinks.length = 0;
    expect((await post("/auth/forgot-password", { identifier: username })).status).toBe(204);
    expect(sentLinks).toHaveLength(1);
    const url = new URL(sentLinks[0]!);
    const token = url.searchParams.get("token")!;
    const uid = Number(url.searchParams.get("uid"));
    const [rows] = await pool.query<any[]>(`SELECT token_hash FROM password_reset_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [uid]);
    expect((rows as any[])[0].token_hash).toMatch(/^[0-9a-f]{64}$/);

    expect((await post("/auth/reset-password", { token, uid, newPassword: "Nueva-clave-456*" })).status).toBe(204);
    expect((await post("/auth/reset-password", { token, uid, newPassword: "Otra-clave-789*" })).status).toBe(400); // un solo uso
    expect((await post("/auth/login", { identifier: username, password })).status).toBe(401);
    expect((await post("/auth/login", { identifier: username, password: "Nueva-clave-456*" })).status).toBe(200);
  });

  it("un enlace de restablecimiento antiguo (token con hash bcrypt) sigue siendo válido", async () => {
    const rawToken = "a".repeat(64);
    const user = await storedRefresh();
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
      [user.id, bcryptjs.hashSync(rawToken, 10)]
    );
    expect((await post("/auth/reset-password", { token: rawToken, uid: user.id, newPassword: "Clave-legacy-1*" })).status).toBe(204);
  });
});
