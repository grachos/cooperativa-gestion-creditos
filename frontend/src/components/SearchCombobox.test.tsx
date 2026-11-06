import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { SearchCombobox, type ComboOption } from "./SearchCombobox";

const people: ComboOption[] = [
  { id: 1, label: "OMAR ALEXIS BLANCO DURAN", detail: "CC 1001" },
  { id: 2, label: "JUAN MANUEL LIÑAN GARCIA", detail: "CC 1002" },
  { id: 3, label: "ALEXANDRA REYES PINTO", detail: "CC 1003" }
];

function Harness({ search, excludeIds }: { search: (q: string) => Promise<ComboOption[]>; excludeIds?: string[] }) {
  const [value, setValue] = useState("");
  return (
    <>
      <SearchCombobox value={value} onChange={setValue} search={search} placeholder="Buscar" excludeIds={excludeIds} />
      <output data-testid="value">{value}</output>
    </>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function flush(ms = 300) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("SearchCombobox", () => {
  it("al abrir lista opciones, filtra al escribir (en el servidor) y elige con el mouse", async () => {
    const search = vi.fn(async (q: string) => people.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())));
    render(<Harness search={search} />);
    const input = screen.getByRole("combobox");

    fireEvent.focus(input);
    await flush();
    expect(screen.getAllByRole("option")).toHaveLength(3);

    fireEvent.change(input, { target: { value: "alexandra" } });
    await flush();
    expect(search).toHaveBeenLastCalledWith("alexandra");
    expect(screen.getAllByRole("option")).toHaveLength(1);

    fireEvent.mouseDown(screen.getByRole("option"));
    expect(screen.getByTestId("value").textContent).toBe("3");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((input as HTMLInputElement).value).toBe("ALEXANDRA REYES PINTO");
  });

  it("se navega con flechas y Enter sin enviar el formulario, y Escape cierra", async () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Harness search={async () => people} />
      </form>
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    await flush();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("value").textContent).toBe("2");
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.focus(input);
    await flush();
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("no ofrece los ids excluidos y avisa cuando no hay resultados", async () => {
    render(<Harness search={async (q) => (q === "zzz" ? [] : people)} excludeIds={["1"]} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    await flush();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).not.toContain("OMAR ALEXIS BLANCO DURANCC 1001");
    expect(screen.getAllByRole("option")).toHaveLength(2);

    fireEvent.change(input, { target: { value: "zzz" } });
    await flush();
    expect(screen.getByText("Sin resultados")).toBeTruthy();
  });

  it("escribir de nuevo descarta la selección anterior", async () => {
    render(<Harness search={async () => people} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    await flush();
    fireEvent.mouseDown(screen.getAllByRole("option")[0]!);
    expect(screen.getByTestId("value").textContent).toBe("1");
    fireEvent.change(input, { target: { value: "x" } });
    expect(screen.getByTestId("value").textContent).toBe("");
  });
});
