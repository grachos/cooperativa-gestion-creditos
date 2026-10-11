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
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
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
  console.error(err);
  return res.status(500).json({ error: "Error interno del servidor" });
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
