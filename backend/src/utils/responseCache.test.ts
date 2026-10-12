import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { ResponseCache } from "./responseCache.js";

let server: Server | undefined;
afterEach(async () => {
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
  server = undefined;
});

/** App con un "reporte" lento que cuenta cuántas veces se calculó de verdad. */
async function start(cache: ResponseCache, opts: { delayMs?: number; failTimes?: number } = {}) {
  let computed = 0;
  let failures = opts.failTimes ?? 0;
  const app = express();
  app.get("/report", cache.middleware(), async (req, res) => {
    computed++;
    await new Promise((r) => setTimeout(r, opts.delayMs ?? 0));
    if (failures > 0) {
      failures--;
      return res.status(500).json({ error: "falló" });
    }
    res.json({ data: [req.query.m ?? "sin-mes", computed] });
  });
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", r);
  });
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const get = (path = "/report") => fetch(base + path);
  return { get, computed: () => computed };
}

describe("ResponseCache", () => {
  it("20 peticiones simultáneas iguales calculan UNA sola vez (coalescencia)", async () => {
    const cache = new ResponseCache(60_000);
    const { get, computed } = await start(cache, { delayMs: 80 });
    const results = await Promise.all(Array.from({ length: 20 }, () => get()));
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(computed()).toBe(1);
    expect(new Set(bodies.map((b: any) => JSON.stringify(b))).size).toBe(1);
    const kinds = results.map((r) => r.headers.get("x-cache"));
    expect(kinds.filter((k) => k === "COALESCED").length).toBe(19);
    expect(cache.stats()).toMatchObject({ misses: 1, coalesced: 19, inflight: 0 });
  });

  it("una segunda petición posterior se sirve de la caché sin calcular", async () => {
    const cache = new ResponseCache(60_000);
    const { get, computed } = await start(cache);
    await get();
    const second = await get();
    expect(second.headers.get("x-cache")).toBe("HIT");
    expect(computed()).toBe(1);
  });

  it("vence a los ttl: después se vuelve a calcular", async () => {
    let t = 1_000;
    const cache = new ResponseCache(5_000, 100, () => t);
    const { get, computed } = await start(cache);
    await get();
    t += 4_999;
    await get();
    expect(computed()).toBe(1);
    t += 2;
    await get();
    expect(computed()).toBe(2);
  });

  it("clear() (tras una escritura) fuerza a recalcular", async () => {
    const cache = new ResponseCache(60_000);
    const { get, computed } = await start(cache);
    await get();
    cache.clear();
    await get();
    expect(computed()).toBe(2);
  });

  it("la clave incluye la query: reportes de meses distintos no se mezclan", async () => {
    const cache = new ResponseCache(60_000);
    const { get, computed } = await start(cache);
    const a = await (await get("/report?m=2026-01")).json();
    const b = await (await get("/report?m=2026-02")).json();
    expect((a as any).data[0]).toBe("2026-01");
    expect((b as any).data[0]).toBe("2026-02");
    expect(computed()).toBe(2);
  });

  it("un error NO se cachea, y los que esperaban reintentan por su cuenta", async () => {
    const cache = new ResponseCache(60_000);
    const { get, computed } = await start(cache, { delayMs: 40, failTimes: 1 });
    const results = await Promise.all([get(), get(), get()]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 500]);
    expect(computed()).toBeGreaterThanOrEqual(2);
    // y tras el éxito queda cacheado
    const again = await get();
    expect(again.status).toBe(200);
  });

  it("con ttl 0 no guarda, pero igual coalesce las peticiones simultáneas", async () => {
    const cache = new ResponseCache(0);
    const { get, computed } = await start(cache, { delayMs: 60 });
    await Promise.all([get(), get(), get()]);
    expect(computed()).toBe(1);
    await get();
    expect(computed()).toBe(2);
    expect(cache.stats().entries).toBe(0);
  });

  it("respeta el máximo de entradas (descarta la más antigua)", async () => {
    const cache = new ResponseCache(60_000, 2);
    const { get, computed } = await start(cache);
    await get("/report?m=1");
    await get("/report?m=2");
    await get("/report?m=3");
    expect(cache.stats().entries).toBe(2);
    await get("/report?m=1"); // se descartó: se recalcula
    expect(computed()).toBe(4);
  });
});
