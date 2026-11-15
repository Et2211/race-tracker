import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    // Logic tests only for now. Component tests will add a jsdom project.
    environment: "node",
    include: ["**/*.test.ts"],
    // Some tests replay whole recorded sessions.
    testTimeout: 20_000,
    exclude: ["node_modules/**", ".next/**"],
  },
});
