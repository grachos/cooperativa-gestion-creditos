import bcryptjs from "bcryptjs";

/**
 * Hash y verificación de contraseñas con bcrypt (costo 10, igual que siempre:
 * los hashes ya guardados siguen siendo válidos).
 *
 * Por qué existe este módulo: `bcryptjs` es JavaScript puro y corre en el hilo
 * principal, así que cada hash congela TODO el servidor ~100 ms. Con 30 logins
 * simultáneos medimos que hasta /health tardaba 1,4 s en responder. El paquete
 * nativo `bcrypt` hace el mismo cálculo en el pool de hilos de libuv (no bloquea
 * el hilo principal) y es el mismo algoritmo y formato ($2a/$2b), por lo que no
 * requiere migrar nada.
 *
 * `bcrypt` está en optionalDependencies: si no se pudiera instalar o cargar
 * (otro sistema operativo, sin binario precompilado), se usa `bcryptjs`
 * automáticamente. Funciona igual, solo es más lento bajo carga.
 */
export const BCRYPT_COST = 10;

interface Implementation {
  name: "bcrypt (nativo)" | "bcryptjs (JavaScript)";
  hash(plain: string): Promise<string>;
  compare(plain: string, hash: string): Promise<boolean>;
}

const javascript: Implementation = {
  name: "bcryptjs (JavaScript)",
  hash: (plain) => bcryptjs.hash(plain, BCRYPT_COST),
  compare: (plain, hash) => bcryptjs.compare(plain, hash)
};

let loading: Promise<Implementation> | null = null;

async function load(): Promise<Implementation> {
  try {
    const specifier = "bcrypt"; // variable: dependencia opcional, sin tipos obligatorios
    const mod: any = await import(specifier);
    const native = mod.default ?? mod;
    // Prueba mínima: confirma que el binario carga y funciona de verdad.
    const probe = await native.hash("probe", 4);
    if (!(await native.compare("probe", probe))) throw new Error("verificación de bcrypt nativo falló");
    return {
      name: "bcrypt (nativo)",
      hash: (plain) => native.hash(plain, BCRYPT_COST),
      compare: (plain, hash) => native.compare(plain, hash)
    };
  } catch (err) {
    console.warn("[password] bcrypt nativo no disponible; se usa bcryptjs (más lento bajo carga):", (err as Error).message);
    return javascript;
  }
}

function implementation(): Promise<Implementation> {
  loading ??= load();
  return loading;
}

export async function hashPassword(plain: string): Promise<string> {
  return (await implementation()).hash(plain);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return (await implementation()).compare(plain, hash);
}

/** Qué implementación quedó activa (para registrarlo al arrancar). */
export async function passwordImplementationName(): Promise<string> {
  return (await implementation()).name;
}
