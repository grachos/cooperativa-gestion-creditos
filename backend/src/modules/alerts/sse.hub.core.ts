import type { Response } from "express";

/**
 * Hub de eventos en vivo (SSE) que funciona con VARIOS procesos Node.
 *
 * Cada proceso solo tiene abiertas SUS conexiones SSE. Para que un evento
 * generado en un proceso llegue a los usuarios conectados a otro, cada evento
 * se entrega de inmediato a los clientes locales Y se publica en un buzón
 * compartido (`RealtimeStore`, tabla realtime_events); cada proceso consulta el
 * buzón cada pocos segundos y reenvía a sus clientes lo que publicaron los
 * demás (se ignoran los eventos propios, que ya se entregaron). Solo consulta
 * mientras tenga clientes conectados: sin pestañas abiertas no hay carga.
 *
 * También protege el proceso: latido periódico (detecta y limpia conexiones
 * muertas y evita que el proxy las corte por inactividad), tope de conexiones
 * por usuario (al abrir otra pestaña se cierra la más antigua) y tope global.
 */

export interface RealtimeEvent {
  event: string;
  data: unknown;
}

export interface StoredRealtimeEvent {
  id: number;
  origin: string;
  event: string;
  payload: string;
}

export interface RealtimeStore {
  publish(origin: string, events: RealtimeEvent[]): Promise<void>;
  fetchSince(lastId: number, limit: number): Promise<StoredRealtimeEvent[]>;
  latestId(): Promise<number>;
  purgeOlderThan(minutes: number): Promise<number>;
}

export interface SseHubOptions {
  instanceId: string;
  store?: RealtimeStore;
  heartbeatMs?: number;
  pollMs?: number;
  maxPerUser?: number;
  maxTotal?: number;
  log?: (message: string, err?: unknown) => void;
}

interface Client {
  userId: number;
  res: Pick<Response, "write" | "end" | "on" | "writableEnded" | "destroyed">;
}

export class SseHub {
  private clients = new Set<Client>();
  private lastId: number | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private poller: NodeJS.Timeout | null = null;
  private polling = false;
  private readonly opts: Required<Omit<SseHubOptions, "store">> & { store?: RealtimeStore };

  constructor(options: SseHubOptions) {
    this.opts = {
      heartbeatMs: 25_000,
      pollMs: 2_000,
      maxPerUser: 5,
      maxTotal: 500,
      log: (message, err) => console.error(message, err),
      ...options
    };
  }

  get instanceId() {
    return this.opts.instanceId;
  }

  get size() {
    return this.clients.size;
  }

  /** false si el proceso ya está al tope de conexiones (el llamador responde 503). */
  canAccept(): boolean {
    return this.clients.size < this.opts.maxTotal;
  }

  register(userId: number, res: Client["res"]): boolean {
    if (!this.canAccept()) return false;

    // Tope por usuario: se cierran las más antiguas (pestañas recargadas que dejaron
    // una conexión abierta hasta que el proxy la corte).
    const mine = [...this.clients].filter((c) => c.userId === userId);
    while (mine.length >= this.opts.maxPerUser) {
      const oldest = mine.shift()!;
      this.drop(oldest, true);
    }

    const client: Client = { userId, res };
    this.clients.add(client);
    res.on("close", () => this.drop(client, false));
    res.on("error", () => this.drop(client, false));
    this.ensureTimers();
    return true;
  }

  /** Entrega local inmediata + publicación para los demás procesos. */
  broadcast(event: string, data: unknown): void {
    this.broadcastMany([{ event, data }]);
  }

  broadcastMany(events: RealtimeEvent[]): void {
    if (events.length === 0) return;
    for (const e of events) this.deliver(e.event, JSON.stringify(e.data));
    const store = this.opts.store;
    if (store) {
      store.publish(this.opts.instanceId, events).catch((err) => this.opts.log("[sse] no se pudo publicar el evento", err));
    }
  }

  /** Detiene temporizadores y cierra las conexiones (apagado ordenado). */
  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.poller) clearInterval(this.poller);
    this.heartbeat = this.poller = null;
    for (const c of [...this.clients]) this.drop(c, true);
  }

  private deliver(event: string, jsonData: string) {
    const frame = `event: ${event}\ndata: ${jsonData}\n\n`;
    for (const c of [...this.clients]) this.write(c, frame);
  }

  private write(c: Client, frame: string) {
    if (c.res.writableEnded || c.res.destroyed) return this.drop(c, false);
    try {
      c.res.write(frame);
    } catch {
      this.drop(c, false);
    }
  }

  private drop(c: Client, endResponse: boolean) {
    if (!this.clients.delete(c)) return;
    if (endResponse) {
      try {
        c.res.end();
      } catch {
        /* ya cerrada */
      }
    }
    if (this.clients.size === 0) this.clearTimers();
  }

  private ensureTimers() {
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => {
        for (const c of [...this.clients]) this.write(c, ": ping\n\n");
      }, this.opts.heartbeatMs);
      this.heartbeat.unref?.();
    }
    if (this.opts.store && !this.poller) {
      this.poller = setInterval(() => void this.poll(), this.opts.pollMs);
      this.poller.unref?.();
    }
  }

  /** Sin clientes no hay nada que entregar: se apagan los temporizadores y no se consulta la base. */
  private clearTimers() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.poller) clearInterval(this.poller);
    this.heartbeat = this.poller = null;
    this.lastId = null; // al volver a haber clientes, se parte del último evento (sin reenviar historia)
  }

  /** Una ronda de consulta del buzón (pública para poder probarla sin esperar al temporizador). */
  async poll(): Promise<void> {
    const store = this.opts.store;
    if (!store || this.polling || this.clients.size === 0) return;
    this.polling = true;
    try {
      if (this.lastId === null) {
        this.lastId = await store.latestId();
        return;
      }
      const rows = await store.fetchSince(this.lastId, 200);
      for (const row of rows) {
        this.lastId = Math.max(this.lastId, row.id);
        if (row.origin !== this.opts.instanceId) this.deliver(row.event, row.payload);
      }
    } catch (err) {
      this.opts.log("[sse] error consultando el buzón de eventos", err);
    } finally {
      this.polling = false;
    }
  }
}

/** Buzón en memoria (pruebas; simula la tabla compartida entre "procesos"). */
export class MemoryRealtimeStore implements RealtimeStore {
  private rows: (StoredRealtimeEvent & { at: number })[] = [];
  private seq = 0;

  async publish(origin: string, events: RealtimeEvent[]) {
    for (const e of events) this.rows.push({ id: ++this.seq, origin, event: e.event, payload: JSON.stringify(e.data), at: Date.now() });
  }
  async fetchSince(lastId: number, limit: number) {
    return this.rows.filter((r) => r.id > lastId).slice(0, limit);
  }
  async latestId() {
    return this.seq;
  }
  async purgeOlderThan(minutes: number) {
    const cutoff = Date.now() - minutes * 60_000;
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.at >= cutoff);
    return before - this.rows.length;
  }
}
