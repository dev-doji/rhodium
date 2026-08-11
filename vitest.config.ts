import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    env: { LOG_LEVEL: "silent" },
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
