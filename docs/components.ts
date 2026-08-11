import { defineComponents } from "blume";

import EnhancementLabels from "./components/EnhancementLabels.astro";

export default defineComponents({
  layout: {
    Header: "./components/Header.astro",
    PageFooter: "./components/DocsController.astro",
    Search: "./components/Search.astro",
    TableOfContents: "./components/TableOfContents.astro",
  },
  mdx: {
    EnhancementLabels,
  },
});
