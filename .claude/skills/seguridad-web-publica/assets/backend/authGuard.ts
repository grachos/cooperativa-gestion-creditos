import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { verifyTurnstile, type CaptchaCode } from "./turnstile.js";

/**
 * Defensas de los endpoints públicos de autenticación (login, recuperar y restablecer contraseña):
 *
 *  1. authRateLimit: límites por IP y por identificador, guardados en la base (no en memoria: el hosting corre varios
 *     procesos) y auditoría de cada petición.
 *  2. requireTurnstile: exige el reto de Cloudflare Turnstile (ver turnstile.ts) con la acción del formulario.
 *
 * Orden en la ruta: authRateLimit → requireTurnstile → manejador. Un bot bloqueado por límite no llega a gastar
 * llamadas a Cloudflare, y un intento sin reto superado cuenta como intento fallido de esa IP.
 */

export type AuthAction = "login" | "forgot_password" | "reset_password";

export interface AuthLimits {
  windowMinutes: number;
  /** Peticiones totales por IP y acción en la ventana. */
  ipTotal: number;
  /** Intentos fallidos de login por IP en la ventana (probar una contraseña en muchas cuentas). */
  ipFailed: number;
  /** Intentos fallidos de login por identificador en la ventana, desde el último acceso exitoso. */
  identifierFailed: number;
}

export const defaultAuthLimits = (): AuthLimits => ({
  windowMinutes: 15,
  ipTotal: env.AUTH_RATE_LIMIT,
  ipFailed: env.AUTH_IP_FAILED_LIMIT,
  identifierFailed: env.AUTH_MAX_FAILED_LOGINS
});

const CAPTCHA_MESSAGES: Record<CaptchaCode, string> = {
  "CAPTCHA-01": "No se pudo validar el origen de la solicitud.",
  "CAPTCHA-02": "No se pudo completar la verificación de seguridad. Intenta de nuevo.",
  "CAPTCHA-03": "La verificación de seguridad venció o no es válida. Vuelve a intentarlo."
};

/** Lo que se teclea como usuario o correo se guarda solo como hash (a veces es una contraseña en el campo equivocado). */
export const hashIdentifier = (raw: unknown): string | null => {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const value = String(raw).trim().toLowerCase();
  return value ? crypto.createHash("sha256").update(value).digest("hex") : null;
};

interface AuthContext {
  action: AuthAction;
  ip: string;
  identifierHash: string | null;
  userAgent: string | null;
}

declare module "express-serve-static-core" {
  interface Locals {
    authCtx?: AuthContext;
    authAttemptId?: number;
    authUserId?: number;
    /** Resultado fino fijado por el manejador (p. ej. LOCKED, NO_ACCESS). Si no, se deduce del código HTTP. */
    authOutcome?: string;
    turnstile?: { result: string; reason?: string };
  }
}

const defaultOutcome = (status: number) =>
  status >= 200 && status < 300 ? "SUCCESS" : status === 400 ? "BAD_REQUEST" : status === 401 ? "INVALID_CREDENTIALS" : status === 403 ? "FORBIDDEN" : status === 429 ? "RATE_LIMITED" : "ERROR";

/** Una fila de auditoría por petición, al terminar la respuesta (sin bloquearla). Nunca contraseñas ni tokens. */
function auditOnFinish(req: Request, res: Response, ctx: AuthContext) {
  res.on("finish", () => {
    const t = res.locals.turnstile ?? { result: "NOT_CHECKED" };
    pool
      .query(
        `INSERT INTO auth_audit (action, ip_address, user_agent, identifier_hash, user_id, turnstile_result, turnstile_reason, outcome, http_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.action,
          ctx.ip,
          ctx.userAgent,
          ctx.identifierHash,
          res.locals.authUserId ?? null,
          t.result,
          t.reason ?? null,
          res.locals.authOutcome ?? defaultOutcome(res.statusCode),
          res.statusCode
        ]
      )
      .catch((err) => console.error("[auth] no se pudo registrar la auditoría de acceso", err));
  });
}

function identifierFor(action: AuthAction, body: any): string | null {
  return hashIdentifier(action === "reset_password" ? body?.uid : body?.identifier);
}

const count = async (sql: string, args: unknown[]) => {
  const [rows] = await pool.query<any[]>(sql, args);
  return Number((rows as any[])[0].total);
};

/**
 * Registra el intento ANTES de verificar nada y lo cuenta junto con los anteriores: así una ráfaga de peticiones
 * simultáneas no puede colarse por encima del límite (la que quede por encima del límite ve su propia fila y se bloquea).
 */
export function authRateLimit(action: AuthAction, limits: () => AuthLimits = defaultAuthLimits): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const lim = limits();
      const ctx: AuthContext = {
        action,
        ip: req.ip ?? "unknown",
        identifierHash: identifierFor(action, req.body),
        userAgent: (req.get("user-agent") ?? "").slice(0, 255) || null
      };
      res.locals.authCtx = ctx;
      auditOnFinish(req, res, ctx);

      const [ins] = await pool.query<any>(`INSERT INTO auth_attempts (action, ip_address, identifier_hash) VALUES (?, ?, ?)`, [
        action,
        ctx.ip,
        ctx.identifierHash
      ]);
      res.locals.authAttemptId = Number(ins.insertId);

      const win = lim.windowMinutes;
      const block = (message: string) => {
        res.locals.authOutcome = "RATE_LIMITED";
        res.setHeader("Retry-After", String(win * 60));
        return res.status(429).json({ error: message, code: "RATE_LIMITED" });
      };

      const ipTotal = await count(
        `SELECT COUNT(*) AS total FROM auth_attempts WHERE action = ? AND ip_address = ? AND created_at > NOW() - INTERVAL ? MINUTE`,
        [action, ctx.ip, win]
      );
      if (ipTotal > lim.ipTotal) return block("Demasiadas solicitudes. Intenta de nuevo en unos minutos.");

      if (action === "login") {
        const ipFailed = await count(
          `SELECT COUNT(*) AS total FROM auth_attempts WHERE action = ? AND ip_address = ? AND success = 0 AND created_at > NOW() - INTERVAL ? MINUTE`,
          [action, ctx.ip, win]
        );
        if (ipFailed > lim.ipFailed) return block("Demasiadas solicitudes. Intenta de nuevo en unos minutos.");

        // Mismo límite exista o no la cuenta: no se puede averiguar qué usuarios existen por cuándo se bloquean.
        // Los fallos se cuentan desde el último acceso exitoso POR ORDEN DE INSERCIÓN (id), no por hora: la hora tiene
        // precisión de segundos y los fallos del mismo segundo del acceso no se contarían.
        if (ctx.identifierHash) {
          const identifierFailed = await count(
            `SELECT COUNT(*) AS total FROM auth_attempts
             WHERE action = ? AND identifier_hash = ? AND success = 0
               AND created_at > NOW() - INTERVAL ? MINUTE
               AND id > COALESCE((SELECT MAX(id) FROM auth_attempts WHERE action = ? AND identifier_hash = ? AND success = 1), 0)`,
            [action, ctx.identifierHash, win, action, ctx.identifierHash]
          );
          if (identifierFailed > lim.identifierFailed) {
            return block(`Demasiados intentos fallidos. Espera ${win} minutos o restablece tu contraseña.`);
          }
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** El manejador la llama al autenticar bien: reinicia el contador de fallos de ese identificador. */
export async function markAuthSuccess(res: Response): Promise<void> {
  if (res.locals.authAttemptId) {
    await pool.query(`UPDATE auth_attempts SET success = 1 WHERE id = ?`, [res.locals.authAttemptId]);
  }
}

export interface TurnstileGuardOptions {
  enforce?: boolean;
  verify?: typeof verifyTurnstile;
}

/** Exige el token de Turnstile (`cf-turnstile-response` en el cuerpo o en la cabecera) con la acción del formulario. */
export function requireTurnstile(action: AuthAction, options: TurnstileGuardOptions = {}): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enforce = options.enforce ?? env.TURNSTILE_ENFORCE;
      if (!enforce) {
        res.locals.turnstile = { result: "SKIPPED" };
        return next();
      }
      const token = req.body?.["cf-turnstile-response"] ?? req.get("cf-turnstile-response");
      const outcome = await (options.verify ?? verifyTurnstile)(token, action, req.ip);
      if (outcome.ok) {
        res.locals.turnstile = { result: "OK" };
        return next();
      }
      // El motivo y los códigos de Cloudflare quedan en el registro y la auditoría, no en la respuesta.
      res.locals.turnstile = { result: outcome.code, reason: outcome.reason };
      res.locals.authOutcome = "CAPTCHA_FAILED";
      return res.status(403).json({ code: outcome.code, status: "validation_failed", message: CAPTCHA_MESSAGES[outcome.code] });
    } catch (err) {
      next(err);
    }
  };
}

/** Limpieza periódica: intentos a los 2 días, auditoría al año. */
export async function purgeAuthSecurityTables(): Promise<void> {
  await pool.query(`DELETE FROM auth_attempts WHERE created_at < NOW() - INTERVAL 2 DAY`);
  await pool.query(`DELETE FROM auth_audit WHERE created_at < NOW() - INTERVAL 365 DAY`);
}
