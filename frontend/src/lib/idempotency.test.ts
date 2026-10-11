import { beforeEach, describe, expect, it } from "vitest";
import { CLIENT_KEY_MAX_AGE_MS, idempotencyKeys, stableStringify } from "./idempotency";

beforeEach(() => idempotencyKeys.reset());

describe("idempotencyKeys", () => {
  it("reutiliza la misma clave para el mismo contenido (reintentos)", () => {
    const a = idempotencyKeys.acquire("pago:1", { amount: 10, method: "EFECTIVO" });
    const b = idempotencyKeys.acquire("pago:1", { method: "EFECTIVO", amount: 10 }); // otro orden de llaves
    expect(b).toBe(a);
  });

  it("genera una clave nueva si cambia el contenido", () => {
    const a = idempotencyKeys.acquire("pago:1", { amount: 10 });
    const b = idempotencyKeys.acquire("pago:1", { amount: 11 });
    expect(b).not.toBe(a);
  });

  it("genera una clave nueva tras liberar (la operación terminó bien)", () => {
    const a = idempotencyKeys.acquire("pago:1", { amount: 10 });
    idempotencyKeys.release("pago:1");
    expect(idempotencyKeys.acquire("pago:1", { amount: 10 })).not.toBe(a);
  });

  it("las claves de distintas operaciones son independientes", () => {
    expect(idempotencyKeys.acquire("pago:1", { a: 1 })).not.toBe(idempotencyKeys.acquire("pago:2", { a: 1 }));
  });

  it("sobrevive a una recarga (sessionStorage) mientras el contenido sea el mismo", () => {
    const a = idempotencyKeys.acquire("pago:1", { amount: 10 });
    // simula la recarga: se pierde la memoria pero no sessionStorage
    const stored = sessionStorage.getItem("idem:pago:1");
    idempotencyKeys.reset();
    sessionStorage.setItem("idem:pago:1", stored!);
    expect(idempotencyKeys.acquire("pago:1", { amount: 10 })).toBe(a);
  });

  it("descarta claves más viejas que la vigencia del servidor", () => {
    const t0 = 1_000;
    const a = idempotencyKeys.acquire("pago:1", { amount: 10 }, t0);
    expect(idempotencyKeys.acquire("pago:1", { amount: 10 }, t0 + CLIENT_KEY_MAX_AGE_MS - 1)).toBe(a);
    expect(idempotencyKeys.acquire("pago:1", { amount: 10 }, t0 + CLIENT_KEY_MAX_AGE_MS + 1)).not.toBe(a);
  });

  it("las claves cumplen el formato que exige el servidor", () => {
    expect(idempotencyKeys.acquire("x", {})).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });
});

describe("stableStringify", () => {
  it("ignora el orden de llaves y los undefined", () => {
    expect(stableStringify({ b: 1, a: undefined, c: [{ y: 1, x: 2 }] })).toBe(stableStringify({ c: [{ x: 2, y: 1 }], b: 1 }));
  });
});
