import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionsPanel } from "./UsersPage";

const catalog = [
  { module: "associates", label: "Asociados y sociedades", actions: [{ code: "associates:read", label: "Ver asociados" }, { code: "associates:create", label: "Crear asociados" }] },
  { module: "payments", label: "Pagos", actions: [{ code: "payments:write", label: "Registrar pagos" }, { code: "payments:reverse", label: "Reversar pagos" }] }
];
const user = { id: 7, full_name: "Tatiana", email: "t@x.co", username: "tati", status: "ACTIVO" as const, role_codes: ["OPERADOR"], permissions: ["associates:read", "payments:write"], id_type: null, id_number: null, phone: null, address: null };

let puts: unknown[];
beforeEach(() => {
  localStorage.setItem("accessToken", "tok");
  puts = [];
  vi.stubGlobal("fetch", vi.fn((_u: string, init?: RequestInit) => {
    if (init?.method === "PUT") puts.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PermissionsPanel user={user} catalog={catalog} onSaved={() => {}} /></QueryClientProvider>);
}

describe("PermissionsPanel (permisos por módulo)", () => {
  it("muestra una tarjeta por módulo con una casilla por acción, marcadas según los permisos actuales", async () => {
    const u = userEvent.setup();
    setup();
    await u.click(screen.getByRole("button", { name: /Permisos por módulo \(2\)/ }));
    expect(screen.getByText("Asociados y sociedades")).toBeTruthy();
    expect(screen.getByText("Pagos")).toBeTruthy();
    expect((screen.getByLabelText("Ver asociados") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Crear asociados") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Reversar pagos") as HTMLInputElement).checked).toBe(false);
  });

  it("al marcar acciones y 'Todo' de un módulo, guarda la lista final de permisos", async () => {
    const u = userEvent.setup();
    setup();
    await u.click(screen.getByRole("button", { name: /Permisos por módulo/ }));
    const save = screen.getByRole("button", { name: "Guardar permisos" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // sin cambios
    await u.click(screen.getByLabelText("Reversar pagos"));
    await u.click(screen.getAllByRole("button", { name: "Todo" })[0]!); // módulo Asociados
    await u.click(save);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect((puts[0] as { permissions: string[] }).permissions.sort()).toEqual(
      ["associates:create", "associates:read", "payments:reverse", "payments:write"].sort()
    );
  });

  it("'Ninguno' desmarca todo el módulo", async () => {
    const u = userEvent.setup();
    setup();
    await u.click(screen.getByRole("button", { name: /Permisos por módulo/ }));
    await u.click(screen.getAllByRole("button", { name: "Ninguno" })[1]!); // módulo Pagos
    expect((screen.getByLabelText("Registrar pagos") as HTMLInputElement).checked).toBe(false);
  });
});
