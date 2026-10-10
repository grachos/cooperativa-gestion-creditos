import crypto from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { forgotPasswordSchema, loginSchema, resetPasswordSchema } from "../../shared/schemas.js";
import { asyncHandler, HttpError } from "../../middlewares/error.middleware.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./auth.service.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { sendPasswordResetEmail } from "./mailer.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora
const MAX_FAILED_LOGINS = 5;
const LOGIN_LOCK_WINDOW_MIN = 15;
const MAX_RESET_EMAILS_PER_HOUR = 3;

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

    // Contador en BD (no en memoria): en Vercel cada invocación puede caer en
    // una instancia distinta, así que un límite en memoria no frenaría nada.
    const [failedRows] = await pool.query<any[]>(
      `SELECT COUNT(*) AS total FROM login_activity
       WHERE user_id = ? AND event_type = 'LOGIN_FAILED'
         AND created_at > NOW() - INTERVAL ? MINUTE
         AND created_at > COALESCE(
           (SELECT MAX(created_at) FROM login_activity WHERE user_id = ? AND event_type = 'LOGIN'),
           '1970-01-01 00:00:01'
         )`,
      [dbUser.id, LOGIN_LOCK_WINDOW_MIN, dbUser.id]
    );
    if (Number((failedRows as any[])[0].total) >= MAX_FAILED_LOGINS) {
      throw new HttpError(
        429,
        `Demasiados intentos fallidos. Espera ${LOGIN_LOCK_WINDOW_MIN} minutos o restablece tu contraseña.`
      );
    }

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
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { identifier } = forgotPasswordSchema.parse(req.body);

    const [rows] = await pool.query<any[]>(
      `SELECT id, email FROM users WHERE (email = ? OR username = ?) AND status = 'ACTIVO'`,
      [identifier, identifier]
    );
    const dbUser = (rows as any[])[0];

    // Tope de correos por usuario: evita que alguien use el endpoint para
    // inundar un buzón o agotar la cuota del proveedor de correo.
    let underLimit = false;
    if (dbUser) {
      const [recentRows] = await pool.query<any[]>(
        `SELECT COUNT(*) AS total FROM password_reset_tokens
         WHERE user_id = ? AND created_at > NOW() - INTERVAL 1 HOUR`,
        [dbUser.id]
      );
      underLimit = Number((recentRows as any[])[0].total) < MAX_RESET_EMAILS_PER_HOUR;
    }

    // Siempre responde 204, exista o no el usuario y se haya enviado o no:
    // evita que alguien use este endpoint para averiguar qué cuentas existen.
    if (dbUser && underLimit) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = await bcrypt.hash(rawToken, 10);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
        [dbUser.id, tokenHash, expiresAt]
      );

      const resetUrl = `${env.APP_URL.replace(/\/$/, "")}/restablecer-contrasena?token=${rawToken}&uid=${dbUser.id}`;
      try {
        await sendPasswordResetEmail(dbUser.email, resetUrl);
      } catch (err) {
        // No dejar que una falla del proveedor de correo (SMTP caído, límite
        // de envíos, restricción de sandbox, etc.) tumbe el endpoint — el
        // token ya quedó guardado, y seguimos respondiendo 204 igual que si
        // el usuario no existiera, sin filtrar el motivo del fallo.
        console.error("[auth] Error enviando correo de restablecimiento:", err);
      }
    }

    res.status(204).send();
  })
);

authRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);
    const uid = Number(req.body?.uid);
    if (!uid) throw new HttpError(400, "Solicitud de restablecimiento inválida");

    const [rows] = await pool.query<any[]>(
      `SELECT * FROM password_reset_tokens
       WHERE user_id = ? AND used_at IS NULL AND expires_at > NOW()
       ORDER BY id DESC`,
      [uid]
    );

    let matchedTokenId: number | null = null;
    for (const row of rows as any[]) {
      if (await bcrypt.compare(token, row.token_hash)) {
        matchedTokenId = row.id;
        break;
      }
    }
    if (!matchedTokenId) throw new HttpError(400, "El enlace de restablecimiento es inválido o venció");

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query(`UPDATE users SET password_hash = ?, refresh_token_hash = NULL WHERE id = ?`, [
      passwordHash,
      uid
    ]);
    await pool.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?`, [matchedTokenId]);

    res.status(204).send();
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const refreshToken = req.body?.refreshToken as string | undefined;
    if (!refreshToken) throw new HttpError(400, "refreshToken requerido");

    const decoded = verifyRefreshToken(refreshToken);
    const [rows] = await pool.query<any[]>(`SELECT * FROM users WHERE id = ? AND status = 'ACTIVO'`, [
      decoded.sub
    ]);
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
