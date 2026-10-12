import crypto from "node:crypto";
import { verifyPassword } from "./password.js";

/**
 * Hash de TOKENS (refresh token, token de restablecer contraseña).
 *
 * Se usa SHA-256, no bcrypt: estos valores no los elige una persona, son
 * aleatorios de alta entropía (256 bits el de restablecer; un JWT firmado con
 * HMAC-256 el de sesión). Un hash lento sirve para frenar la adivinanza de
 * contraseñas cortas; aquí no hay nada que adivinar, y bcrypt solo costaba
 * ~100 ms de CPU del hilo principal por login, por refresh y por correo.
 * Si alguien leyera la base de datos, el SHA-256 de un token aleatorio de 256
 * bits no se puede revertir ni usar para iniciar sesión.
 */
export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

const LEGACY_BCRYPT = /^\$2[aby]\$/;

/**
 * Compara un token con el valor guardado. Acepta los hashes antiguos (bcrypt)
 * guardados antes de este cambio, para no cerrar sesiones ni invalidar enlaces
 * de restablecimiento vigentes. `legacy` indica que coincidió un hash antiguo
 * (el llamador puede reemplazarlo por SHA-256).
 */
export async function verifyToken(raw: string, stored: string): Promise<{ ok: boolean; legacy: boolean }> {
  if (LEGACY_BCRYPT.test(stored)) {
    return { ok: await verifyPassword(raw, stored), legacy: true };
  }
  const a = Buffer.from(hashToken(raw), "hex");
  const b = Buffer.from(stored, "hex");
  return { ok: a.length === b.length && crypto.timingSafeEqual(a, b), legacy: false };
}
