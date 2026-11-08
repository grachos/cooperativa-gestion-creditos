import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";
import { resetCaptchaConfigCache } from "../hooks/useTurnstile";

const login = vi.fn();
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ login }) }));
const get = vi.fn();
const post = vi.fn();
vi.mock("../lib/api", () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

const widgets: Array<{ action: string; opts: Record<string, any> }> = [];
const fakeTurnstile = {
  render: vi.fn((_el: HTMLElement, opts: Record<string, any>) => {
    widgets.push({ action: opts.action, opts });
    return `w${widgets.length}`;
  }),
  reset: vi.fn(),
  remove: vi.fn()
};
const lastWidget = () => widgets[widgets.length - 1]!;

beforeEach(() => {
  resetCaptchaConfigCache();
  login.mockReset();
  get.mockReset();
  post.mockReset();
  widgets.length = 0;
  fakeTurnstile.render.mockClear();
  fakeTurnstile.reset.mockClear();
  (window as any).turnstile = fakeTurnstile;
});
afterEach(() => {
  cleanup();
  delete (window as any).turnstile;
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
const submitButton = () => screen.getByRole("button", { name: /Ingresar|Ingresando/ }) as HTMLButtonElement;
function fillLogin() {
  fireEvent.change(screen.getByLabelText("Usuario o correo"), { target: { value: "ana@coop.com" } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "ClaveSegura-1" } });
}

describe("LoginPage con reto anti-bots", () => {
  it("el botón queda deshabilitado hasta superar el reto, y el token viaja con la acción «login»", async () => {
    get.mockResolvedValue({ enforce: true, siteKey: "clave-publica" });
    login.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(fakeTurnstile.render).toHaveBeenCalledTimes(1));
    expect(lastWidget().action).toBe("login");
    expect(lastWidget().opts.sitekey).toBe("clave-publica");
    fillLogin();
    expect(submitButton().disabled).toBe(true);

    act(() => lastWidget().opts.callback("token-login"));
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fireEvent.click(submitButton());
    await waitFor(() => expect(login).toHaveBeenCalledWith("ana@coop.com", "ClaveSegura-1", { "cf-turnstile-response": "token-login" }));
  });

  it("si el acceso falla se muestra el mensaje y se pide otro reto (el token ya está usado)", async () => {
    get.mockResolvedValue({ enforce: true, siteKey: "k" });
    login.mockRejectedValue(new Error("Credenciales inválidas"));
    renderPage();
    await waitFor(() => expect(fakeTurnstile.render).toHaveBeenCalled());
    fillLogin();
    act(() => lastWidget().opts.callback("token-1"));
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fakeTurnstile.reset.mockClear();

    fireEvent.click(submitButton());
    expect(await screen.findByText("Credenciales inválidas")).toBeTruthy();
    await waitFor(() => expect(fakeTurnstile.reset).toHaveBeenCalled());
    expect(submitButton().disabled).toBe(true); // hasta superar el nuevo reto
  });

  it("muestra el aviso de un rechazo del reto (CAPTCHA-0x) que trae `message` y no `error`", async () => {
    get.mockResolvedValue({ enforce: true, siteKey: "k" });
    login.mockRejectedValue(new Error("La verificación de seguridad venció o no es válida. Vuelve a intentarlo."));
    renderPage();
    await waitFor(() => expect(fakeTurnstile.render).toHaveBeenCalled());
    fillLogin();
    act(() => lastWidget().opts.callback("t"));
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fireEvent.click(submitButton());
    expect(await screen.findByText(/venció o no es válida/)).toBeTruthy();
  });

  it("recuperar contraseña usa su propia acción («forgot_password») y envía el token", async () => {
    get.mockResolvedValue({ enforce: true, siteKey: "k" });
    post.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => expect(fakeTurnstile.render).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("¿Olvidaste tu contraseña?"));
    await waitFor(() => expect(fakeTurnstile.render).toHaveBeenCalledTimes(2));
    expect(lastWidget().action).toBe("forgot_password");

    const send = () => screen.getByRole("button", { name: /Enviar enlace/ }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Usuario o correo"), { target: { value: "ana@coop.com" } });
    expect(send().disabled).toBe(true);
    act(() => lastWidget().opts.callback("token-olvido"));
    await waitFor(() => expect(send().disabled).toBe(false));
    fireEvent.click(send());
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/auth/forgot-password", { identifier: "ana@coop.com", "cf-turnstile-response": "token-olvido" })
    );
  });

  it("si no se exige el reto no aparece widget y el login funciona como antes", async () => {
    get.mockResolvedValue({ enforce: false, siteKey: null });
    login.mockResolvedValue(undefined);
    renderPage();
    fillLogin();
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    expect(fakeTurnstile.render).not.toHaveBeenCalled();
    fireEvent.click(submitButton());
    await waitFor(() => expect(login).toHaveBeenCalledWith("ana@coop.com", "ClaveSegura-1", {}));
  });
});
