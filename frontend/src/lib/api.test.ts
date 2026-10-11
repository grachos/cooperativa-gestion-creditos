import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, RETRY_POLICY } from "./api";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
const headersOf = (call: number) => (fetchMock.mock.calls[call]![1] as RequestInit).headers as Record<string, string>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  RETRY_POLICY.delaysMs = [0, 0, 0];
  localStorage.clear();
  localStorage.setItem("accessToken", "tok");
});
afterEach(() => vi.unstubAllGlobals());

describe("api.post con idempotencyKey", () => {
  it("envía el header Idempotency-Key", async () => {
    fetchMock.mockResolvedValueOnce(json(201, { id: 1 }));
    await api.post("/payments", { a: 1 }, { idempotencyKey: "key-aaaaaaaaaaaaaaaa" });
    expect(headersOf(0)["Idempotency-Key"]).toBe("key-aaaaaaaaaaaaaaaa");
  });

  it("no envía el header si no hay clave (compatibilidad)", async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await api.post("/auth/logout");
    expect(headersOf(0)["Idempotency-Key"]).toBeUndefined();
  });

  it("reintenta tras un fallo de red con la MISMA clave y el MISMO cuerpo", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(json(201, { id: 7 }));
    const out = await api.post<{ id: number }>("/payments", { amount: 5 }, { idempotencyKey: "key-bbbbbbbbbbbbbbbb" });
    expect(out.id).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersOf(1)["Idempotency-Key"]).toBe(headersOf(0)["Idempotency-Key"]);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).body).toBe((fetchMock.mock.calls[0]![1] as RequestInit).body);
  });

  it("reintenta ante 503 y ante 409 IDEMPOTENCY_IN_PROGRESS", async () => {
    fetchMock
      .mockResolvedValueOnce(json(503, { error: "x" }))
      .mockResolvedValueOnce(json(409, { error: "en curso", code: "IDEMPOTENCY_IN_PROGRESS" }))
      .mockResolvedValueOnce(json(201, { id: 1 }));
    await api.post("/payments", {}, { idempotencyKey: "key-cccccccccccccccc" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const keys = new Set([0, 1, 2].map((i) => headersOf(i)["Idempotency-Key"]));
    expect(keys.size).toBe(1);
  });

  it("deja de reintentar al agotar la política y propaga el error de red", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.post("/payments", {}, { idempotencyKey: "key-dddddddddddddddd" })).rejects.toThrow("Failed to fetch");
    expect(fetchMock).toHaveBeenCalledTimes(1 + RETRY_POLICY.delaysMs.length);
  });

  it("NO reintenta un 409 de conflicto de clave ni un 400", async () => {
    fetchMock.mockResolvedValueOnce(json(409, { error: "otra petición", code: "IDEMPOTENCY_KEY_REUSED" }));
    await expect(api.post("/payments", {}, { idempotencyKey: "key-eeeeeeeeeeeeeeee" })).rejects.toThrow("otra petición");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sin clave NO reintenta ante fallos de red (no es seguro repetir)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.post("/payments", {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("al renovar el token tras un 401 reutiliza la misma clave", async () => {
    localStorage.setItem("refreshToken", "r");
    fetchMock
      .mockResolvedValueOnce(json(401, { error: "expirado" }))
      .mockResolvedValueOnce(json(200, { accessToken: "nuevo" })) // /auth/refresh
      .mockResolvedValueOnce(json(201, { id: 9 }));
    await api.post("/payments", { a: 1 }, { idempotencyKey: "key-ffffffffffffffff" });
    expect(headersOf(0)["Idempotency-Key"]).toBe("key-ffffffffffffffff");
    const last = fetchMock.mock.calls.length - 1;
    expect(headersOf(last)["Idempotency-Key"]).toBe("key-ffffffffffffffff");
  });
});
