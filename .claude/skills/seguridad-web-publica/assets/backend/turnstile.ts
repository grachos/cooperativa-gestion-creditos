import { env } from "../config/env.js";

/**
 * Verificación de Cloudflare Turnstile en el servidor (obligatoria: el widget solo entrega un token, y es esta
 * llamada a siteverify la que demuestra que el reto se superó).
 *
 * Reglas:
 *  - Falla CERRADO: sin llave secreta, con Cloudflare caído, tiempo agotado (5 s) o respuesta ilegible, se rechaza.
 *  - El token es de un solo uso y dura 5 minutos: Cloudflare responde `timeout-or-duplicate` si se reutiliza o venció,
 *    y además se rechaza un `challenge_ts` más viejo que eso.
 *  - La acción (`action`) del widget debe ser la del formulario, y el `hostname` debe ser uno propio: un token obtenido
 *    en otro sitio o para otro formulario no sirve.
 *  - Los `error-codes` de Cloudflare solo van a los registros (y a la auditoría), nunca a la respuesta al usuario.
 *
 * Códigos que ve el cliente:
 *   CAPTCHA-01  dominio u origen no autorizado
 *   CAPTCHA-02  verificación fallida (bot, reto no superado, o no se pudo verificar)
 *   CAPTCHA-03  token ausente, inválido, vencido o reutilizado
 */

export type CaptchaCode = "CAPTCHA-01" | "CAPTCHA-02" | "CAPTCHA-03";

export type TurnstileOutcome =
  | { ok: true; hostname: string; action: string }
  | {
      ok: false;
      code: CaptchaCode;
      /** Motivo interno, para registros y auditoría (no se muestra al usuario). */
      reason: string;
      /** `error-codes` de Cloudflare, solo para registros y auditoría. */
      errorCodes: string[];
    };

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_TIMEOUT_MS = 5000;
/** El token dura 5 minutos; se tolera un poco de diferencia de reloj. */
export const TOKEN_MAX_AGE_MS = 5 * 60 * 1000 + 30 * 1000;
/** Tamaño máximo de un token según Cloudflare. */
export const MAX_TOKEN_LENGTH = 2048;

/** Claves de prueba oficiales de Cloudflare: para desarrollo y pruebas, nunca para producción. */
export const TURNSTILE_TEST_KEYS = {
  siteAlwaysPasses: "1x00000000000000000000AA",
  siteAlwaysBlocks: "2x00000000000000000000AB",
  siteForcesInteractive: "3x00000000000000000000FF",
  secretAlwaysPasses: "1x0000000000000000000000000000000AA",
  secretAlwaysFails: "2x0000000000000000000000000000000AA",
  secretTokenAlreadySpent: "3x0000000000000000000000000000000AA"
} as const;

const TEST_SECRETS: readonly string[] = [
  TURNSTILE_TEST_KEYS.secretAlwaysPasses,
  TURNSTILE_TEST_KEYS.secretAlwaysFails,
  TURNSTILE_TEST_KEYS.secretTokenAlreadySpent
];

export interface TurnstileOptions {
  secret?: string;
  allowedHostnames: string[];
  timeoutMs: number;
  production: boolean;
  fetchImpl: typeof fetch;
  now: () => number;
  log: (event: Record<string, unknown>) => void;
}

export function defaultTurnstileOptions(): TurnstileOptions {
  return {
    secret: env.TURNSTILE_SECRET_KEY,
    allowedHostnames: env.TURNSTILE_ALLOWED_HOSTNAMES,
    timeoutMs: TURNSTILE_TIMEOUT_MS,
    production: env.NODE_ENV === "production",
    fetchImpl: (...args) => fetch(...args),
    now: () => Date.now(),
    log: (event) => console.error(JSON.stringify({ t: "turnstile", ...event }))
  };
}

const normalizeHost = (host: string) => host.trim().toLowerCase().replace(/\.$/, "");

// Errores de Cloudflare que significan "este token no sirve" (ausente, inválido, vencido o ya usado).
const TOKEN_ERRORS = new Set(["missing-input-response", "invalid-input-response", "timeout-or-duplicate"]);

/**
 * Verifica el token del widget. Nunca lanza: cualquier fallo devuelve `{ ok: false }`.
 *
 * @param token  valor de `cf-turnstile-response` enviado por el navegador
 * @param expectedAction  acción del formulario (`login`, `forgot_password`, ...)
 * @param ip  IP del cliente (se envía a Cloudflare como `remoteip`)
 */
export async function verifyTurnstile(
  token: unknown,
  expectedAction: string,
  ip: string | undefined,
  overrides: Partial<TurnstileOptions> = {}
): Promise<TurnstileOutcome> {
  const opts: TurnstileOptions = { ...defaultTurnstileOptions(), ...overrides };
  const fail = (code: CaptchaCode, reason: string, errorCodes: string[] = [], extra: Record<string, unknown> = {}): TurnstileOutcome => {
    opts.log({ result: "rejected", reason, code, errorCodes, expectedAction, ...extra });
    return { ok: false, code, reason, errorCodes };
  };

  // Configuración: sin esto no se puede verificar nada, y no se deja pasar a nadie.
  if (!opts.secret) return fail("CAPTCHA-02", "secret_missing");
  const isTestSecret = TEST_SECRETS.includes(opts.secret);
  if (isTestSecret && opts.production) return fail("CAPTCHA-02", "test_secret_in_production");
  const allowed = opts.allowedHostnames.map(normalizeHost).filter(Boolean);
  if (!isTestSecret && allowed.length === 0) return fail("CAPTCHA-01", "allowed_hostnames_missing");

  if (typeof token !== "string" || token.trim() === "" || token.length > MAX_TOKEN_LENGTH) {
    return fail("CAPTCHA-03", "token_missing_or_malformed");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let data: Record<string, unknown>;
  try {
    const response = await opts.fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: opts.secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: controller.signal
    });
    if (!response.ok) return fail("CAPTCHA-02", "cloudflare_http_error", [], { status: response.status });
    data = (await response.json()) as Record<string, unknown>;
  } catch (err) {
    const aborted = (err as { name?: string })?.name === "AbortError";
    return fail("CAPTCHA-02", aborted ? "cloudflare_timeout" : "cloudflare_unreachable");
  } finally {
    clearTimeout(timer);
  }
  if (!data || typeof data !== "object") return fail("CAPTCHA-02", "cloudflare_bad_response");

  const errorCodes = Array.isArray(data["error-codes"]) ? (data["error-codes"] as unknown[]).map(String) : [];

  if (data.success !== true) {
    if (errorCodes.some((c) => TOKEN_ERRORS.has(c))) return fail("CAPTCHA-03", "token_rejected", errorCodes);
    // Incluye llave secreta inválida (error de configuración: queda en el registro) y reto no superado.
    return fail("CAPTCHA-02", "verification_failed", errorCodes);
  }

  const hostname = typeof data.hostname === "string" ? data.hostname : "";
  const action = typeof data.action === "string" ? data.action : "";

  // Con las claves de prueba los tokens son ficticios: Cloudflare no devuelve acción ni dominio reales.
  if (!isTestSecret) {
    const challengeTs = typeof data.challenge_ts === "string" ? Date.parse(data.challenge_ts) : NaN;
    if (Number.isFinite(challengeTs) && opts.now() - challengeTs > TOKEN_MAX_AGE_MS) {
      return fail("CAPTCHA-03", "token_expired", errorCodes, { hostname, action });
    }
    if (!allowed.includes(normalizeHost(hostname))) return fail("CAPTCHA-01", "hostname_not_allowed", errorCodes, { hostname, action });
    if (action !== expectedAction) return fail("CAPTCHA-02", "action_mismatch", errorCodes, { hostname, action });
  }

  return { ok: true, hostname, action };
}
