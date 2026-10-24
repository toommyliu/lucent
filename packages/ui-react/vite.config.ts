import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import runtimeTargets from "../../app/runtime-targets.json";
import packageJson from "./package.json";
import { cssModuleTypes } from "./scripts/cssModuleTypes";

const external = [
  ...Object.keys(packageJson.dependencies),
  ...Object.keys(packageJson.peerDependencies),
];

const isExternal = (id: string): boolean =>
  external.some((name) => id === name || id.startsWith(`${name}/`));

export default defineConfig({
  build: {
    lib: {
      cssFileName: "styles",
      entry: resolve(import.meta.dirname, "src/entry.ts"),
      fileName: "index",
      formats: ["es"],
    },
    minify: false,
    rollupOptions: {
      external: isExternal,
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "entry" ? "index.js" : "[name].js",
        preserveModules: true,
        preserveModulesRoot: "src",
      },
    },
    sourcemap: true,
    target: `chrome${runtimeTargets.chrome}`,
  },
  css: {
    lightningcss: {
      cssModules: { pattern: "[name]_[local]_[hash]" },
      targets: { chrome: Number(runtimeTargets.chrome) << 16 },
    },
    transformer: "lightningcss",
  },
  plugins: [cssModuleTypes(resolve(import.meta.dirname, "src")), react()],
});
