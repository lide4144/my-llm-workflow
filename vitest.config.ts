import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "node_modules/**",
      "dist/**",
      "snake-game/**",
      "snake-server/**",
      "screenshots/**",
      "output_projects/**",
      "**/*.spec.js",
      "**/*.spec.ts",
    ],
  },
});
