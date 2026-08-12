import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "storybook-solidjs-vite";
import { mergeConfig } from "vite";

const gameSource = fileURLToPath(
  new URL("../packages/game/src/index.ts", import.meta.url),
);

const config = {
  addons: ["@storybook/addon-themes"],
  features: {
    experimentalCodeExamples: false,
    viewport: true,
  },
  framework: {
    name: "storybook-solidjs-vite",
    options: {
      docgen: false,
    },
  },
  stories: ["../app/src/renderer/**/*.stories.@(ts|tsx)"],
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      resolve: {
        // @lucent/game intentionally ships CommonJS for Electron scripting.
        // Storybook needs its ESM source for named exports and live updates.
        alias: { "@lucent/game": gameSource },
      },
    }),
} satisfies StorybookConfig;

export default config;
