import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { metrics } from "../utils/metrics.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Identificador de la petición (cabecera X-Request-Id), para rastrearla en los logs. */
      id?: string;
    }
  }
}

export type RequestLogMode = "off" | "slow" | "all";

export interface RequestLogOptions {
  mode: RequestLogMode;
  slowMs: number;
  instanceId: string;
  log?: (level: "log" | "warn" | "error", line: string) => void;
}

const VALID_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Identificador de petición + registro estructurado (una línea JSON).
 *
 * Por defecto ("slow") solo se registran las respuestas 5xx y las lentas: así el log de
 * Hostinger sigue siendo legible y no crece sin control. "all" registra todas (para
 * depurar); "off" no escribe líneas (solo asigna el identificador y recoge métricas; los
 * errores 500 inesperados igual los registra errorHandler con su id).
 *
 * PRIVACIDAD: nunca se registran la query string (el SSE lleva el token en ella), cabeceras
 * ni cuerpos. Solo método, ruta, estado, duración, usuario y proceso.
 */
export function createRequestLog(opts: RequestLogOptions) {
  const log = opts.log ?? ((level, line) => console[level](line));
  return function requestLog(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header("x-request-id");
    req.id = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomBytes(6).toString("hex");
    res.setHeader("X-Request-Id", req.id);

    const start = process.hrtime.bigint();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const path = req.originalUrl.split("?")[0] ?? "";
      const isAsset = path.startsWith("/assets/") || /\.[a-z0-9]{2,5}$/i.test(path);
      if (path === "/health" || isAsset) return;
      const slow = ms >= opts.slowMs;
      metrics.recordRequest(res.statusCode, ms, slow);
      if (opts.mode === "off") return; // solo métricas; los 500 inesperados los registra errorHandler
      const line = JSON.stringify({
        t: "req", id: req.id, m: req.method, p: path, s: res.statusCode,
        ms: Math.round(ms), u: req.user?.id ?? null, i: opts.instanceId, ...(slow ? { slow: true } : {})
      });
      if (res.statusCode >= 500) log("error", line);
      else if (slow) log("warn", line);
      else if (opts.mode === "all") log("log", line);
    };
    res.on("finish", finish);
    res.on("close", finish);
    next();
  };
}
