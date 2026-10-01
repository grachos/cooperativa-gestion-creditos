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

export function calculateAge(birthDate: string): number | null {
  const dob = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const beforeBirthdayThisYear =
    today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate());
  if (beforeBirthdayThisYear) age--;
  return age;
}

export function birthDateError(value: string): string | null {
  if (!value.trim()) return null;
  const age = calculateAge(value);
  if (age === null) return "Fecha de nacimiento inválida";
  return age >= 18 ? null : "El asociado debe ser mayor de edad (18 años o más) para registrarse";
}
