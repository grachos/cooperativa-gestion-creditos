import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { expect, it, beforeEach, afterEach, describe } from "vitest";
import { createIdempotency, type IdempotencyStore } from "./idempotency.js";

/**
 * Suite compartida: se ejecuta contra el store en memoria y contra MySQL
 * (idempotency.mysql.test.ts). Monta una app Express mínima donde el "efecto"
 * es incrementar un contador, para poder afirmar cuántas veces se ejecutó.
 */
export interface SuiteContext {
  store: IdempotencyStore;
  /** Avanza el reloj del store (solo el de memoria lo permite; en MySQL se vence con SQL). */
  expireAll: () => Promise<void>;
}

const KEY = "k-0123456789abcdef";
const key = (n: string) => `${n.padEnd(16, "0")}`.slice(0, 64);

export function defineIdempotencySuite(name: string, makeContext: () => Promise<SuiteContext>, userIds: [number, number]) {
  describe(`Idempotency-Key (${name})`, () => {
    let ctx: SuiteContext;
    let server: Server;
    let base: string;
    let effects = 0;
    let failNext: "none" | "400" | "500" | "throw" = "none";
    let delayMs = 0;
    let hang: Promise<void> | null = null;
    let waitMs = 600;
    let releaseHang: (() => void) | null = null;

    async function start() {
      const idem = createIdempotency({ store: ctx.store, ttlSeconds: 3600, waitMs, pollMs: 20, log: () => {} });
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        const uid = Number(req.header("x-test-user") ?? userIds[0]);
        req.user = { id: uid, roles: [], permissions: ["x"] };
        next();
      });
      const handler = async (req: express.Request, res: express.Response) => {
        if (hang) await hang;
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        if (failNext === "400") {
          failNext = "none";
          return res.status(400).json({ error: "Datos inválidos" });
        }
        if (failNext === "500") {
          failNext = "none";
          return res.status(500).json({ error: "boom" });
        }
        effects++;
        res.status(201).json({ id: effects, echo: req.body });
      };
      app.post("/tx", idem("test.tx", { transactional: true }), handler);
      app.post("/plain", idem("test.plain"), handler);
      app.post("/other", idem("test.other"), handler);
      await new Promise<void>((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
      });
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }

    async function restart() {
      await new Promise((r) => server.close(r));
      await start();
    }

    beforeEach(async () => {
      ctx = await makeContext();
      effects = 0;
      failNext = "none";
      delayMs = 0;
      hang = null;
      waitMs = 600;
      await start();
    });
    afterEach(async () => {
      releaseHang?.();
      releaseHang = null;
      await new Promise((r) => server.close(r));
    });

    const j = async (res: Response) => (await res.json()) as any;
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body)
      });

    it("una clave nueva ejecuta la operación una sola vez", async () => {
      const res = await post("/plain", { amount: 100 }, { "Idempotency-Key": key("nueva") });
      expect(res.status).toBe(201);
      expect(effects).toBe(1);
      expect(res.headers.get("Idempotent-Replayed")).toBeNull();
    });

    it("misma clave y misma petición devuelve la respuesta guardada sin repetir el efecto", async () => {
      const k = key("replay");
      const first = await post("/plain", { amount: 100, b: 1 }, { "Idempotency-Key": k });
      const firstBody = await j(first);
      // mismo contenido con otro orden de llaves: es la misma petición
      const second = await post("/plain", { b: 1, amount: 100 }, { "Idempotency-Key": k });
      const third = await post("/plain", { amount: 100, b: 1 }, { "Idempotency-Key": k });
      expect(second.status).toBe(201);
      expect(await j(second)).toEqual(firstBody);
      expect(third.status).toBe(201);
      expect(second.headers.get("Idempotent-Replayed")).toBe("true");
      expect(effects).toBe(1);
    });

    it("misma clave con contenido distinto devuelve 409 y no ejecuta", async () => {
      const k = key("conflict");
      await post("/plain", { amount: 100 }, { "Idempotency-Key": k });
      const res = await post("/plain", { amount: 999 }, { "Idempotency-Key": k });
      expect(res.status).toBe(409);
      expect((await j(res)).code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect(effects).toBe(1);
    });

    it("la clave está acotada por operación y por usuario", async () => {
      const k = key("scope");
      await post("/plain", { a: 1 }, { "Idempotency-Key": k });
      const otherOp = await post("/other", { a: 1 }, { "Idempotency-Key": k });
      const otherUser = await post("/plain", { a: 1 }, { "Idempotency-Key": k, "x-test-user": String(userIds[1]) });
      expect(otherOp.status).toBe(201);
      expect(otherUser.status).toBe(201);
      expect(effects).toBe(3);
    });

    it("dos solicitudes simultáneas con la misma clave no duplican el efecto", async () => {
      delayMs = 150;
      const k = key("concurrent");
      const results = await Promise.all(
        Array.from({ length: 6 }, () => post("/plain", { amount: 5 }, { "Idempotency-Key": k }))
      );
      const bodies = await Promise.all(results.map((r) => j(r)));
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
      expect(new Set(bodies.map((b) => b.id)).size).toBe(1);
      expect(effects).toBe(1);
    });

    it("si la original sigue en curso pasado el tiempo de espera responde 409 IN_PROGRESS", async () => {
      waitMs = 120;
      await restart();
      hang = new Promise<void>((r) => (releaseHang = r));
      const k = key("slow");
      const original = post("/plain", { a: 1 }, { "Idempotency-Key": k });
      await new Promise((r) => setTimeout(r, 40));
      const dup = await post("/plain", { a: 1 }, { "Idempotency-Key": k });
      expect(dup.status).toBe(409);
      expect((await j(dup)).code).toBe("IDEMPOTENCY_IN_PROGRESS");
      expect(dup.headers.get("Retry-After")).toBeTruthy();
      releaseHang?.();
      expect((await original).status).toBe(201);
      expect(effects).toBe(1);
    });

    it("un 4xx (falló antes del efecto) libera la clave y permite reintentar", async () => {
      const k = key("fail4xx");
      failNext = "400";
      const bad = await post("/plain", { a: 1 }, { "Idempotency-Key": k });
      expect(bad.status).toBe(400);
      const retry = await post("/plain", { a: 1 }, { "Idempotency-Key": k });
      expect(retry.status).toBe(201);
      expect(effects).toBe(1);
      const again = await post("/plain", { a: 1 }, { "Idempotency-Key": k });
      expect(again.headers.get("Idempotent-Replayed")).toBe("true");
      expect(effects).toBe(1);
    });

    it("un 5xx en una operación transaccional libera la clave (sin efecto: se puede reintentar)", async () => {
      const k = key("fail5xxtx");
      failNext = "500";
      expect((await post("/tx", { a: 1 }, { "Idempotency-Key": k })).status).toBe(500);
      const retry = await post("/tx", { a: 1 }, { "Idempotency-Key": k });
      expect(retry.status).toBe(201);
      expect(effects).toBe(1);
    });

    it("un 5xx en una operación no transaccional deja el efecto incierto: NO se re-ejecuta", async () => {
      waitMs = 0;
      await restart();
      const k = key("fail5xxplain");
      failNext = "500";
      expect((await post("/plain", { a: 1 }, { "Idempotency-Key": k })).status).toBe(500);
      const retry = await post("/plain", { a: 1 }, { "Idempotency-Key": k });
      expect(retry.status).toBe(409);
      expect((await j(retry)).code).toBe("IDEMPOTENCY_IN_PROGRESS");
      expect(effects).toBe(0);
    });

    it("una clave vencida se trata como nueva", async () => {
      const k = key("expire");
      await post("/plain", { a: 1 }, { "Idempotency-Key": k });
      expect(effects).toBe(1);
      await ctx.expireAll();
      const res = await post("/plain", { a: 1 }, { "Idempotency-Key": k });
      expect(res.status).toBe(201);
      expect(res.headers.get("Idempotent-Replayed")).toBeNull();
      expect(effects).toBe(2);
    });

    it("purgeExpired elimina solo las claves vencidas", async () => {
      await post("/plain", { a: 1 }, { "Idempotency-Key": key("purge-a") });
      expect(await ctx.store.purgeExpired()).toBe(0);
      await ctx.expireAll();
      expect(await ctx.store.purgeExpired()).toBeGreaterThanOrEqual(1);
    });

    it("sin el header la operación se ejecuta normal (compatibilidad)", async () => {
      await post("/plain", { a: 1 });
      await post("/plain", { a: 1 });
      expect(effects).toBe(2);
    });

    it("rechaza con 400 una clave con formato inválido", async () => {
      const res = await post("/plain", { a: 1 }, { "Idempotency-Key": "corta" });
      expect(res.status).toBe(400);
      expect((await j(res)).code).toBe("IDEMPOTENCY_KEY_INVALID");
      expect(effects).toBe(0);
    });
  });
}

export { KEY };
