import { describe, expect, it } from "vitest";
import { formatDateTime } from "./format";

describe("formatDateTime", () => {
  it("interpreta la marca del servidor como UTC y la muestra en hora de Colombia (UTC-5)", () => {
    expect(formatDateTime("2026-10-16 15:30:00")).toMatch(/10:30/);
    expect(formatDateTime(null)).toBe("—");
  });
});
