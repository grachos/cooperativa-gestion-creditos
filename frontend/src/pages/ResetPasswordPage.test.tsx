import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResetPasswordPage from "./ResetPasswordPage";
import { resetCaptchaConfigCache } from "../hooks/useTurnstile";

const get = vi.fn();
const post = vi.fn();
vi.mock("../lib/api", () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

let opts: Record<string, any> = {};
const fakeTurnstile = {
  render: vi.fn((_el: HTMLElement, o: Record<string, any>) => {
    opts = o;
    return "w1";
  }),
  reset: vi.fn(),
  remove: vi.fn()
};

beforeEach(() => {
  resetCaptchaConfigCache();
  get.mockReset();
  post.mockReset();
  fakeTurnstile.render.mockClear();
  (window as any).turnstile = fakeTurnstile;
});
afterEach(() => {
  cleanup();
  delete (window as any).turnstile;
});

describe("ResetPasswordPage con reto anti-bots", () => {
  it("usa la acción «reset_password», espera el token y lo envía junto con la nueva contraseña", async () => {
    get.mockResolvedValue({ enforce: true, siteKey: "k" });
    post.mockResolvedValue(undefined);
    render(
      <MemoryRouter initialEntries={["/restablecer-contrasena?token=abc&uid=7"]}>
        <ResetPasswordPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(fakeTurnstile.render).toHaveBeenCalledTimes(1));
    expect(opts.action).toBe("reset_password");
    fireEvent.change(screen.getByLabelText("Nueva contraseña"), { target: { value: "Nueva-Clave-123!" } });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña"), { target: { value: "Nueva-Clave-123!" } });
    const save = () => screen.getByRole("button", { name: /Guardar nueva contraseña/ }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    act(() => opts.callback("token-reset"));
    await waitFor(() => expect(save().disabled).toBe(false));
    fireEvent.click(save());
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/auth/reset-password", {
        token: "abc",
        uid: 7,
        newPassword: "Nueva-Clave-123!",
        "cf-turnstile-response": "token-reset"
      })
    );
  });
});
