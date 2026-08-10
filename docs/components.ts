import { defineComponents } from "blume";

export default defineComponents({
  layout: {
    Header: "./components/Header.astro",
    PageFooter: "./components/DocsController.astro",
    Search: "./components/Search.astro",
    TableOfContents: "./components/TableOfContents.astro",
  },
});
