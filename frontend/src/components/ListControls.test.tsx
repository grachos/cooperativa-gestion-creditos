import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Pagination } from "./ListControls";

afterEach(cleanup);

describe("Pagination", () => {
  it("no se muestra si todo cabe en una página", () => {
    const { container } = render(<Pagination page={1} pageSize={20} total={20} onPage={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("muestra la página actual y permite avanzar/retroceder sin salirse de los límites", () => {
    const onPage = vi.fn();
    render(<Pagination page={1} pageSize={20} total={45} onPage={onPage} />);
    expect(screen.getByText(/Página 1 de 3 · 45 registros/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Anterior" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(onPage).toHaveBeenCalledWith(2);
    cleanup();
    render(<Pagination page={3} pageSize={20} total={45} onPage={onPage} />);
    expect((screen.getByRole("button", { name: "Siguiente" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
