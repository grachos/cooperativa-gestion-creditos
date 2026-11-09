import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTurnstile, resetCaptchaConfigCache, type UseTurnstile } from "./useTurnstile";

const get = vi.fn();
vi.mock("../lib/api", () => ({ api: { get: (...a: unknown[]) => get(...a) } }));

/** Turnstile simulado: guarda las opciones con las que se dibujó para poder disparar sus callbacks. */
let options: Record<string, any> = {};
const fakeTurnstile = {
  render: vi.fn((_el: HTMLElement, opts: Record<string, any>) => {
    options = opts;
    return "widget-1";
  }),
  reset: vi.fn(),
  remove: vi.fn()
};

let current: UseTurnstile;
function Harness({ action = "login" }: { action?: string }) {
  current = useTurnstile(action);
  return (
    <form>
      {current.widget}
      {current.message && <p role="alert">{current.message}</p>}
      <button type="submit" disabled={!current.canSubmit}>
        Enviar
      </button>
    </form>
  );
}
const button = () => screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement;

beforeEach(() => {
  resetCaptchaConfigCache();
  get.mockReset();
  options = {};
  fakeTurnstile.render.mockClear();
  fakeTurnstile.reset.mockClear();
  fakeTurnstile.remove.mockClear();
  (window as any).turnstile = fakeTurnstile;
});
afterEach(() => {
  cleanup();
  delete (window as any).turnstile;
  document.head.querySelectorAll('script[src*="turnstile"]').forEach((s) => s.remove());
});

describe("useTurnstile", () => {
  it("si no se exige el reto: sin widget, botón habilitado y sin token en la petición", async () => {
    get.mockResolvedValue({ enforce: false, siteKey: null });
    render(<Harness />);
    expect(button().disabled).toBe(true); // mientras carga la configuración
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(fakeTurnstile.render).not.toHaveBeenCalled();
    expect(current.payload).toEqual({});
  });

  it("se exige: dibuja el widget con la clave y la acción del formulario, y el botón espera el token", async () => {
    get.mockResolvedValue({ enforce: true, siteKey: "clave-publica" });
    render(<Harness action="forgot_password" />);
    await waitFor(() => expect(fakeTurnstile.render).toHaveBeenCalledTimes(1));
    expect(options).toMatchObject({ sitekey: "clave-publica", action: "forgot_password" });
    expect(get).toHaveBeenCalledWith("/auth/captcha-config");
    expect(button().disabled).toBe(true);
    expect(current.payload).toEqual({});

    act(() => options.callback("token-abc"));
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(current.payload).toEqual({ "cf-turnstile-response": "token-abc" });
  });

  it("si el token vence o se agota el tiempo: se descarta, se reinicia el reto y el botón se deshabilita", async () => {
    get.mockResolvedValue({ enforce: true, siteKey: "k" });
    render(<Harness />);
    await waitFor(() => expect(options.callback).toBeTypeOf("function"));
    act(() => options.callback("t1"));
    await waitFor(() => expect(button().disabled).toBe(false));

    act(() => options["expired-callback"]());
    await waitFor(() => expect(button().disabled).toBe(true));
    expect(fakeTurnstile.reset).toHaveBeenCalledWith("widget-1");
    expect(current.payload).toEqual({});

    act(() => options.callback("t2"));
    await waitFor(() => expect(button().disabled).toBe(false));
    fakeTurnstile.reset.mockClear();
    act(() => options["timeout-callback"]());
    await waitFor(() => expect(button().disabled).toBe(true));
    expect(fakeTurnstile.reset).toHaveBeenCalledWith("widget-1");
  });

  it("error del widget: avisa que reintente, descarta el token y reinicia el reto", async () => {
    get.mockResolvedValue({ enforce: true, siteKey: "k" });
    render(<Harness />);
    await waitFor(() => expect(options.callback).toBeTypeOf("function"));
    act(() => options.callback("t1"));
    act(() => void options["error-callback"]());
    expect((await screen.findByRole("alert")).textContent).toMatch(/verificación de seguridad/);
    expect(button().disabled).toBe(true);
    expect(fakeTurnstile.reset).toHaveBeenCalled();

    // Al superar de nuevo el reto, el aviso desaparece.
    act(() => options.callback("t3"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(button().disabled).toBe(false);
  });

  it("reset() tras un envío: el token (de un solo uso) se descarta y se pide otro reto", async () => {
    get.mockResolvedValue({ enforce: true, siteKey: "k" });
    render(<Harness />);
    await waitFor(() => expect(options.callback).toBeTypeOf("function"));
    act(() => options.callback("usado"));
    await waitFor(() => expect(button().disabled).toBe(false));

    act(() => current.reset());
    await waitFor(() => expect(button().disabled).toBe(true));
    expect(fakeTurnstile.reset).toHaveBeenCalledWith("widget-1");
    expect(current.payload).toEqual({});
  });

  it("se exige pero el servidor no tiene clave pública: avisa y no deja enviar", async () => {
    get.mockResolvedValue({ enforce: true, siteKey: null });
    render(<Harness />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/no está configurada/);
    expect(button().disabled).toBe(true);
    expect(fakeTurnstile.render).not.toHaveBeenCalled();
  });

  it("si no se puede leer la configuración: avisa, no deja enviar, y un nuevo intento vuelve a pedirla", async () => {
    get.mockRejectedValueOnce(new Error("sin red"));
    render(<Harness />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Recarga la página/);
    expect(button().disabled).toBe(true);

    cleanup();
    get.mockResolvedValue({ enforce: false, siteKey: null });
    render(<Harness />);
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("si el script de Cloudflare no carga (bloqueador de contenido): avisa y no deja enviar", async () => {
    delete (window as any).turnstile;
    get.mockResolvedValue({ enforce: true, siteKey: "k" });
    render(<Harness />);
    await waitFor(() => expect(document.head.querySelector('script[src*="challenges.cloudflare.com"]')).not.toBeNull());
    const script = document.head.querySelector('script[src*="challenges.cloudflare.com"]') as HTMLScriptElement;
    expect(script.src).toContain("render=explicit");
    act(() => void script.onerror?.(new Event("error")));
    expect((await screen.findByRole("alert")).textContent).toMatch(/No se pudo cargar la verificación/);
    expect(button().disabled).toBe(true);
  });

  it("al desmontar quita el widget", async () => {
    get.mockResolvedValue({ enforce: true, siteKey: "k" });
    const { unmount } = render(<Harness />);
    await waitFor(() => expect(fakeTurnstile.render).toHaveBeenCalled());
    unmount();
    expect(fakeTurnstile.remove).toHaveBeenCalledWith("widget-1");
  });
});
