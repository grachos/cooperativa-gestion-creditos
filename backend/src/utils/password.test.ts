import bcryptjs from "bcryptjs";
import { describe, expect, it } from "vitest";
import { hashPassword, passwordImplementationName, verifyPassword } from "./password.js";
import { hashToken, verifyToken } from "./tokenHash.js";

describe("password", () => {
  it("genera un hash bcrypt verificable y rechaza una contraseña incorrecta", async () => {
    const hash = await hashPassword("Contraseña-123*");
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    expect(await verifyPassword("Contraseña-123*", hash)).toBe(true);
    expect(await verifyPassword("otra-cosa", hash)).toBe(false);
  });

  it("sigue aceptando hashes creados con bcryptjs (los usuarios existentes no se tocan)", async () => {
    const legacy = bcryptjs.hashSync("Demo1234*", 10);
    expect(await verifyPassword("Demo1234*", legacy)).toBe(true);
    expect(await verifyPassword("mala", legacy)).toBe(false);
  });

  it("los hashes nuevos los puede verificar bcryptjs (compatibilidad hacia atrás)", async () => {
    const hash = await hashPassword("Compatible-1*");
    expect(bcryptjs.compareSync("Compatible-1*", hash)).toBe(true);
  });

  it("informa qué implementación quedó activa", async () => {
    expect(["bcrypt (nativo)", "bcryptjs (JavaScript)"]).toContain(await passwordImplementationName());
  });
});

describe("tokenHash", () => {
  it("SHA-256 hexadecimal, determinista y sin el token en claro", () => {
    const h = hashToken("token-secreto");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("token-secreto")).toBe(h);
    expect(h).not.toContain("token-secreto");
    expect(hashToken("otro")).not.toBe(h);
  });

  it("verifica un token contra su hash SHA-256", async () => {
    const stored = hashToken("abc.def.ghi");
    expect(await verifyToken("abc.def.ghi", stored)).toEqual({ ok: true, legacy: false });
    expect(await verifyToken("abc.def.xyz", stored)).toEqual({ ok: false, legacy: false });
    expect((await verifyToken("abc", "no-es-hex")).ok).toBe(false);
  });

  it("acepta hashes bcrypt antiguos y los marca como legacy", async () => {
    const legacy = bcryptjs.hashSync("token-antiguo", 10);
    expect(await verifyToken("token-antiguo", legacy)).toEqual({ ok: true, legacy: true });
    expect(await verifyToken("otro", legacy)).toEqual({ ok: false, legacy: true });
  });
});
