import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { errorHandler } from "./middlewares/error.middleware.js";

/** Salud, caché de la API y saturación del pool. No necesitan base de datos (se simula). */
describe("app: /health, no-store y pool saturado", () => {
  let server: Server;
  let base: string;
  let pool: typeof import("./db/pool.js").pool;

  beforeAll(async () => {
    const [{ app }, poolMod] = await Promise.all([import("./app.js"), import("./db/pool.js")]);
    pool = poolMod.pool;
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", r);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await new Promise((r) => server?.close(r));
  });

  it("/health responde ok cuando la base de datos responde", async () => {
    vi.spyOn(pool, "query").mockResolvedValue([[{ 1: 1 }], []] as never);
    const res = await fetch(`${base}/health`);
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", db: "ok" });
    expect(body.instance).toMatch(/^[0-9a-f]{8}$/);
  });

  it("/health responde 503 cuando la base de datos falla (antes decía 'ok' siempre)", async () => {
    vi.spyOn(pool, "query").mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded", db: "error" });
  });

  it("toda respuesta de /api lleva Cache-Control: no-store (también los errores)", async () => {
    const res = await fetch(`${base}/api/v1/associates`); // sin token => 401
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("la cola del pool llena se traduce en 503 con Retry-After (no en 500)", () => {
    const headers: Record<string, string> = {};
    let status = 0;
    let body: unknown;
    const res: any = {
      setHeader: (k: string, v: string) => (headers[k] = v),
      status(code: number) {
        status = code;
        return this;
      },
      json(b: unknown) {
        body = b;
        return this;
      }
    };
    errorHandler(new Error("Queue limit reached."), {} as any, res, () => {});
    expect(status).toBe(503);
    expect(headers["Retry-After"]).toBe("2");
    expect((body as any).error).toMatch(/ocupado/);
  });
});

describe("métricas de administración y errores con id de petición", () => {
  let server2: Server;
  let base2: string;
  beforeAll(async () => {
    const { app } = await import("./app.js");
    await new Promise<void>((r) => {
      server2 = app.listen(0, "127.0.0.1", r);
    });
    base2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server2?.close(r));
  });

  const token = async (permissions: string[]) => {
    const { signAccessToken } = await import("./modules/auth/auth.service.js");
    return signAccessToken({ sub: 1, roles: ["X"], permissions });
  };

  it("/api/v1/admin/metrics exige autenticación y el permiso audit:read", async () => {
    expect((await fetch(`${base2}/api/v1/admin/metrics`)).status).toBe(401);
    const sinPermiso = await token(["reports:read"]);
    expect((await fetch(`${base2}/api/v1/admin/metrics`, { headers: { Authorization: `Bearer ${sinPermiso}` } })).status).toBe(403);
  });

  it("con audit:read devuelve el estado del proceso (sin datos personales)", async () => {
    const t = await token(["audit:read"]);
    const res = await fetch(`${base2}/api/v1/admin/metrics`, { headers: { Authorization: `Bearer ${t}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.instance).toMatch(/^[0-9a-f]{8}$/);
    expect(body).toHaveProperty("memoryMB.rss");
    expect(body).toHaveProperty("eventLoopDelayMs.p99");
    expect(body).toHaveProperty("requests.latencyMs.p95");
    expect(body).toHaveProperty("db.pool.size");
    expect(body).toHaveProperty("sse.clients");
    expect(body).toHaveProperty("reportCache.hits");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("un error 500 devuelve el requestId (el mismo de X-Request-Id) para rastrearlo en los logs", async () => {
    const { pool } = await import("./db/pool.js");
    vi.spyOn(pool, "query").mockRejectedValue(new Error("fallo simulado de base de datos"));
    const t = await token(["associates:read", "reports:read"]);
    const res = await fetch(`${base2}/api/v1/associates`, { headers: { Authorization: `Bearer ${t}`, "x-request-id": "ref-prueba-12345" } });
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.requestId).toBe("ref-prueba-12345");
    expect(res.headers.get("x-request-id")).toBe("ref-prueba-12345");
    vi.restoreAllMocks();
  });
});
