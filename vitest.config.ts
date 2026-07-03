import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "node_modules/**",
      "dist/**",
      "snake-game/**",
      "snake-server/**",
      "screenshots/**",
      "**/*.spec.js",
      "**/*.spec.ts",
    ],
  },
});
