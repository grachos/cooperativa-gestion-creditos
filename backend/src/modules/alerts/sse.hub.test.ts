import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRealtimeStore, SseHub } from "./sse.hub.core.js";

/** Respuesta HTTP falsa: guarda lo escrito y permite simular una conexión muerta. */
class FakeRes extends EventEmitter {
  chunks: string[] = [];
  writableEnded = false;
  destroyed = false;
  failWrites = false;
  write(chunk: string) {
    if (this.failWrites) throw new Error("socket cerrado");
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.writableEnded = true;
  }
  events() {
    return this.chunks.filter((c) => c.startsWith("event:"));
  }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hubs: SseHub[] = [];
const make = (opts: Partial<ConstructorParameters<typeof SseHub>[0]> & { instanceId: string }) => {
  const hub = new SseHub({ heartbeatMs: 20, pollMs: 15, log: () => {}, ...opts });
  hubs.push(hub);
  return hub;
};
afterEach(() => {
  hubs.splice(0).forEach((h) => h.stop());
});

describe("SseHub (un proceso)", () => {
  it("entrega el evento a los clientes locales con el formato SSE", () => {
    const hub = make({ instanceId: "a" });
    const res = new FakeRes();
    hub.register(1, res as any);
    hub.broadcast("alert.created", { message: "hola" });
    expect(res.events()).toEqual(['event: alert.created\ndata: {"message":"hola"}\n\n']);
  });

  it("envía un latido periódico para mantener viva la conexión", async () => {
    const hub = make({ instanceId: "a" });
    const res = new FakeRes();
    hub.register(1, res as any);
    await wait(70);
    expect(res.chunks.filter((c) => c === ": ping\n\n").length).toBeGreaterThanOrEqual(2);
  });

  it("limpia las conexiones muertas (el latido detecta el fallo de escritura)", async () => {
    const hub = make({ instanceId: "a" });
    const dead = new FakeRes();
    const alive = new FakeRes();
    hub.register(1, dead as any);
    hub.register(2, alive as any);
    dead.failWrites = true;
    await wait(50);
    expect(hub.size).toBe(1);
  });

  it("al cerrarse la conexión el cliente se elimina", () => {
    const hub = make({ instanceId: "a" });
    const res = new FakeRes();
    hub.register(1, res as any);
    res.emit("close");
    expect(hub.size).toBe(0);
  });

  it("tope por usuario: al abrir otra pestaña se cierra la más antigua", () => {
    const hub = make({ instanceId: "a", maxPerUser: 2 });
    const [r1, r2, r3] = [new FakeRes(), new FakeRes(), new FakeRes()];
    hub.register(7, r1 as any);
    hub.register(7, r2 as any);
    hub.register(7, r3 as any);
    expect(r1.writableEnded).toBe(true);
    expect(r2.writableEnded).toBe(false);
    expect(hub.size).toBe(2);
  });

  it("tope global: rechaza nuevas conexiones", () => {
    const hub = make({ instanceId: "a", maxTotal: 2 });
    expect(hub.register(1, new FakeRes() as any)).toBe(true);
    expect(hub.register(2, new FakeRes() as any)).toBe(true);
    expect(hub.canAccept()).toBe(false);
    expect(hub.register(3, new FakeRes() as any)).toBe(false);
  });

  it("stop() cierra las conexiones", () => {
    const hub = make({ instanceId: "a" });
    const res = new FakeRes();
    hub.register(1, res as any);
    hub.stop();
    expect(res.writableEnded).toBe(true);
    expect(hub.size).toBe(0);
  });
});

describe("SseHub (varios procesos que comparten el buzón)", () => {
  it("un evento generado en el proceso A llega al cliente conectado al proceso B, una sola vez", async () => {
    const store = new MemoryRealtimeStore();
    const a = make({ instanceId: "A", store });
    const b = make({ instanceId: "B", store });
    const clientA = new FakeRes();
    const clientB = new FakeRes();
    a.register(1, clientA as any);
    b.register(2, clientB as any);
    await wait(40); // ambos toman su posición inicial en el buzón

    a.broadcast("alert.created", { n: 1 });
    await wait(80);

    expect(clientA.events()).toHaveLength(1); // local, inmediato, sin duplicarse al consultar el buzón
    expect(clientB.events()).toHaveLength(1);
    expect(clientB.events()[0]).toContain('"n":1');
  });

  it("funciona en ambos sentidos y con varios eventos", async () => {
    const store = new MemoryRealtimeStore();
    const a = make({ instanceId: "A", store });
    const b = make({ instanceId: "B", store });
    const clientA = new FakeRes();
    const clientB = new FakeRes();
    a.register(1, clientA as any);
    b.register(2, clientB as any);
    await wait(40);

    a.broadcastMany([{ event: "alert.created", data: { n: 1 } }, { event: "alert.created", data: { n: 2 } }]);
    b.broadcast("alert.created", { n: 3 });
    await wait(100);

    const seenB = clientB.events().map((e) => JSON.parse(e.split("data: ")[1]!).n);
    const seenA = clientA.events().map((e) => JSON.parse(e.split("data: ")[1]!).n);
    // Cada cliente recibe todos los eventos exactamente una vez...
    expect([...seenB].sort()).toEqual([1, 2, 3]);
    expect([...seenA].sort()).toEqual([1, 2, 3]);
    // ...y se conserva el orden entre los eventos de un mismo proceso. (Entre procesos
    // distintos no hay orden total: el evento local se entrega al instante.)
    expect(seenB.indexOf(1)).toBeLessThan(seenB.indexOf(2));
    expect(seenA.indexOf(1)).toBeLessThan(seenA.indexOf(2));
  });

  it("no reenvía historia: un cliente que se conecta después no recibe eventos anteriores", async () => {
    const store = new MemoryRealtimeStore();
    const a = make({ instanceId: "A", store });
    const b = make({ instanceId: "B", store });
    a.broadcast("alert.created", { viejo: true });
    const late = new FakeRes();
    b.register(1, late as any);
    await wait(80);
    expect(late.events()).toHaveLength(0);
  });

  it("sin clientes conectados no consulta el buzón (cero carga en la base de datos)", async () => {
    const store = new MemoryRealtimeStore();
    let fetches = 0;
    const original = store.fetchSince.bind(store);
    store.fetchSince = async (...args) => {
      fetches++;
      return original(...args);
    };
    const hub = make({ instanceId: "A", store });
    const res = new FakeRes();
    hub.register(1, res as any);
    await wait(60);
    res.emit("close");
    const before = fetches;
    await wait(80);
    expect(fetches).toBe(before);
  });

  it("el buzón purga eventos viejos", async () => {
    const store = new MemoryRealtimeStore();
    await store.publish("A", [{ event: "x", data: 1 }]);
    expect(await store.purgeOlderThan(10)).toBe(0);
    expect(await store.purgeOlderThan(-1)).toBe(1);
  });
});
