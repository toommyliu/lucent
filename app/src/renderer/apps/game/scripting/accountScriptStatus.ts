import type {
  AccountGameLaunchPayload,
  AccountGameScriptState,
} from "@lucent/core/accounts";
import type { ScriptRunnerStatus } from "./ScriptRunner";

export const accountScriptLabel = (
  script: AccountGameLaunchPayload["script"] | undefined,
): string | undefined => script?.name ?? script?.path;

/** Converts runner state into the renderer-owned script state. */
export const accountScriptRunnerState = (
  status: ScriptRunnerStatus,
  launchPayload: AccountGameLaunchPayload | null,
  previousScriptName?: string,
): AccountGameScriptState => {
  const name =
    "name" in status
      ? status.name
      : (previousScriptName ?? accountScriptLabel(launchPayload?.script));
  switch (status.state) {
    case "starting":
    case "waiting-to-restart":
      return {
        state: "starting",
        ...(name === undefined ? {} : { name }),
        ...(status.state === "waiting-to-restart"
          ? { message: "Waiting to restart" }
          : {}),
      };
    case "running":
    case "stopping":
      return { state: "running", ...(name === undefined ? {} : { name }) };
    case "failed":
      return {
        state: "failed",
        ...(name === undefined ? {} : { name }),
        message: status.message,
      };
    case "stopped":
      return {
        state: "stopped",
        ...(name === undefined ? {} : { name }),
        ...(status.reason === undefined ? {} : { reason: status.reason }),
      };
    case "completed":
      return {
        state: "stopped",
        ...(name === undefined ? {} : { name }),
        reason: "Completed",
      };
    case "idle":
      return { state: "idle" };
  }
};
