import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type {
  AccountGameLaunchPayload,
  AccountGameSession,
  AccountScriptReference,
  AccountSessionReport,
  AccountSessionRuntime,
  ManagedAccount,
} from "@lucent/core/accounts";

export interface PendingAccountLaunch {
  readonly account: ManagedAccount;
  readonly requestedAt: number;
  readonly script?: AccountScriptReference;
  readonly server?: string;
}

interface TrackedSession {
  readonly launchPayload?: AccountGameLaunchPayload;
  /** Last accepted report revision for the current renderer generation. */
  readonly rendererRevision: number;
  readonly snapshot: AccountGameSession;
}

export interface AccountSessionReportResult {
  /** The replacement game-view name, when the accepted identity changed. */
  readonly windowName?: string;
}

const scriptName = (
  script: AccountScriptReference | null | undefined,
): string | undefined => {
  const name = script?.name?.trim();
  if (name !== undefined && name !== "") return name;
  const path = script?.path?.trim();
  return path === undefined || path === "" ? undefined : path;
};

const idleRuntime = (launchScriptName?: string): AccountSessionRuntime => ({
  connection: { state: "offline" },
  login: { state: "idle" },
  script:
    launchScriptName === undefined
      ? { state: "idle" }
      : { name: launchScriptName, state: "idle" },
});

const connectionUsername = (
  runtime: AccountSessionRuntime,
): string | undefined =>
  runtime.connection.state === "online"
    ? runtime.connection.username
    : undefined;

const lastConnectionUsername = (
  runtime: AccountSessionRuntime,
): string | undefined =>
  runtime.connection.state === "online"
    ? runtime.connection.username
    : runtime.connection.lastUsername;

export interface AccountSessionsShape {
  readonly applyReport: (
    gameWindowId: number,
    report: AccountSessionReport,
  ) => AccountSessionReportResult | null;
  readonly getLaunch: (gameWindowId: number) => AccountGameLaunchPayload | null;
  readonly openWindow: (
    gameWindowId: number,
    gameWindowGroupId: number | undefined,
    rendererGeneration: number,
  ) => boolean;
  readonly reloadWindow: (
    gameWindowId: number,
    gameWindowGroupId: number | undefined,
    rendererGeneration: number,
  ) => boolean;
  readonly remove: (gameWindowId: number) => boolean;
  readonly snapshot: () => readonly AccountGameSession[];
  readonly trackLaunch: (
    gameWindowId: number,
    gameWindowGroupId: number | undefined,
    rendererGeneration: number,
    pending: PendingAccountLaunch,
  ) => void;
}

export class AccountSessions extends Context.Service<
  AccountSessions,
  AccountSessionsShape
>()("lucent/internal/accounts/AccountSessions") {}

export const layer = Layer.effect(
  AccountSessions,
  Effect.sync(() => {
    const sessions = new Map<number, TrackedSession>();

    const getLaunch: AccountSessionsShape["getLaunch"] = (gameWindowId) =>
      sessions.get(gameWindowId)?.launchPayload ?? null;

    const remove: AccountSessionsShape["remove"] = (gameWindowId) =>
      sessions.delete(gameWindowId);

    const snapshot: AccountSessionsShape["snapshot"] = () =>
      [...sessions.values()]
        .map((session) => session.snapshot)
        .toSorted(
          (left, right) =>
            right.updatedAt - left.updatedAt ||
            right.gameWindowId - left.gameWindowId,
        );

    const reloadWindow: AccountSessionsShape["reloadWindow"] = (
      gameWindowId,
      gameWindowGroupId,
      rendererGeneration,
    ) => {
      const previous = sessions.get(gameWindowId);
      if (
        previous === undefined ||
        rendererGeneration <= previous.snapshot.rendererGeneration
      ) {
        return false;
      }

      const launchScriptName = previous.snapshot.launch?.scriptName;
      const runtime = idleRuntime(launchScriptName);
      const lastUsername = lastConnectionUsername(previous.snapshot);
      sessions.set(gameWindowId, {
        ...(previous.launchPayload === undefined
          ? {}
          : { launchPayload: previous.launchPayload }),
        rendererRevision: 0,
        snapshot: {
          ...previous.snapshot,
          ...(gameWindowGroupId === undefined ? {} : { gameWindowGroupId }),
          rendererGeneration,
          revision: previous.snapshot.revision + 1,
          ...runtime,
          connection:
            lastUsername === undefined
              ? runtime.connection
              : { lastUsername, state: "offline" },
          login:
            previous.launchPayload === undefined
              ? runtime.login
              : { state: "waiting-for-game" },
          updatedAt: Date.now(),
        },
      });
      return true;
    };

    const openWindow: AccountSessionsShape["openWindow"] = (
      gameWindowId,
      gameWindowGroupId,
      rendererGeneration,
    ) => {
      const previous = sessions.get(gameWindowId);
      if (previous !== undefined) {
        if (rendererGeneration > previous.snapshot.rendererGeneration) {
          return reloadWindow(
            gameWindowId,
            gameWindowGroupId,
            rendererGeneration,
          );
        }
        return false;
      }

      sessions.set(gameWindowId, {
        rendererRevision: 0,
        snapshot: {
          gameWindowId,
          ...(gameWindowGroupId === undefined ? {} : { gameWindowGroupId }),
          rendererGeneration,
          revision: 1,
          ...idleRuntime(),
          updatedAt: Date.now(),
        },
      });
      return true;
    };

    const trackLaunch: AccountSessionsShape["trackLaunch"] = (
      gameWindowId,
      gameWindowGroupId,
      rendererGeneration,
      pending,
    ) => {
      openWindow(gameWindowId, gameWindowGroupId, rendererGeneration);
      const previous = sessions.get(gameWindowId);
      if (
        previous === undefined ||
        rendererGeneration !== previous.snapshot.rendererGeneration
      ) {
        return;
      }

      const payload: AccountGameLaunchPayload = {
        account: pending.account,
        ...(pending.script === undefined ? {} : { script: pending.script }),
        ...(pending.server === undefined ? {} : { server: pending.server }),
        gameWindowId,
        requestedAt: pending.requestedAt,
      };
      const launchScriptName = scriptName(payload.script);
      sessions.set(gameWindowId, {
        launchPayload: payload,
        rendererRevision: previous.rendererRevision,
        snapshot: {
          ...previous.snapshot,
          ...(gameWindowGroupId === undefined ? {} : { gameWindowGroupId }),
          launch: {
            requestedAt: payload.requestedAt,
            ...(launchScriptName === undefined
              ? {}
              : { scriptName: launchScriptName }),
            ...(payload.server === undefined ? {} : { server: payload.server }),
            username: payload.account.username,
          },
          login: { state: "waiting-for-game" },
          rendererGeneration,
          revision: previous.snapshot.revision + 1,
          script:
            launchScriptName === undefined
              ? { state: "idle" }
              : { name: launchScriptName, state: "idle" },
          updatedAt: Date.now(),
        },
      });
    };

    const applyReport: AccountSessionsShape["applyReport"] = (
      gameWindowId,
      report,
    ) => {
      const previous = sessions.get(gameWindowId);
      // A renderer may report only for a window generation observed by main.
      if (
        previous === undefined ||
        report.rendererGeneration !== previous.snapshot.rendererGeneration ||
        report.revision <= previous.rendererRevision
      ) {
        return null;
      }

      if (
        report.runtime.connection.state === "online" &&
        report.runtime.connection.username.trim() === ""
      ) {
        return null;
      }

      const previousUsername = connectionUsername(previous.snapshot);
      const nextUsername = connectionUsername(report.runtime);
      const nextSnapshot: AccountGameSession = {
        ...previous.snapshot,
        ...report.runtime,
        revision: previous.snapshot.revision + 1,
        updatedAt: Date.now(),
      };
      sessions.set(gameWindowId, {
        ...(previous.launchPayload === undefined
          ? {}
          : { launchPayload: previous.launchPayload }),
        rendererRevision: report.revision,
        snapshot: nextSnapshot,
      });

      return previousUsername === nextUsername
        ? {}
        : { windowName: nextUsername ?? "" };
    };

    return AccountSessions.of({
      applyReport,
      getLaunch,
      openWindow,
      reloadWindow,
      remove,
      snapshot,
      trackLaunch,
    });
  }),
);
