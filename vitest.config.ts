import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    exclude: ["contracts/test/**", "node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      include: ["src/lib/protocol.ts"],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
      reporter: ["text", "json-summary"],
    },
  },
});
