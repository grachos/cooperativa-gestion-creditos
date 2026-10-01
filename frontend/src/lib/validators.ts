/** Validaciones de campo reutilizadas en formularios (ej. Asociados), para
 * dar feedback inmediato al salir del campo en vez de esperar la respuesta
 * del backend. Devuelven el mensaje de error en español, o null si es válido. */

export function phoneError(value: string): string | null {
  if (!value.trim()) return null;
  return /^\d{10}$/.test(value.trim()) ? null : "Debe tener 10 dígitos numéricos";
}

export function emailError(value: string): string | null {
  if (!value.trim()) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? null : "Correo electrónico inválido";
}
