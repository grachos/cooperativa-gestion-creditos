import { describe, expect, it } from "vitest";
import { metrics, normalizeSql, RollingLatency } from "./metrics.js";
import { recordQueryTiming } from "./queryTiming.js";

describe("RollingLatency", () => {
  it("calcula percentiles", () => {
    const r = new RollingLatency(1000);
    for (let i = 1; i <= 100; i++) r.add(i);
    expect(r.percentiles()).toMatchObject({ samples: 100, p50: 51, p95: 96, p99: 100, max: 100 });
  });
  it("es una ventana: los valores viejos se descartan", () => {
    const r = new RollingLatency(10);
    for (let i = 0; i < 10; i++) r.add(1000);
    for (let i = 0; i < 10; i++) r.add(1);
    expect(r.percentiles()).toMatchObject({ samples: 10, p50: 1, max: 1 });
  });
  it("vacío no falla", () => {
    expect(new RollingLatency().percentiles()).toEqual({ samples: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});

describe("consultas lentas", () => {
  it("normaliza el SQL: sin saltos de línea repetidos y acotado", () => {
    expect(normalizeSql("SELECT *\n   FROM   t\n WHERE a = 1")).toBe("SELECT * FROM t WHERE a = 1");
    expect(normalizeSql("x".repeat(500), 50)).toHaveLength(51);
  });
  it("registra solo las que pasan del umbral, y el log no incluye parámetros", () => {
    const logged: string[] = [];
    const before = metrics.snapshot().requests.slowRequests;
    recordQueryTiming(10, "SELECT 1", 500, (l) => logged.push(l));
    expect(logged).toHaveLength(0);
    recordQueryTiming(800, "SELECT * FROM associates\n WHERE id_number = ?", 500, (l) => logged.push(l));
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0]!)).toMatchObject({ t: "slowq", ms: 800, sql: "SELECT * FROM associates WHERE id_number = ?" });
    expect(metrics.snapshot().queries.recentSlow[0]).toMatchObject({ ms: 800 });
    expect(metrics.snapshot().requests.slowRequests).toBe(before);
  });
});
