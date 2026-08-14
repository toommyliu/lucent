import type {
  AccountGameLaunchPayload,
  AccountScriptReference,
  AccountScriptStatusUpdate,
} from "@lucent/core/accounts";
import type { ScriptRunnerStatus } from "./ScriptRunner";

export const accountScriptLabel = (
  script: AccountScriptReference | undefined,
): string | undefined => script?.name ?? script?.path;

/** Builds an Account Manager update for any authenticated game session. */
export const accountScriptRunnerStatusUpdate = (
  status: ScriptRunnerStatus,
  authenticatedUsername: string | undefined,
  launchPayload: AccountGameLaunchPayload | null,
): AccountScriptStatusUpdate | null => {
  const currentUsername =
    authenticatedUsername ?? launchPayload?.account.username;
  if (currentUsername === undefined) {
    return null;
  }

  const scriptName =
    "name" in status ? status.name : accountScriptLabel(launchPayload?.script);
  return {
    currentUsername,
    ...(scriptName === undefined ? {} : { scriptName }),
    status:
      status.state === "starting"
        ? "starting"
        : status.state === "waiting-to-restart"
          ? "starting"
          : status.state === "running" || status.state === "stopping"
            ? "running"
            : status.state === "failed"
              ? "failed"
              : status.state === "idle"
                ? "idle"
                : "stopped",
    ...(status.state === "failed"
      ? { message: status.message }
      : status.state === "waiting-to-restart"
        ? { message: "Waiting to restart" }
        : status.state === "stopped"
          ? { message: status.reason ?? "Stopped" }
          : status.state === "completed"
            ? { message: "Completed" }
            : {}),
  };
};
