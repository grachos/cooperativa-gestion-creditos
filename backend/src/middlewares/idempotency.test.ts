import { describe, expect, it } from "vitest";
import { canonicalJson, MemoryIdempotencyStore } from "./idempotency.js";
import { defineIdempotencySuite } from "./idempotency.suite.js";

let clock = 1_000_000;
defineIdempotencySuite(
  "memoria",
  async () => {
    clock = 1_000_000;
    const store = new MemoryIdempotencyStore(() => clock);
    return {
      store,
      expireAll: async () => {
        clock += 3601 * 1000; // ttlSeconds de la suite = 3600
      }
    };
  },
  [1, 2]
);

describe("canonicalJson", () => {
  it("no depende del orden de las llaves", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe(
      canonicalJson({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 })
    );
  });
  it("distingue valores distintos", () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: "1" }));
  });
});
