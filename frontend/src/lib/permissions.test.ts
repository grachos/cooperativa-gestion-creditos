import { describe, expect, it } from "vitest";
import { permissionLabel } from "./permissions";
import { formatDateTime } from "./format";

describe("permissionLabel", () => {
  it("usa el nombre en español y cae a la descripción o al código", () => {
    expect(permissionLabel("applications:review")).toMatch(/Revisar solicitudes/);
    expect(permissionLabel("nuevo:permiso", "Algo nuevo")).toBe("Algo nuevo");
    expect(permissionLabel("nuevo:permiso")).toBe("nuevo:permiso");
  });
});

describe("formatDateTime", () => {
  it("interpreta la marca del servidor como UTC y la muestra en hora de Colombia (UTC-5)", () => {
    expect(formatDateTime("2026-10-16 15:30:00")).toMatch(/10:30/);
    expect(formatDateTime(null)).toBe("—");
  });
});
