import { monitorEventLoopDelay } from "node:perf_hooks";

/**
 * Métricas en memoria DE ESTE PROCESO (se reinician cuando el hosting recicla la app).
 * Sirven para ver en caliente cómo está el servicio sin instalar nada: ver
 * GET /api/v1/admin/metrics. Para historia y alertas se necesita un monitor externo
 * (docs/escalabilidad.md §10).
 */
export class RollingLatency {
  private buf: Float64Array;
  private next = 0;
  private filled = 0;
  constructor(size = 2000) {
    this.buf = new Float64Array(size);
  }
  add(ms: number) {
    this.buf[this.next] = ms;
    this.next = (this.next + 1) % this.buf.length;
    this.filled = Math.min(this.filled + 1, this.buf.length);
  }
  percentiles(): { samples: number; p50: number; p95: number; p99: number; max: number } {
    const n = this.filled;
    if (n === 0) return { samples: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const sorted = Array.from(this.buf.subarray(0, n)).sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.min(n - 1, Math.floor(n * p))]!;
    const r = (x: number) => Math.round(x * 10) / 10;
    return { samples: n, p50: r(at(0.5)), p95: r(at(0.95)), p99: r(at(0.99)), max: r(sorted[n - 1]!) };
  }
}

export interface SlowQuery {
  at: string;
  ms: number;
  sql: string;
}

const startedAt = Date.now();
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

const requestLatency = new RollingLatency();
const queryLatency = new RollingLatency();
const counters = { requests: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0, slowRequests: 0, queries: 0, slowQueries: 0 };
const recentSlowQueries: SlowQuery[] = [];

export const metrics = {
  recordRequest(status: number, ms: number, slow: boolean) {
    counters.requests++;
    if (status >= 500) counters.s5xx++;
    else if (status >= 400) counters.s4xx++;
    else if (status >= 300) counters.s3xx++;
    else counters.s2xx++;
    if (slow) counters.slowRequests++;
    requestLatency.add(ms);
  },
  recordQuery(ms: number, sql: string, slow: boolean) {
    counters.queries++;
    queryLatency.add(ms);
    if (slow) {
      counters.slowQueries++;
      recentSlowQueries.unshift({ at: new Date().toISOString(), ms: Math.round(ms), sql });
      recentSlowQueries.length = Math.min(recentSlowQueries.length, 10);
    }
  },
  snapshot() {
    const mb = (b: number) => Math.round((b / 1048576) * 10) / 10;
    const mem = process.memoryUsage();
    const ms = (ns: number) => Math.round((ns / 1e6) * 10) / 10;
    return {
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      node: process.version,
      memoryMB: { rss: mb(mem.rss), heapUsed: mb(mem.heapUsed), heapTotal: mb(mem.heapTotal) },
      eventLoopDelayMs: { p50: ms(eventLoop.percentile(50)), p99: ms(eventLoop.percentile(99)), max: ms(eventLoop.max) },
      requests: { ...counters, latencyMs: requestLatency.percentiles() },
      queries: { latencyMs: queryLatency.percentiles(), recentSlow: recentSlowQueries }
    };
  },
  resetEventLoop() {
    eventLoop.reset();
  }
};

/** Normaliza un SQL para registrarlo: sin saltos ni espacios repetidos y sin parámetros. */
export function normalizeSql(sql: string, max = 300): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}
