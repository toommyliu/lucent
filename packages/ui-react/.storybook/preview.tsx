import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Preview } from "@storybook/react-vite";

import "../src/styles/tokens.css";
import "../src/styles/base.css";
import "./preview.css";

import { defaultTheme, ThemedDocsContainer } from "./ThemedDocsContainer";

const preview = {
  decorators: [
    withThemeByDataAttribute({
      attributeName: "data-theme",
      defaultTheme,
      themes: {
        dark: "dark",
        light: "light",
      },
    }),
  ],
  parameters: {
    controls: {
      expanded: true,
    },
    docs: {
      container: ThemedDocsContainer,
    },
    layout: "centered",
    options: {
      storySort: {
        order: [
          "Introduction",
          "Overview",
          "Foundations",
          ["Colors", "Typography", "Elevation", "Motion", "Theming"],
          "Actions",
          "Forms",
          "Overlays",
          "Navigation",
          "Disclosure",
          "Feedback",
          "Display",
          "Examples",
        ],
      },
    },
  },
  tags: ["autodocs"],
} satisfies Preview;

export default preview;
