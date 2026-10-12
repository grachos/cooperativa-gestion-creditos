import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createRequestLog, type RequestLogMode } from "./requestLog.js";

let server: Server | undefined;
afterEach(async () => {
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
  server = undefined;
});

async function start(mode: RequestLogMode, slowMs = 40) {
  const lines: { level: string; line: string }[] = [];
  const app = express();
  app.use(createRequestLog({ mode, slowMs, instanceId: "inst1234", log: (level, line) => lines.push({ level, line }) }));
  app.get("/ok", (_req, res) => res.json({ ok: true }));
  app.get("/slow", async (_req, res) => {
    await new Promise((r) => setTimeout(r, 70));
    res.json({ ok: true });
  });
  app.get("/boom", (_req, res) => res.status(500).json({ error: "x" }));
  app.get("/notfound", (_req, res) => res.status(404).json({ error: "x" }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/assets/app.js", (_req, res) => res.type("js").send("1"));
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", r);
  });
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, { headers });
    await res.text();
    await new Promise((r) => setTimeout(r, 15)); // deja que corra el evento 'finish'
    return res;
  };
  return { get, lines, parsed: () => lines.map((l) => ({ level: l.level, ...JSON.parse(l.line) })) };
}

describe("requestLog", () => {
  it("modo slow: solo registra las 5xx y las lentas (no las rápidas ni las 4xx)", async () => {
    const t = await start("slow");
    await t.get("/ok");
    await t.get("/notfound");
    expect(t.lines).toHaveLength(0);
    await t.get("/boom");
    await t.get("/slow");
    const [boom, slow] = t.parsed();
    expect(boom).toMatchObject({ level: "error", t: "req", m: "GET", p: "/boom", s: 500, i: "inst1234" });
    expect(slow).toMatchObject({ level: "warn", p: "/slow", s: 200, slow: true });
    expect(slow.ms).toBeGreaterThanOrEqual(60);
  });

  it("modo all: registra todo; modo off: nada (aunque haya 500)", async () => {
    const all = await start("all");
    await all.get("/ok");
    expect(all.parsed()[0]).toMatchObject({ level: "log", p: "/ok", s: 200 });
    await new Promise((r) => server!.close(r));
    server = undefined;
    const off = await start("off");
    await off.get("/ok");
    await off.get("/slow");
    await off.get("/boom");
    expect(off.lines).toHaveLength(0);
  });

  it("nunca registra la query string (el SSE lleva el token ahí) ni cabeceras", async () => {
    const t = await start("all");
    await t.get("/ok?token=SECRETO-NO-LOGUEAR&x=1", { authorization: "Bearer OTRO-SECRETO" });
    const raw = t.lines.map((l) => l.line).join("\n");
    expect(raw).not.toContain("SECRETO");
    expect(raw).not.toContain("token=");
    expect(t.parsed()[0].p).toBe("/ok");
  });

  it("no registra /health ni archivos estáticos (ruido)", async () => {
    const t = await start("all");
    await t.get("/health");
    await t.get("/assets/app.js");
    expect(t.lines).toHaveLength(0);
  });

  it("asigna X-Request-Id y respeta uno válido del cliente; descarta uno peligroso", async () => {
    const t = await start("off");
    const generated = (await t.get("/ok")).headers.get("x-request-id")!;
    expect(generated).toMatch(/^[0-9a-f]{12}$/);
    const echoed = (await t.get("/ok", { "x-request-id": "mi-peticion-0001" })).headers.get("x-request-id");
    expect(echoed).toBe("mi-peticion-0001");
    const replaced = (await t.get("/ok", { "x-request-id": "corto" })).headers.get("x-request-id")!;
    expect(replaced).not.toBe("corto");
    const longId = "a".repeat(200);
    expect((await t.get("/ok", { "x-request-id": longId })).headers.get("x-request-id")).not.toBe(longId);
  });
});
