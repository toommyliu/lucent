import type { BrowserWindow } from "electron";
import { Effect, Layer, ServiceMap } from "effect";
import type { ArmySessionPayload } from "../../../shared/ipc";
import type { ArmySessionState, PendingStart } from "../../ipc/methods/army";

export interface ArmyCoordinatorShape {
  readonly nextSessionId: () => number;
  readonly getSession: (sessionId: string) => ArmySessionState | undefined;
  readonly getSessions: () => readonly ArmySessionState[];
  readonly setSession: (session: ArmySessionState) => void;
  readonly deleteSession: (sessionId: string) => void;
  readonly getActiveSession: (
    configName: string,
  ) => ArmySessionState | undefined;
  readonly setActiveSession: (configName: string, sessionId: string) => void;
  readonly deleteActiveSession: (configName: string, sessionId: string) => void;
  readonly getWindowSessions: (
    window: BrowserWindow,
  ) => readonly ArmySessionState[];
  readonly attachSessionToWindow: (
    window: BrowserWindow,
    sessionId: string,
  ) => void;
  readonly detachSessionFromWindows: (session: ArmySessionState) => void;
  readonly trackWindow: (window: BrowserWindow) => boolean;
  readonly addPendingStart: (configName: string, waiter: PendingStart) => void;
  readonly removePendingStart: (
    configName: string,
    waiter: PendingStart,
  ) => void;
  readonly takePendingStarts: (configName: string) => readonly PendingStart[];
  readonly getPendingStartConfigNames: () => readonly string[];
  readonly rejectPendingStarts: (configName: string, error: Error) => void;
  readonly resolvePendingStarts: (
    session: ArmySessionState,
    attachWindow: (
      session: ArmySessionState,
      window: BrowserWindow,
      playerName: string,
    ) => void,
    toSessionPayload: (
      session: ArmySessionState,
      playerName: string,
    ) => ArmySessionPayload,
  ) => void;
}

export class ArmyCoordinator extends ServiceMap.Service<
  ArmyCoordinator,
  ArmyCoordinatorShape
>()("main/backend/army/ArmyCoordinator") {}

export const makeArmyCoordinator = (): ArmyCoordinatorShape => {
  let nextSessionId = 0;
  const sessions = new Map<string, ArmySessionState>();
  const activeSessionByConfig = new Map<string, string>();
  const pendingStartsByConfig = new Map<string, PendingStart[]>();
  const windowSessionIds = new WeakMap<BrowserWindow, Set<string>>();
  const trackedWindows = new WeakSet<BrowserWindow>();

  const service: ArmyCoordinatorShape = {
    nextSessionId: () => nextSessionId++,
    getSession: (sessionId) => sessions.get(sessionId),
    getSessions: () => [...sessions.values()],
    setSession: (session) => {
      sessions.set(session.sessionId, session);
    },
    deleteSession: (sessionId) => {
      sessions.delete(sessionId);
    },
    getActiveSession: (configName) => {
      const sessionId = activeSessionByConfig.get(configName);
      return sessionId === undefined ? undefined : sessions.get(sessionId);
    },
    setActiveSession: (configName, sessionId) => {
      activeSessionByConfig.set(configName, sessionId);
    },
    deleteActiveSession: (configName, sessionId) => {
      if (activeSessionByConfig.get(configName) === sessionId) {
        activeSessionByConfig.delete(configName);
      }
    },
    getWindowSessions: (window) => {
      const sessionIds = windowSessionIds.get(window);
      if (!sessionIds) {
        return [];
      }

      return [...sessionIds]
        .map((sessionId) => sessions.get(sessionId))
        .filter(
          (session): session is ArmySessionState => session !== undefined,
        );
    },
    attachSessionToWindow: (window, sessionId) => {
      let sessionIds = windowSessionIds.get(window);
      if (!sessionIds) {
        sessionIds = new Set<string>();
        windowSessionIds.set(window, sessionIds);
      }
      sessionIds.add(sessionId);
    },
    detachSessionFromWindows: (session) => {
      for (const window of session.windows.values()) {
        windowSessionIds.get(window)?.delete(session.sessionId);
      }
    },
    trackWindow: (window) => {
      if (trackedWindows.has(window)) {
        return false;
      }

      trackedWindows.add(window);
      return true;
    },
    addPendingStart: (configName, waiter) => {
      pendingStartsByConfig.set(configName, [
        ...(pendingStartsByConfig.get(configName) ?? []),
        waiter,
      ]);
    },
    removePendingStart: (configName, waiter) => {
      const pending = pendingStartsByConfig.get(configName);
      if (!pending) {
        return;
      }

      const remaining = pending.filter((candidate) => candidate !== waiter);
      if (remaining.length > 0) {
        pendingStartsByConfig.set(configName, remaining);
      } else {
        pendingStartsByConfig.delete(configName);
      }
    },
    takePendingStarts: (configName) => {
      const pending = pendingStartsByConfig.get(configName) ?? [];
      pendingStartsByConfig.delete(configName);
      return pending;
    },
    getPendingStartConfigNames: () => [...pendingStartsByConfig.keys()],
    rejectPendingStarts: (configName, error) => {
      const pending = service.takePendingStarts(configName);
      for (const waiter of pending) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    },
    resolvePendingStarts: (session, attachWindow, toSessionPayload) => {
      const pending = service.takePendingStarts(session.configName);
      for (const waiter of pending) {
        clearTimeout(waiter.timer);
        try {
          attachWindow(session, waiter.senderWindow, waiter.playerName);
          waiter.resolve(toSessionPayload(session, waiter.playerName));
        } catch (error) {
          waiter.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    },
  };

  return service;
};

export const layer = Layer.effect(ArmyCoordinator)(
  Effect.gen(function* () {
    const service = makeArmyCoordinator();

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        const error = new Error("Army runtime service shutting down");
        for (const configName of service.getPendingStartConfigNames()) {
          service.rejectPendingStarts(configName, error);
        }
      }),
    );

    return service;
  }),
);
