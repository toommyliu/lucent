import { markGameLoaded, setGameLoadProgress } from "./loadState";
import {
  markGameStartup,
  writeGameStartupTimingOnce,
} from "./startupTelemetry";

markGameStartup("entrypoint-module-evaluated");

const progressMilestones = new Set<number>();

const gameLoadProgressMilestone = (percent: number): number => {
  if (percent >= 100) {
    return 100;
  }

  if (percent >= 75) {
    return 75;
  }

  if (percent >= 50) {
    return 50;
  }

  return percent > 0 ? 1 : 0;
};

window.onDebug = (message: string) => {
  console.debug("%c debug:: ", "color:#7b8cde;font-size:11px;", message);
};

window.onProgress = (percent: number) => {
  setGameLoadProgress(percent);
  const milestone = gameLoadProgressMilestone(percent);
  if (milestone > 0 && !progressMilestones.has(milestone)) {
    progressMilestones.add(milestone);
    writeGameStartupTimingOnce(
      `swf-progress-${milestone}`,
      "Game SWF load progress",
      { progress: milestone },
    );
  }
};

window.onLoaded = () => {
  markGameStartup("swf-loaded");
  markGameLoaded();
  writeGameStartupTimingOnce("swf-loaded", "Game SWF loaded");
  void import("./Runtime")
    .then(({ keepGameRuntimeAlive }) => {
      keepGameRuntimeAlive();
    })
    .catch((error: unknown) => {
      console.error("Failed to keep game runtime alive:", error);
      writeGameStartupTimingOnce(
        "runtime-keepalive-failed",
        "Game runtime keepalive failed",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    });
};
