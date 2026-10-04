import type { StorybookConfig } from "@storybook/react-vite";

const config = {
  addons: [
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-themes",
  ],
  core: {
    disableTelemetry: true,
  },
  features: {
    experimentalCodeExamples: false,
  },
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  stories: ["../src/**/*.mdx", "../src/**/*.stories.tsx"],
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    build: { ...viteConfig.build, lib: false },
  }),
} satisfies StorybookConfig;

export default config;
