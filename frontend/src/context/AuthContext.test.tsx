import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn().mockRejectedValue(new Error("sin sesión")),
    post: vi.fn(async (path: string) =>
      path === "/auth/login"
        ? { accessToken: "a", refreshToken: "r", user: { id: 1, email: "x", fullName: "X", roles: [], permissions: [] } }
        : {}
    )
  }
}));

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

beforeEach(() => localStorage.clear());

describe("AuthContext y la marca de actividad", () => {
  it("login reemplaza una marca de actividad vieja (si no, IdleTimeout expulsa al instante)", async () => {
    localStorage.setItem("lastActivityAt", String(Date.now() - 5 * 24 * 3600 * 1000));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(() => result.current.login("admin", "x"));
    expect(Date.now() - Number(localStorage.getItem("lastActivityAt"))).toBeLessThan(5000);
  });

  it("logout borra la marca de actividad", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(() => result.current.login("admin", "x"));
    await act(() => result.current.logout());
    expect(localStorage.getItem("lastActivityAt")).toBeNull();
  });
});
