import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../modules/auth/auth.service.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: number; roles: string[]; permissions: string[] };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  // El endpoint SSE (/alerts/stream) no puede enviar cabeceras personalizadas
  // desde EventSource, por lo que también admite el token como query param.
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : queryToken;

  if (!token) {
    return res.status(401).json({ error: "No autenticado" });
  }
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, roles: payload.roles, permissions: payload.permissions };
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.permissions.includes(permission)) {
      return res.status(403).json({ error: "No autorizado para esta acción" });
    }
    next();
  };
}
