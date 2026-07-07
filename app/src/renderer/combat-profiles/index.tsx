import "../../shared/polyfills";

import { render } from "solid-js/web";

import { installRendererThemeSync } from "../theme";
import { App } from "./App";

const themeSync = installRendererThemeSync();
const root = document.getElementById("root");

if (root !== null) {
  render(() => <App />, root);
}

document.documentElement.dataset["ready"] = "true";

window.addEventListener(
  "beforeunload",
  () => {
    themeSync.dispose();
  },
  { once: true },
);
