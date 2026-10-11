import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Idempotencia para operaciones de escritura (header `Idempotency-Key`).
 *
 * Este archivo es el núcleo y no depende de la base de datos: trabaja contra
 * un `IdempotencyStore` (MySQL en producción, en memoria en las pruebas).
 *
 * Reglas:
 *  - Sin header => se ejecuta normal (compatibilidad con clientes existentes).
 *  - La clave se acota por usuario + operación. Misma clave y misma petición
 *    (método + URL + cuerpo) tras un éxito => se devuelve la respuesta original
 *    sin volver a ejecutar. Misma clave con otra petición => 409.
 *  - Peticiones simultáneas con la misma clave: solo una ejecuta (la fila única
 *    del store la serializa); las demás esperan el resultado, o reciben 409 si
 *    la operación sigue en curso pasado `waitMs`.
 *  - Solo se guardan respuestas 2xx. Un 4xx ocurre antes del efecto, así que la
 *    clave se libera y se puede reintentar. Un 5xx libera la clave solo si la
 *    operación es `transactional` (un rollback garantiza que no hubo efecto);
 *    si no, queda en estado incierto y NO se re-ejecuta hasta que venza.
 */

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export type IdempotencyState = "IN_PROGRESS" | "COMPLETED";

export interface IdempotencyScope {
  userId: number;
  operation: string;
  key: string;
}

export interface IdempotencyRecord {
  id: string;
  requestHash: string;
  state: IdempotencyState;
  responseStatus: number | null;
  responseBody: string | null;
  responseContentType: string | null;
  expired: boolean;
}

export interface IdempotencyStore {
  /** Intenta reservar la clave. `created: false` si ya existía (y no venció). */
  begin(
    scope: IdempotencyScope,
    requestHash: string,
    ttlSeconds: number
  ): Promise<{ created: true; id: string } | { created: false; existing: IdempotencyRecord }>;
  find(scope: IdempotencyScope): Promise<IdempotencyRecord | null>;
  complete(id: string, status: number, body: string, contentType: string | null): Promise<void>;
  /** Borra una reserva IN_PROGRESS para permitir el reintento. */
  release(id: string): Promise<void>;
  /** Borra las claves vencidas. Devuelve cuántas. */
  purgeExpired(): Promise<number>;
}

export interface IdempotencyOptions {
  store: IdempotencyStore;
  /** Vigencia de una clave, en segundos. */
  ttlSeconds: number;
  /** Cuánto espera una petición duplicada a que termine la original. */
  waitMs: number;
  pollMs?: number;
  log?: (message: string, err?: unknown) => void;
}

export interface OperationOptions {
  /** true si todo el efecto ocurre en una transacción (un 5xx = sin efecto). */
  transactional?: boolean;
}

/** JSON con las llaves ordenadas: el mismo contenido da siempre el mismo hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${entries.join(",")}}`;
}

export function fingerprintRequest(req: Request): string {
  const material = `${req.method.toUpperCase()}\n${req.originalUrl}\n${canonicalJson(req.body ?? null)}`;
  return crypto.createHash("sha256").update(material).digest("hex");
}

function sendError(res: Response, status: number, code: string, error: string, extra?: Record<string, unknown>) {
  return res.status(status).json({ error, code, ...extra });
}

function replay(res: Response, record: IdempotencyRecord) {
  res.setHeader("Idempotent-Replayed", "true");
  res.status(record.responseStatus ?? 200);
  if (record.responseContentType) res.setHeader("Content-Type", record.responseContentType);
  if (record.responseBody === null || record.responseBody === "" || record.responseStatus === 204) {
    return res.end();
  }
  return res.end(record.responseBody);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createIdempotency(options: IdempotencyOptions) {
  const { store, ttlSeconds, waitMs, pollMs = 100 } = options;
  const log = options.log ?? ((message, err) => console.error(message, err));

  return function idempotent(operation: string, opts: OperationOptions = {}) {
    return async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
      try {
        const rawKey = req.header(IDEMPOTENCY_HEADER);
        if (rawKey === undefined) return next();
        if (!KEY_PATTERN.test(rawKey)) {
          return sendError(
            res,
            400,
            "IDEMPOTENCY_KEY_INVALID",
            "Idempotency-Key inválida: use entre 16 y 128 caracteres (letras, números, guion o guion bajo)"
          );
        }
        if (!req.user) return next(); // requireAuth va antes; sin usuario no hay ámbito

        const scope: IdempotencyScope = { userId: req.user.id, operation, key: rawKey };
        const requestHash = fingerprintRequest(req);
        const deadline = Date.now() + waitMs;

        for (;;) {
          const begun = await store.begin(scope, requestHash, ttlSeconds);

          if (begun.created) {
            return runOriginal(begun.id, req, res, next, opts);
          }

          const existing = begun.existing;
          if (existing.requestHash !== requestHash) {
            return sendError(
              res,
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "Esta Idempotency-Key ya se usó con una petición distinta. Genere una clave nueva para una operación nueva."
            );
          }
          if (existing.state === "COMPLETED") return replay(res, existing);

          // IN_PROGRESS: otra petición (o un intento previo) la está ejecutando.
          while (Date.now() < deadline) {
            await sleep(pollMs);
            const current = await store.find(scope);
            if (!current) break; // el primer intento falló y liberó la clave: ejecutar de nuevo
            if (current.requestHash !== requestHash) {
              return sendError(res, 409, "IDEMPOTENCY_KEY_REUSED", "Esta Idempotency-Key ya se usó con una petición distinta.");
            }
            if (current.state === "COMPLETED") return replay(res, current);
          }
          if (Date.now() >= deadline) {
            res.setHeader("Retry-After", String(Math.max(1, Math.ceil(waitMs / 1000))));
            return sendError(
              res,
              409,
              "IDEMPOTENCY_IN_PROGRESS",
              "La operación original sigue en curso o no se pudo confirmar su resultado. Revise si ya se registró antes de reintentar."
            );
          }
          // La clave desapareció: volver a intentar reservarla.
        }
      } catch (err) {
        next(err);
      }
    };
  };

  function runOriginal(id: string, req: Request, res: Response, next: NextFunction, opts: OperationOptions) {
    const originalSend = res.send.bind(res);
    let settled = false;

    // Todas las respuestas de Express (json, send, sendStatus) pasan por send.
    // Se persiste el resultado ANTES de entregarlo: si el cliente reintenta de
    // inmediato, ya encuentra la respuesta guardada.
    res.send = ((body?: unknown) => {
      if (settled) return originalSend(body as never);
      settled = true;
      const status = res.statusCode;
      const text = body === undefined || body === null ? "" : Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
      const contentType = (res.getHeader("Content-Type") as string | undefined) ?? null;

      let finish: Promise<void>;
      if (status >= 200 && status < 300) {
        finish = store.complete(id, status, text, contentType);
      } else if (status >= 500 && !opts.transactional) {
        finish = Promise.resolve(); // efecto incierto: se conserva la reserva
      } else {
        finish = store.release(id); // falló antes del efecto: se puede reintentar
      }
      finish
        .catch((err) => log("[idempotency] no se pudo actualizar la clave", err))
        .finally(() => originalSend(body as never));
      return res;
    }) as Response["send"];

    next();
  }
}

/** Store en memoria: para pruebas y desarrollo sin base de datos. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private rows = new Map<string, IdempotencyRecord & { scopeKey: string; expiresAt: number }>();
  private seq = 0;

  constructor(private now: () => number = () => Date.now()) {}

  private scopeKey(s: IdempotencyScope) {
    return `${s.userId}|${s.operation}|${s.key}`;
  }

  private view(row: IdempotencyRecord & { expiresAt: number }): IdempotencyRecord {
    return { ...row, expired: row.expiresAt <= this.now() };
  }

  async begin(scope: IdempotencyScope, requestHash: string, ttlSeconds: number) {
    const k = this.scopeKey(scope);
    const current = this.rows.get(k);
    if (current && current.expiresAt <= this.now()) this.rows.delete(k);
    const alive = this.rows.get(k);
    if (alive) return { created: false as const, existing: this.view(alive) };
    const id = String(++this.seq);
    this.rows.set(k, {
      id,
      scopeKey: k,
      requestHash,
      state: "IN_PROGRESS",
      responseStatus: null,
      responseBody: null,
      responseContentType: null,
      expired: false,
      expiresAt: this.now() + ttlSeconds * 1000
    });
    return { created: true as const, id };
  }

  async find(scope: IdempotencyScope) {
    const row = this.rows.get(this.scopeKey(scope));
    if (!row || row.expiresAt <= this.now()) return null;
    return this.view(row);
  }

  async complete(id: string, status: number, body: string, contentType: string | null) {
    for (const row of this.rows.values()) {
      if (row.id === id) {
        row.state = "COMPLETED";
        row.responseStatus = status;
        row.responseBody = body;
        row.responseContentType = contentType;
      }
    }
  }

  async release(id: string) {
    for (const [k, row] of this.rows) if (row.id === id && row.state === "IN_PROGRESS") this.rows.delete(k);
  }

  async purgeExpired() {
    let n = 0;
    for (const [k, row] of this.rows) {
      if (row.expiresAt <= this.now()) {
        this.rows.delete(k);
        n++;
      }
    }
    return n;
  }

  size() {
    return this.rows.size;
  }
}
