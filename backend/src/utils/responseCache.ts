import type { NextFunction, Request, Response } from "express";

/**
 * Caché de respuestas JSON de vida corta, CON coalescencia de peticiones.
 *
 * Para qué: los reportes mensuales cuestan segundos de base de datos (medido: 4,7 s el
 * detalle mensual con 15.000 créditos) y se calculan completos en cada petición. Con 20
 * usuarios abriendo el mismo reporte, eran 20 cálculos simultáneos que agotaban el pool de
 * conexiones y frenaban TODA la aplicación. Ahora:
 *  - si hay un resultado fresco, se devuelve sin tocar la base de datos;
 *  - si ya hay un cálculo en curso para la misma petición, las demás ESPERAN ese resultado
 *    (una sola consulta pesada en vez de N);
 *  - solo se guardan respuestas 2xx; un error nunca se cachea (los que esperaban reintentan).
 *
 * REGLA DE SEGURIDAD: úsese SOLO en endpoints cuya respuesta sea idéntica para todos los
 * usuarios que pasan los permisos de la ruta (reportes agregados). La clave es la URL
 * completa (ruta + query), NO el usuario: aplicarlo a datos por usuario mostraría datos de
 * otro. El middleware debe ir DESPUÉS de requireAuth/requirePermission.
 *
 * Límite honesto: la caché vive en la memoria de cada proceso. Una escritura invalida la
 * caché del proceso que la atiende (`clear()`); otro proceso puede mostrar datos de hasta
 * `ttlMs` de antigüedad.
 */
interface Entry {
  body: unknown;
  expiresAt: number;
}

export interface ResponseCacheStats {
  hits: number;
  coalesced: number;
  misses: number;
  entries: number;
  inflight: number;
}

export class ResponseCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<unknown | undefined>>();
  private hits = 0;
  private coalesced = 0;
  private misses = 0;

  constructor(
    private ttlMs: number,
    private maxEntries = 100,
    private now: () => number = () => Date.now()
  ) {}

  stats(): ResponseCacheStats {
    return { hits: this.hits, coalesced: this.coalesced, misses: this.misses, entries: this.entries.size, inflight: this.inflight.size };
  }

  /** Descarta todo lo guardado (tras una escritura que cambia los datos de los reportes). */
  clear() {
    this.entries.clear();
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      void this.handle(req.originalUrl, res, next);
    };
  }

  private async handle(key: string, res: Response, next: NextFunction) {
    const fresh = this.entries.get(key);
    if (fresh && fresh.expiresAt > this.now()) {
      this.hits++;
      res.setHeader("X-Cache", "HIT");
      res.json(fresh.body);
      return;
    }

    const pending = this.inflight.get(key);
    if (pending) {
      const body = await pending;
      if (body !== undefined) {
        this.coalesced++;
        res.setHeader("X-Cache", "COALESCED");
        res.json(body);
        return;
      }
      // El cálculo original falló: este request lo intenta por su cuenta.
      this.misses++;
      next();
      return;
    }

    this.misses++;
    let settle!: (body: unknown | undefined) => void;
    this.inflight.set(key, new Promise<unknown | undefined>((resolve) => (settle = resolve)));
    let settled = false;
    const finish = (body: unknown | undefined) => {
      if (settled) return;
      settled = true;
      this.inflight.delete(key);
      settle(body);
    };

    const originalJson = res.json.bind(res);
    res.json = ((body?: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300 && body !== undefined) {
        if (this.ttlMs > 0) this.store(key, body);
        finish(body);
      } else {
        finish(undefined);
      }
      return originalJson(body);
    }) as Response["json"];
    // Si la respuesta termina sin pasar por res.json (error, cierre del cliente), se libera a los que esperan.
    res.once("close", () => finish(undefined));
    next();
  }

  private store(key: string, body: unknown) {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { body, expiresAt: this.now() + this.ttlMs });
  }
}
