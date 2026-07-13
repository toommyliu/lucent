import { Context, Effect, Layer } from "effect";

import type {
  AccountGameLaunchPayload,
  AccountScriptSession,
  AccountScriptStatusUpdate,
  ManagedAccount,
  ScriptExecutePayload,
} from "@lucent/core/accounts";

export interface PendingAccountLaunch {
  readonly account: ManagedAccount;
  readonly requestedAt: number;
  readonly script?: ScriptExecutePayload;
  readonly server?: string;
}

const scriptName = (
  script: ScriptExecutePayload | null | undefined,
): string | undefined => {
  const name = script?.name?.trim();
  if (name !== undefined && name !== "") return name;
  const path = script?.path?.trim();
  return path === undefined || path === "" ? undefined : path;
};

export interface AccountSessionsShape {
  readonly getLaunch: (gameWindowId: number) => AccountGameLaunchPayload | null;
  readonly remove: (gameWindowId: number) => boolean;
  readonly snapshot: () => readonly AccountScriptSession[];
  readonly trackLaunch: (
    gameWindowId: number,
    pending: PendingAccountLaunch,
  ) => void;
  readonly updateStatus: (
    gameWindowId: number,
    update: AccountScriptStatusUpdate,
  ) => void;
}

export class AccountSessions extends Context.Service<
  AccountSessions,
  AccountSessionsShape
>()("lucent/internal/accounts/AccountSessions") {}

export const layer = Layer.effect(
  AccountSessions,
  Effect.sync(() => {
    const sessions = new Map<number, AccountScriptSession>();
    const launchPayloads = new Map<number, AccountGameLaunchPayload>();

    const getLaunch: AccountSessionsShape["getLaunch"] = (gameWindowId) =>
      launchPayloads.get(gameWindowId) ?? null;

    const remove: AccountSessionsShape["remove"] = (gameWindowId) => {
      const removedSession = sessions.delete(gameWindowId);
      const removedLaunch = launchPayloads.delete(gameWindowId);
      return removedSession || removedLaunch;
    };

    const snapshot: AccountSessionsShape["snapshot"] = () =>
      [...sessions.values()].toSorted(
        (left, right) => right.updatedAt - left.updatedAt,
      );

    const trackLaunch: AccountSessionsShape["trackLaunch"] = (
      gameWindowId,
      pending,
    ) => {
      const payload: AccountGameLaunchPayload = {
        account: pending.account,
        ...(pending.script === undefined ? {} : { script: pending.script }),
        ...(pending.server === undefined ? {} : { server: pending.server }),
        gameWindowId,
        requestedAt: pending.requestedAt,
      };
      launchPayloads.set(gameWindowId, payload);
      const pendingScriptName = scriptName(payload.script);
      sessions.set(gameWindowId, {
        gameWindowId,
        launchUsername: payload.account.username,
        currentUsername: payload.account.username,
        ...(pendingScriptName === undefined
          ? {}
          : { scriptName: pendingScriptName }),
        status: "starting",
        message: "Waiting...",
        updatedAt: Date.now(),
      });
    };

    const updateStatus: AccountSessionsShape["updateStatus"] = (
      gameWindowId,
      update,
    ) => {
      const previous = sessions.get(gameWindowId);
      const payload = launchPayloads.get(gameWindowId);
      const payloadScriptName = scriptName(payload?.script);
      const updateScriptName =
        update.scriptName === undefined
          ? undefined
          : scriptName({ source: "", name: update.scriptName });
      sessions.set(gameWindowId, {
        gameWindowId,
        ...(payload === undefined
          ? {}
          : { launchUsername: payload.account.username }),
        ...(previous?.launchUsername === undefined
          ? {}
          : { launchUsername: previous.launchUsername }),
        ...(update.currentUsername === undefined
          ? previous?.currentUsername === undefined
            ? {}
            : { currentUsername: previous.currentUsername }
          : { currentUsername: update.currentUsername }),
        ...(update.scriptName === undefined
          ? previous?.scriptName === undefined
            ? payloadScriptName === undefined
              ? {}
              : { scriptName: payloadScriptName }
            : { scriptName: previous.scriptName }
          : updateScriptName === undefined
            ? {}
            : { scriptName: updateScriptName }),
        status: update.status,
        ...(update.message === undefined ? {} : { message: update.message }),
        updatedAt: Date.now(),
      });
    };

    return AccountSessions.of({
      getLaunch,
      remove,
      snapshot,
      trackLaunch,
      updateStatus,
    });
  }),
);
