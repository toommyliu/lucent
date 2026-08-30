import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/*.ts", "!src/*.test.ts", "!src/*.spec.ts"],
  format: ["esm", "cjs"],
  dts: true,
  outDir: "dist",
});
