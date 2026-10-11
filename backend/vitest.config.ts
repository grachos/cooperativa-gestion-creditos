import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 15000,
    // Secretos ficticios solo para que config/env.ts valide al importar el pool.
    env: {
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "test-access-secret-xx",
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-xx"
    }
  }
});
