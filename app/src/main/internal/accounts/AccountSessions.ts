import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type {
  AccountGameLaunchPayload,
  AccountGameLaunchIntent,
  AccountGameSession,
  AccountGameSessionReport,
  AccountScriptReference,
  ManagedAccount,
} from "@lucent/core/accounts";

export interface PendingAccountLaunch {
  readonly account: ManagedAccount;
  readonly requestedAt: number;
  readonly script?: AccountScriptReference;
  readonly server?: string;
}

export interface AccountSessionRegistry {
  readonly getLaunch: (gameWindowId: number) => AccountGameLaunchPayload | null;
  readonly remove: (gameWindowId: number) => boolean;
  readonly snapshot: () => readonly AccountGameSession[];
  readonly trackLaunch: (
    gameWindowId: number,
    rendererGeneration: number,
    gameWindowGroupId: number | undefined,
    pending: PendingAccountLaunch,
  ) => void;
  readonly ensureDirect: (
    gameWindowId: number,
    rendererGeneration: number,
    gameWindowGroupId: number | undefined,
  ) => boolean;
  readonly reload: (
    gameWindowId: number,
    rendererGeneration: number,
  ) => boolean;
  readonly acceptReport: (
    gameWindowId: number,
    report: AccountGameSessionReport,
    gameWindowGroupId: number | undefined,
  ) => boolean;
}

const launchIntent = (
  pending: PendingAccountLaunch,
): AccountGameLaunchIntent => ({
  username: pending.account.username,
  ...(pending.script === undefined ? {} : { script: pending.script }),
  ...(pending.server === undefined ? {} : { server: pending.server }),
  requestedAt: pending.requestedAt,
});

const launchPayload = (
  gameWindowId: number,
  pending: PendingAccountLaunch,
): AccountGameLaunchPayload => ({
  account: pending.account,
  ...(pending.script === undefined ? {} : { script: pending.script }),
  ...(pending.server === undefined ? {} : { server: pending.server }),
  gameWindowId,
  requestedAt: pending.requestedAt,
});

const initialRuntime = (launch: AccountGameLaunchIntent | undefined) => ({
  connection: { state: "offline" as const },
  login: {
    state:
      launch === undefined ? ("idle" as const) : ("waiting-for-game" as const),
  },
  script: { state: "idle" as const },
});

/**
 * Owns accepted renderer reports and enforces the generation/revision barriers.
 * This object is intentionally synchronous so its causal rules are easy to test.
 */
export const makeAccountSessionRegistry = (
  now: () => number = Date.now,
): AccountSessionRegistry => {
  const sessions = new Map<number, AccountGameSession>();
  const launchPayloads = new Map<number, AccountGameLaunchPayload>();

  const snapshot: AccountSessionRegistry["snapshot"] = () =>
    [...sessions.values()].toSorted(
      (left, right) => right.updatedAt - left.updatedAt,
    );

  const trackLaunch: AccountSessionRegistry["trackLaunch"] = (
    gameWindowId,
    rendererGeneration,
    gameWindowGroupId,
    pending,
  ) => {
    const payload = launchPayload(gameWindowId, pending);
    const launch = launchIntent(pending);
    launchPayloads.set(gameWindowId, payload);
    sessions.set(gameWindowId, {
      gameWindowId,
      ...(gameWindowGroupId === undefined ? {} : { gameWindowGroupId }),
      rendererGeneration,
      revision: 0,
      launch,
      ...initialRuntime(launch),
      updatedAt: now(),
    });
  };

  const ensureDirect: AccountSessionRegistry["ensureDirect"] = (
    gameWindowId,
    rendererGeneration,
    gameWindowGroupId,
  ) => {
    if (sessions.has(gameWindowId)) return false;
    sessions.set(gameWindowId, {
      gameWindowId,
      ...(gameWindowGroupId === undefined ? {} : { gameWindowGroupId }),
      rendererGeneration,
      revision: 0,
      ...initialRuntime(undefined),
      updatedAt: now(),
    });
    return true;
  };

  const reload: AccountSessionRegistry["reload"] = (
    gameWindowId,
    rendererGeneration,
  ) => {
    const previous = sessions.get(gameWindowId);
    if (previous === undefined) return false;
    const runtime = initialRuntime(previous.launch);
    sessions.set(gameWindowId, {
      ...previous,
      rendererGeneration,
      revision: 0,
      ...runtime,
      updatedAt: now(),
    });
    return true;
  };

  const acceptReport: AccountSessionRegistry["acceptReport"] = (
    gameWindowId,
    report,
    gameWindowGroupId,
  ) => {
    const previous = sessions.get(gameWindowId);
    if (
      previous === undefined ||
      previous.rendererGeneration !== report.rendererGeneration ||
      report.revision <= previous.revision
    ) {
      return false;
    }

    sessions.set(gameWindowId, {
      gameWindowId,
      ...(gameWindowGroupId === undefined
        ? previous.gameWindowGroupId === undefined
          ? {}
          : { gameWindowGroupId: previous.gameWindowGroupId }
        : { gameWindowGroupId }),
      rendererGeneration: report.rendererGeneration,
      revision: report.revision,
      ...(previous.launch === undefined ? {} : { launch: previous.launch }),
      connection: report.connection,
      login: report.login,
      script: report.script,
      updatedAt: now(),
    });
    return true;
  };

  return {
    acceptReport,
    ensureDirect,
    getLaunch: (gameWindowId) => launchPayloads.get(gameWindowId) ?? null,
    reload,
    remove: (gameWindowId) => {
      const removedSession = sessions.delete(gameWindowId);
      const removedLaunch = launchPayloads.delete(gameWindowId);
      return removedSession || removedLaunch;
    },
    snapshot,
    trackLaunch,
  };
};

export interface AccountSessionsShape extends AccountSessionRegistry {}

export class AccountSessions extends Context.Service<
  AccountSessions,
  AccountSessionsShape
>()("lucent/internal/accounts/AccountSessions") {}

export const layer = Layer.effect(
  AccountSessions,
  Effect.sync(() => AccountSessions.of(makeAccountSessionRegistry())),
);
