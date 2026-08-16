import type {
  AccountScriptReference,
  AccountSessionScript,
} from "@lucent/core/accounts";
import type { ScriptRunnerStatus } from "./ScriptRunner";

export const accountScriptLabel = (
  script: AccountScriptReference | undefined,
): string | undefined => script?.name ?? script?.path;

/** Projects script-runner state without granting it ownership of account identity. */
export const accountSessionScriptState = (
  status: ScriptRunnerStatus,
  fallbackName?: string,
): AccountSessionScript => {
  switch (status.state) {
    case "idle":
      return fallbackName === undefined
        ? { state: "idle" }
        : { name: fallbackName, state: "idle" };
    case "starting":
      return { name: status.name, state: "starting" };
    case "waiting-to-restart":
      return {
        message: "Waiting to restart",
        name: status.name,
        state: "starting",
      };
    case "running":
    case "stopping":
      return { name: status.name, state: "running" };
    case "failed":
      return {
        message: status.message,
        name: status.name,
        state: "failed",
      };
    case "completed":
      return {
        message: "Completed",
        name: status.name,
        state: "stopped",
      };
    case "stopped":
      return {
        ...(fallbackName === undefined ? {} : { name: fallbackName }),
        ...(status.reason === undefined ? {} : { message: status.reason }),
        state: "stopped",
      };
  }
};
