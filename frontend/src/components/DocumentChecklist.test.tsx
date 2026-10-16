import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentChecklist } from "./DocumentChecklist";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let puts: unknown[];

beforeEach(() => {
  localStorage.setItem("accessToken", "tok");
  puts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        puts.push(JSON.parse(String(init.body)));
        return Promise.resolve(json(200, {}));
      }
      return Promise.resolve(
        json(200, {
          data: [
            { document_type: "Cédula", held: true, notes: null, checked_by_name: "Diana", checked_at: "2026-10-16 15:00:00" },
            { document_type: "Pagaré", held: false, notes: null, checked_by_name: null, checked_at: null }
          ]
        })
      );
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(canEdit: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DocumentChecklist title="Documentos" path="/associates/1/documents" canEdit={canEdit} />
    </QueryClientProvider>
  );
}

describe("DocumentChecklist", () => {
  it("muestra cuántos documentos se tienen y quién los marcó", async () => {
    setup(true);
    await screen.findByText("Cédula");
    expect(screen.getByText(/1 de 2 documentos/)).toBeTruthy();
    expect(screen.getByText(/Marcó: Diana/)).toBeTruthy();
    expect(screen.getByText("Lo tenemos")).toBeTruthy();
    expect(screen.getByText("No lo tenemos")).toBeTruthy();
  });

  it("al marcar una casilla envía el documento y el nuevo estado", async () => {
    const user = userEvent.setup();
    setup(true);
    await screen.findByText("Pagaré");
    await user.click(screen.getByLabelText("Pagaré"));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ documentType: "Pagaré", held: true });
  });

  it("sin permiso las casillas están deshabilitadas", async () => {
    setup(false);
    await screen.findByText("Pagaré");
    expect((screen.getByLabelText("Pagaré") as HTMLInputElement).disabled).toBe(true);
  });
});
