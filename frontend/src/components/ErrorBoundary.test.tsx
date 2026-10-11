import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

afterEach(cleanup);

function Boom(): never {
  throw new Error("fallo de prueba");
}

describe("ErrorBoundary", () => {
  it("muestra el mensaje y un botón de recarga en lugar de una pantalla en blanco", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("fallo de prueba")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recargar la aplicación" })).toBeTruthy();
  });

  it("no interfiere cuando no hay errores", () => {
    render(
      <ErrorBoundary>
        <p>contenido normal</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("contenido normal")).toBeTruthy();
  });
});
