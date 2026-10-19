import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Recurso no encontrado" });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Datos inválidos", details: err.issues });
  }
  const bodyErr = err as { type?: string };
  if (bodyErr?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON inválido" });
  }
  if (bodyErr?.type === "entity.too.large") {
    return res.status(413).json({ error: "La solicitud es demasiado grande" });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json(err.code ? { error: err.message, code: err.code } : { error: err.message });
  }
  // Pool de conexiones saturado (cola llena): el servidor está al límite, no es un bug.
  if (err instanceof Error && /queue limit reached/i.test(err.message)) {
    res.setHeader("Retry-After", "2");
    return res.status(503).json({ error: "El servidor está muy ocupado; intente de nuevo en unos segundos" });
  }
  // Llave única violada (p. ej. dos peticiones simultáneas, o editar un asociado
  // con una identificación que ya existe): es un conflicto, no un error interno.
  const dup = err as { errno?: number; sqlMessage?: string };
  if (dup?.errno === 1062) {
    const detail = dup.sqlMessage ?? "";
    const message = detail.includes("uq_associate_identification")
      ? "Ya existe un asociado con esta identificación"
      : detail.includes("uq_society_tax_id")
        ? "Ya existe una sociedad con este NIT"
        : "Ya existe un registro con esos datos";
    return res.status(409).json({ error: message });
  }
  // Error inesperado: una línea estructurada con el id de la petición (el mismo que ve el
  // usuario en la respuesta y en X-Request-Id), para rastrearlo en los logs sin pedirle
  // detalles. No se registran cuerpo ni query string.
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(
    JSON.stringify({
      t: "error", id: req?.id ?? null, m: req?.method, p: (req?.originalUrl ?? "").split("?")[0],
      msg: e.message, stack: (e.stack ?? "").split("\n").slice(0, 6).join(" | ")
    })
  );
  // Regla CHECK de montos violada (migración 028; MariaDB 4025, MySQL 3819): indica un error
  // del programa, por eso sigue siendo 500 y queda en el log, pero se le explica al usuario que
  // no se guardó nada (la transacción se revirtió).
  const errno = (err as { errno?: number }).errno;
  if (errno === 4025 || errno === 3819) {
    return res.status(500).json({
      error: "La operación se rechazó porque dejaría montos inconsistentes. No se guardó nada; informe al administrador.",
      code: "INTEGRITY_CHECK_FAILED",
      requestId: req?.id
    });
  }
  return res.status(500).json({ error: "Error interno del servidor", requestId: req?.id });
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
