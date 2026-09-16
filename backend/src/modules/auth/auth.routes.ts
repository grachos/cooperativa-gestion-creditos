import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../../db/pool.js";
import { loginSchema } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./auth.service.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";

export const authRouter = Router();

async function loadUserWithAccess(userId: number) {
  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.email, u.username, u.full_name, u.status
     FROM users u WHERE u.id = ?`,
    [userId]
  );
  const user = (rows as any[])[0];
  if (!user) return null;

  const [roleRows] = await pool.query<any[]>(
    `SELECT r.code FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?`,
    [userId]
  );
  const roles = (roleRows as any[]).map((r) => r.code);

  const [permRows] = await pool.query<any[]>(
    `SELECT DISTINCT p.code FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = ?`,
    [userId]
  );
  const permissions = (permRows as any[]).map((p) => p.code);

  return { user, roles, permissions };
}

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { identifier, password } = loginSchema.parse(req.body);

    const [rows] = await pool.query<any[]>(
      `SELECT * FROM users WHERE (email = ? OR username = ?) AND status = 'ACTIVO'`,
      [identifier, identifier]
    );
    const dbUser = (rows as any[])[0];
    if (!dbUser) throw new HttpError(401, "Credenciales inválidas");

    const valid = await bcrypt.compare(password, dbUser.password_hash);
    if (!valid) {
      await pool.query(
        `INSERT INTO login_activity (user_id, event_type, ip_address) VALUES (?, 'LOGIN_FAILED', ?)`,
        [dbUser.id, req.ip]
      );
      throw new HttpError(401, "Credenciales inválidas");
    }

    const access = await loadUserWithAccess(dbUser.id);
    if (!access) throw new HttpError(401, "Credenciales inválidas");

    const accessToken = signAccessToken({
      sub: dbUser.id,
      roles: access.roles,
      permissions: access.permissions
    });
    const refreshToken = signRefreshToken(dbUser.id);
    const refreshHash = await bcrypt.hash(refreshToken, 10);

    await pool.query(`UPDATE users SET refresh_token_hash = ? WHERE id = ?`, [refreshHash, dbUser.id]);
    await pool.query(
      `INSERT INTO login_activity (user_id, event_type, ip_address) VALUES (?, 'LOGIN', ?)`,
      [dbUser.id, req.ip]
    );

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: dbUser.id,
        email: dbUser.email,
        fullName: dbUser.full_name,
        roles: access.roles,
        permissions: access.permissions
      }
    });
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const refreshToken = req.body?.refreshToken as string | undefined;
    if (!refreshToken) throw new HttpError(400, "refreshToken requerido");

    const decoded = verifyRefreshToken(refreshToken);
    const [rows] = await pool.query<any[]>(`SELECT * FROM users WHERE id = ?`, [decoded.sub]);
    const dbUser = (rows as any[])[0];
    if (!dbUser?.refresh_token_hash) throw new HttpError(401, "Sesión inválida");

    const matches = await bcrypt.compare(refreshToken, dbUser.refresh_token_hash);
    if (!matches) throw new HttpError(401, "Sesión inválida");

    const access = await loadUserWithAccess(dbUser.id);
    if (!access) throw new HttpError(401, "Sesión inválida");

    const accessToken = signAccessToken({
      sub: dbUser.id,
      roles: access.roles,
      permissions: access.permissions
    });
    res.json({ accessToken });
  })
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    await pool.query(`UPDATE users SET refresh_token_hash = NULL WHERE id = ?`, [req.user!.id]);
    await pool.query(
      `INSERT INTO login_activity (user_id, event_type, ip_address) VALUES (?, 'LOGOUT', ?)`,
      [req.user!.id, req.ip]
    );
    res.status(204).send();
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await loadUserWithAccess(req.user!.id);
    if (!access) throw new HttpError(404, "Usuario no encontrado");
    res.json({
      id: access.user.id,
      email: access.user.email,
      fullName: access.user.full_name,
      roles: access.roles,
      permissions: access.permissions
    });
  })
);
