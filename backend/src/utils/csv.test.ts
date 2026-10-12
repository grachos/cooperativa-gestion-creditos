import { describe, expect, it } from "vitest";
import { csvRaw, csvText } from "./csv.js";

describe("csv", () => {
  it("cita campos con coma, comillas o saltos de línea", () => {
    expect(csvText("a,b")).toBe('"a,b"');
    expect(csvText('di "hola"')).toBe('"di ""hola"""');
    expect(csvText("línea1\nlínea2")).toBe('"línea1\nlínea2"');
    expect(csvText("normal")).toBe("normal");
  });
  it("neutraliza fórmulas en texto (= + - @ tab CR)", () => {
    for (const bad of ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUMA(A1)", "\tcmd", "\rcmd"]) {
      expect(csvText(bad).replace(/^"/, "")).toMatch(/^'/);
    }
    expect(csvText("=1+1")).toBe("'=1+1");
  });
  it("no altera números ni fechas (csvRaw): un monto negativo sigue siendo número", () => {
    expect(csvRaw(-1500.5)).toBe("-1500.5");
    expect(csvRaw("2026-09-10")).toBe("2026-09-10");
    expect(csvRaw(null)).toBe("");
  });
});
