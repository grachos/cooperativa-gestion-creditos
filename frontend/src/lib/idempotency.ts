/**
 * Claves de idempotencia por operación lógica.
 *
 * Una "operación lógica" es un envío concreto de un formulario con un contenido
 * concreto. Mientras el usuario reintente ese mismo contenido (tras un error
 * de red, un timeout o una recarga), se reutiliza EXACTAMENTE la misma clave.
 * Si cambia el contenido, o la operación anterior terminó bien, la siguiente
 * acción recibe una clave nueva.
 *
 * Las claves se guardan en sessionStorage (por pestaña) para sobrevivir a una
 * recarga; si no está disponible (modo privado) se usa solo memoria.
 */

// Mismo orden de magnitud que la vigencia por defecto del servidor
// (IDEMPOTENCY_TTL_HOURS = 24): pasado ese tiempo el servidor ya la olvidó.
export const CLIENT_KEY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = "idem:";

interface Entry {
  key: string;
  fingerprint: string;
  createdAt: number;
}

const memory = new Map<string, Entry>();

export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** JSON estable (llaves ordenadas): el mismo contenido da siempre la misma huella. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

function readStored(scope: string): Entry | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + scope);
    return raw ? (JSON.parse(raw) as Entry) : null;
  } catch {
    return null;
  }
}

function writeStored(scope: string, entry: Entry | null) {
  try {
    if (entry) sessionStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(entry));
    else sessionStorage.removeItem(STORAGE_PREFIX + scope);
  } catch {
    /* sin sessionStorage: queda la copia en memoria */
  }
}

export const idempotencyKeys = {
  /**
   * Devuelve la clave de la operación `scope` para este contenido. Reutiliza la
   * existente si el contenido es el mismo; si no, crea una nueva.
   */
  acquire(scope: string, payload: unknown, now: number = Date.now()): string {
    const fingerprint = stableStringify(payload);
    const current = memory.get(scope) ?? readStored(scope);
    if (current && current.fingerprint === fingerprint && now - current.createdAt < CLIENT_KEY_MAX_AGE_MS) {
      memory.set(scope, current);
      return current.key;
    }
    const entry: Entry = { key: newIdempotencyKey(), fingerprint, createdAt: now };
    memory.set(scope, entry);
    writeStored(scope, entry);
    return entry.key;
  },

  /** La operación terminó bien: la próxima acción del usuario es una operación nueva. */
  release(scope: string) {
    memory.delete(scope);
    writeStored(scope, null);
  },

  /** Solo para pruebas. */
  reset() {
    memory.clear();
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k?.startsWith(STORAGE_PREFIX)) sessionStorage.removeItem(k);
      }
    } catch {
      /* ignore */
    }
  }
};
