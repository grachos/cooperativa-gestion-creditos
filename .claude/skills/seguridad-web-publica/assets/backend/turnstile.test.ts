import { describe, expect, it, vi } from "vitest";
import {
  MAX_TOKEN_LENGTH,
  SITEVERIFY_URL,
  TURNSTILE_TEST_KEYS,
  verifyTurnstile,
  type TurnstileOptions
} from "./turnstile.js";

/** Respuestas de siteverify simuladas: ninguna prueba toca la red ni el widget real. */
const NOW = Date.parse("2026-11-08T15:00:00Z");
const goodResponse = (extra: Record<string, unknown> = {}) => ({
  success: true,
  "error-codes": [],
  challenge_ts: new Date(NOW - 10_000).toISOString(),
  hostname: "coomulnissi.cc",
  action: "login",
  ...extra
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup(handler: (body: any, init: RequestInit) => Response | Promise<Response>, over: Partial<TurnstileOptions> = {}) {
  const log = vi.fn();
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => handler(JSON.parse(String(init?.body)), init ?? {}));
  const options: Partial<TurnstileOptions> = {
    secret: "secreto-de-produccion",
    allowedHostnames: ["coomulnissi.cc", "www.coomulnissi.cc"],
    timeoutMs: 5000,
    production: true,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => NOW,
    log,
    ...over
  };
  return { options, fetchImpl, log };
}
const verify = (token: unknown, o: Partial<TurnstileOptions>, action = "login", ip: string | null = "203.0.113.7") =>
  verifyTurnstile(token, action, ip ?? undefined, o);

describe("verifyTurnstile", () => {
  it("token válido: acepta y envía secret, response y remoteip a siteverify", async () => {
    const { options, fetchImpl, log } = setup(() => json(goodResponse()));
    const r = await verify("token-bueno", options);
    expect(r).toEqual({ ok: true, hostname: "coomulnissi.cc", action: "login" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ secret: "secreto-de-produccion", response: "token-bueno", remoteip: "203.0.113.7" });
    expect(log).not.toHaveBeenCalled();
  });

  it("acepta también el dominio con www y sin distinguir mayúsculas", async () => {
    const { options } = setup(() => json(goodResponse({ hostname: "WWW.Coomulnissi.cc." })));
    expect((await verify("t", options)).ok).toBe(true);
  });

  it("acción errónea: un token de otro formulario no sirve (CAPTCHA-02)", async () => {
    const { options, log } = setup(() => json(goodResponse({ action: "forgot_password" })));
    const r = await verify("t", options, "login");
    expect(r).toMatchObject({ ok: false, code: "CAPTCHA-02", reason: "action_mismatch" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("hostname ajeno: un token obtenido en otro sitio no sirve (CAPTCHA-01)", async () => {
    const { options } = setup(() => json(goodResponse({ hostname: "sitio-del-atacante.com" })));
    expect(await verify("t", options)).toMatchObject({ ok: false, code: "CAPTCHA-01", reason: "hostname_not_allowed" });
  });

  it("token reutilizado: Cloudflare solo lo acepta una vez (CAPTCHA-03)", async () => {
    const spent = new Set<string>();
    const { options } = setup((body) => {
      if (spent.has(body.response)) return json({ success: false, "error-codes": ["timeout-or-duplicate"] });
      spent.add(body.response);
      return json(goodResponse());
    });
    expect((await verify("un-solo-uso", options)).ok).toBe(true);
    expect(await verify("un-solo-uso", options)).toMatchObject({ ok: false, code: "CAPTCHA-03", reason: "token_rejected" });
  });

  it("token vencido: se rechaza aunque Cloudflare lo diera por bueno (CAPTCHA-03)", async () => {
    const old = new Date(NOW - 6 * 60 * 1000).toISOString();
    const { options } = setup(() => json(goodResponse({ challenge_ts: old })));
    expect(await verify("t", options)).toMatchObject({ ok: false, code: "CAPTCHA-03", reason: "token_expired" });
  });

  it("token ausente, vacío, mal formado o demasiado largo: CAPTCHA-03 sin llamar a Cloudflare", async () => {
    const { options, fetchImpl } = setup(() => json(goodResponse()));
    for (const bad of [undefined, null, "", "   ", 123, {}, "x".repeat(MAX_TOKEN_LENGTH + 1)]) {
      expect(await verify(bad, options)).toMatchObject({ ok: false, code: "CAPTCHA-03", reason: "token_missing_or_malformed" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reto no superado (bot): CAPTCHA-02, y los error-codes quedan solo en el resultado interno y el registro", async () => {
    const { options, log } = setup(() => json({ success: false, "error-codes": ["internal-error"] }));
    const r = await verify("t", options);
    expect(r).toMatchObject({ ok: false, code: "CAPTCHA-02", reason: "verification_failed", errorCodes: ["internal-error"] });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ errorCodes: ["internal-error"] }));
  });

  it("llave secreta inválida en Cloudflare: CAPTCHA-02 (error de configuración, queda en el registro)", async () => {
    const { options, log } = setup(() => json({ success: false, "error-codes": ["invalid-input-secret"] }));
    expect(await verify("t", options)).toMatchObject({ ok: false, code: "CAPTCHA-02" });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ errorCodes: ["invalid-input-secret"] }));
  });

  describe("falla cerrado", () => {
    it("sin llave secreta: rechaza y no llama a Cloudflare", async () => {
      const { options, fetchImpl } = setup(() => json(goodResponse()), { secret: undefined });
      expect(await verify("t", options)).toMatchObject({ ok: false, code: "CAPTCHA-02", reason: "secret_missing" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("sin lista de dominios propios: rechaza (no se acepta cualquier dominio)", async () => {
      const { options, fetchImpl } = setup(() => json(goodResponse()), { allowedHostnames: [] });
      expect(await verify("t", options)).toMatchObject({ ok: false, code: "CAPTCHA-01", reason: "allowed_hostnames_missing" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("Cloudflare caído (error de red): rechaza", async () => {
      const { options } = setup(() => {
        throw new TypeError("fetch failed");
      });
      expect(await verify("t", options)).toMatchObject({ ok: false, code: "CAPTCHA-02", reason: "cloudflare_unreachable" });
    });

    it("Cloudflare responde 500 o algo que no es JSON: rechaza", async () => {
      const a = setup(() => new Response("boom", { status: 500 }));
      expect(await verify("t", a.options)).toMatchObject({ ok: false, code: "CAPTCHA-02", reason: "cloudflare_http_error" });
      const b = setup(() => new Response("<html>no soy json</html>", { status: 200 }));
      expect(await verify("t", b.options)).toMatchObject({ ok: false, code: "CAPTCHA-02", reason: "cloudflare_unreachable" });
      const c = setup(() => json(null));
      expect(await verify("t", c.options)).toMatchObject({ ok: false, code: "CAPTCHA-02" });
    });

    it("Cloudflare no responde: se corta por tiempo (5 s en producción) y rechaza", async () => {
      const { options } = setup(
        (_body, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          }),
        { timeoutMs: 30 }
      );
      const started = Date.now();
      expect(await verify("t", options)).toMatchObject({ ok: false, code: "CAPTCHA-02", reason: "cloudflare_timeout" });
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  describe("claves de prueba oficiales de Cloudflare", () => {
    it("en desarrollo y pruebas sirven con tokens ficticios (no traen acción ni dominio reales)", async () => {
      const { options } = setup(() => json({ success: true, "error-codes": [], hostname: "example.com", action: "" }), {
        secret: TURNSTILE_TEST_KEYS.secretAlwaysPasses,
        allowedHostnames: [],
        production: false
      });
      expect(await verify("XXXX.DUMMY.TOKEN.XXXX", options)).toMatchObject({ ok: true });
    });

    it("la que siempre falla, falla", async () => {
      const { options } = setup(() => json({ success: false, "error-codes": ["invalid-input-response"] }), {
        secret: TURNSTILE_TEST_KEYS.secretAlwaysFails,
        production: false
      });
      expect(await verify("XXXX.DUMMY.TOKEN.XXXX", options)).toMatchObject({ ok: false, code: "CAPTCHA-03" });
    });

    it("en producción se rechazan siempre (una llave de prueba dejaría pasar a cualquiera)", async () => {
      const { options, fetchImpl } = setup(() => json({ success: true, "error-codes": [] }), {
        secret: TURNSTILE_TEST_KEYS.secretAlwaysPasses,
        production: true
      });
      expect(await verify("XXXX.DUMMY.TOKEN.XXXX", options)).toMatchObject({ ok: false, code: "CAPTCHA-02", reason: "test_secret_in_production" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  it("nunca registra el token ni la llave secreta", async () => {
    const { options, log } = setup(() => json({ success: false, "error-codes": ["internal-error"] }));
    await verify("TOKEN-SECRETO-DEL-USUARIO", options);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("TOKEN-SECRETO-DEL-USUARIO");
    expect(logged).not.toContain("secreto-de-produccion");
  });

  it("sin IP no envía remoteip", async () => {
    const { options, fetchImpl } = setup(() => json(goodResponse()));
    await verify("t", options, "login", null);
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).not.toHaveProperty("remoteip");
  });
});
