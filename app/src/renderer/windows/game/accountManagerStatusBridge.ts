import type {
  AccountGameLaunchPayload,
  AccountScriptStatusUpdate,
} from "../../../shared/ipc";
import type { ScriptRunnerStatus } from "./scripting/scriptRunnerStatus";

export interface AccountManagerStatusPublisherDependencies {
  readonly getLaunchPayload: () => AccountGameLaunchPayload | null;
  readonly getCurrentUsername: () => Promise<string>;
  readonly publish: (update: AccountScriptStatusUpdate) => Promise<void>;
}

export interface AccountManagerStatusPublisher {
  readonly publishStatus: (status: ScriptRunnerStatus) => Promise<boolean>;
  readonly reset: () => void;
}

const optionalText = (value: string | undefined): string | undefined => {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? undefined : normalized;
};

export const toAccountScriptStatusUpdate = (
  status: ScriptRunnerStatus,
  currentUsername: string,
): AccountScriptStatusUpdate => {
  const username = optionalText(currentUsername);
  const scriptName = optionalText(status.scriptName);
  const message = optionalText(status.message);

  return {
    status: status.status,
    ...(username === undefined ? {} : { currentUsername: username }),
    ...(scriptName === undefined ? {} : { scriptName }),
    ...(message === undefined ? {} : { message }),
  };
};

export const accountScriptStatusUpdateKey = (
  update: AccountScriptStatusUpdate,
): string =>
  [
    update.status,
    update.currentUsername ?? "",
    update.scriptName ?? "",
    update.message ?? "",
  ].join("\u0000");

export const createAccountManagerStatusPublisher = (
  dependencies: AccountManagerStatusPublisherDependencies,
): AccountManagerStatusPublisher => {
  let lastUpdateKey = "";

  return {
    publishStatus: async (status) => {
      if (dependencies.getLaunchPayload() === null) {
        return false;
      }

      const currentUsername = await dependencies.getCurrentUsername();
      const update = toAccountScriptStatusUpdate(status, currentUsername);
      const key = accountScriptStatusUpdateKey(update);
      if (key === lastUpdateKey) {
        return false;
      }

      await dependencies.publish(update);
      lastUpdateKey = key;
      return true;
    },
    reset: () => {
      lastUpdateKey = "";
    },
  };
};
