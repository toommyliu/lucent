/* @refresh reload */
import {
  markGameStartup,
  writeGameStartupTiming,
  writeGameStartupTimingOnce,
} from "./startupTelemetry";
import "../../polyfills";
import "./entrypoint";
import "./style.css";

markGameStartup("game-entry-module-evaluated");
markGameStartup("app-module-import-start");

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
