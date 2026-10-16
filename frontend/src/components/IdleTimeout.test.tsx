import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdleTimeout } from "./IdleTimeout";

const logout = vi.fn().mockResolvedValue(undefined);
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ logout }) }));
vi.mock("../lib/api", () => ({ api: { get: vi.fn().mockResolvedValue({}) } }));

beforeEach(() => {
  localStorage.clear();
  logout.mockClear();
});

describe("IdleTimeout al abrir la aplicación", () => {
  it("cierra la sesión si la última actividad fue hace días", async () => {
    localStorage.setItem("lastActivityAt", String(Date.now() - 5 * 24 * 3600 * 1000));
    render(<MemoryRouter><IdleTimeout /></MemoryRouter>);
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });

  it("no cierra la sesión si la actividad es reciente", async () => {
    localStorage.setItem("lastActivityAt", String(Date.now() - 60_000));
    render(<MemoryRouter><IdleTimeout /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 50));
    expect(logout).not.toHaveBeenCalled();
  });
});
