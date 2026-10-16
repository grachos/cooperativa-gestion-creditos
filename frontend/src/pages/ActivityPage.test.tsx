import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActivityPage from "./ActivityPage";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
let urls: string[];

beforeEach(() => {
  localStorage.setItem("accessToken", "tok");
  urls = [];
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    urls.push(String(url));
    if (String(url).includes("/audit/filters")) return Promise.resolve(json({ actions: ["APPROVE"], entities: ["credit"], users: [{ id: 3, full_name: "Jorge" }] }));
    return Promise.resolve(json({
      total: 1,
      data: [{
        id: 1, created_at: "2026-10-16 15:00:00", user_name: "Jorge", entity: "credit_adjustment", entity_id: "9", action: "CREATE",
        reason: "Pidió rebaja", summary: "Dio un descuento de $ 25.000", entity_label: "Ajuste #9 del crédito CR-2026-00001", link: "/creditos/5",
        old_value: null, new_value: { type: "DESCUENTO", amount: 25000 }
      }]
    }));
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(path = "/actividad") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><ActivityPage /></MemoryRouter></QueryClientProvider>);
}

describe("ActivityPage", () => {
  it("muestra quién hizo qué, con el motivo y un enlace al crédito", async () => {
    setup();
    await screen.findByText("Dio un descuento de $ 25.000");
    expect(screen.getByText("Jorge", { selector: "td" })).toBeTruthy();
    expect(screen.getByText(/Motivo: Pidió rebaja/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /CR-2026-00001/ });
    expect(link.getAttribute("href")).toBe("/creditos/5");
  });

  it("un filtro rápido pide al servidor solo esas acciones", async () => {
    const u = userEvent.setup();
    setup();
    await screen.findByText("Dio un descuento de $ 25.000");
    await u.click(screen.getByRole("button", { name: "Quién aprobó o rechazó" }));
    await waitFor(() => expect(urls.some((x) => x.includes("action=APPROVE%2CREJECT"))).toBe(true));
  });

  it("abre filtrado por crédito cuando llega desde el historial del crédito", async () => {
    setup("/actividad?credit=CR-2026-00001");
    await waitFor(() => expect(urls.some((x) => x.includes("/audit?") && x.includes("credit=CR-2026-00001"))).toBe(true));
  });
});
