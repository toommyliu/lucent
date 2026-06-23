/* @refresh reload */
import {
  markGameStartup,
  writeGameStartupTiming,
  writeGameStartupTimingOnce,
} from "./startupTelemetry";
import "../../polyfills";
import "./entrypoint";
import "./style.css";
import { installGameConsoleObservabilityBridge } from "./consoleObservabilityBridge";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly NODE_ENV?: string;
    }
  }
}

markGameStartup("game-entry-module-evaluated");
markGameStartup("app-module-import-start");

if (process.env.NODE_ENV === "development") {
  installGameConsoleObservabilityBridge(window.desktop.observability, console);
}

void import("./App")
  .then(() => {
    markGameStartup("app-module-imported");
    writeGameStartupTiming("Game app module imported");
  })
  .catch((error: unknown) => {
    console.error("Failed to import game app module:", error);
    writeGameStartupTimingOnce(
      "app-module-import-failed",
      "Game app import failed",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  });
