import type { AccountScriptStatus } from "../../../../shared/ipc";

export interface ScriptRunnerStatus {
  readonly status: AccountScriptStatus;
  readonly scriptName?: string;
  readonly message?: string;
  readonly updatedAt: number;
}

export interface ScriptRunnerStatusState {
  readonly token: number;
  readonly status: ScriptRunnerStatus;
}

export interface ScriptRunnerStatusEvent {
  readonly token: number;
  readonly status: Exclude<AccountScriptStatus, "idle">;
  readonly scriptName: string;
  readonly message?: string;
}

export const initialScriptRunnerStatusState = (
  updatedAt = Date.now(),
): ScriptRunnerStatusState => ({
  token: 0,
  status: {
    status: "idle",
    message: "No script loaded",
    updatedAt,
  },
});

const defaultStatusMessage = (
  status: Exclude<AccountScriptStatus, "idle">,
  scriptName: string,
): string => {
  switch (status) {
    case "starting":
      return `Starting ${scriptName}`;
    case "running":
      return `Running ${scriptName}`;
    case "stopped":
      return `Stopped ${scriptName}`;
    case "failed":
      return `Failed ${scriptName}`;
  }
};

export const reduceScriptRunnerStatus = (
  state: ScriptRunnerStatusState,
  event: ScriptRunnerStatusEvent,
  updatedAt = Date.now(),
): ScriptRunnerStatusState => {
  const isFreshLaunchFailure =
    event.status === "failed" && event.token > state.token;

  if (
    event.status !== "starting" &&
    event.token !== state.token &&
    !isFreshLaunchFailure
  ) {
    return state;
  }

  if (event.status === "starting" && event.token < state.token) {
    return state;
  }

  return {
    token: event.token,
    status: {
      status: event.status,
      scriptName: event.scriptName,
      message:
        event.message ?? defaultStatusMessage(event.status, event.scriptName),
      updatedAt,
    },
  };
};

export const scriptRunnerStatusEquals = (
  left: ScriptRunnerStatus,
  right: ScriptRunnerStatus,
): boolean =>
  left.status === right.status &&
  left.scriptName === right.scriptName &&
  left.message === right.message;
