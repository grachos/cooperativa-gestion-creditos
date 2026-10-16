import { randomBytes } from "node:crypto";

/**
 * Contraseña aleatoria para los usuarios de las pruebas: se genera en cada corrida, así no hay contraseñas
 * escritas en el repositorio (los detectores de secretos las marcan aunque sean de prueba).
 */
export function randomPassword(): string {
  return `Tp-${randomBytes(9).toString("hex")}-9*`;
}
