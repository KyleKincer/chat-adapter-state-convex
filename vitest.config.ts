import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true,
    typecheck: {
      tsconfig: "./tsconfig.json",
    },
  },
});
