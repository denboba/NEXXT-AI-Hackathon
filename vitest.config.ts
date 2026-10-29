import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,mjs}"],
    // tests/core uses node:test (run with `npm run test:core`), not vitest.
    exclude: ["tests/core/**", "tests/e2e/**", "node_modules/**"],
    environment: "node",
  },
});
