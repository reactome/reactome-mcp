import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
      // Transport wiring and the server entrypoint are exercised by the live
      // smoke sweep, not by unit tests; counting them here would report
      // coverage this suite does not actually have.
      exclude: ["src/index.ts", "src/types/**"],
      // A ratchet, not a target. Raise these as tool coverage grows -- most
      // tools still have no test, which is how a token-parsing bug and nine
      // wrong field paths all shipped unnoticed.
      thresholds: {
        lines: 52,
        functions: 48,
        branches: 45,
        statements: 53,
      },
    },
  },
});
