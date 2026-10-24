import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOADING_VISIBLE_MS, SPLASH_TRANSITION_MS, SplashIntro } from "./SplashIntro";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SplashIntro después de iniciar sesión", () => {
  it("muestra el logo y el círculo de carga, avanza hasta 100 % y luego se retira", () => {
    const onDone = vi.fn();
    render(<SplashIntro showLoading onDone={onDone} />);
    expect(screen.getByAltText("Coomulnissi")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Cargando la página…");

    act(() => void vi.advanceTimersByTime(LOADING_VISIBLE_MS / 2));
    const half = Number(screen.getByRole("status").textContent?.match(/(\d+)%/)?.[1]);
    expect(half).toBeGreaterThan(30);
    expect(half).toBeLessThan(70);
    expect(onDone).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(LOADING_VISIBLE_MS / 2 + 100));
    expect(screen.getByRole("status").textContent).toContain("100%");

    act(() => void vi.advanceTimersByTime(SPLASH_TRANSITION_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("en el login no muestra el círculo", () => {
    render(<SplashIntro />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
