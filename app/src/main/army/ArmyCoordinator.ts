import type { BrowserWindow } from "electron";
import { Context, Effect, Layer } from "effect";

import {
  normalizeArmyPlayerKey,
  type ArmyConfigPayload,
  type ArmyProgressResult,
  type ArmySessionPayload,
} from "../../shared/army";
import { isElectronWindowUsable } from "../electron/windowUsability";

const ARMY_START_TIMEOUT_MS = 120_000;
export const ARMY_SYNC_TIMEOUT_MS = 10 * 60_000;

interface DeferredStart {
  readonly playerName: string;
  readonly timer?: ReturnType<typeof setTimeout>;
  readonly window: BrowserWindow;
  reject(error: Error): void;
  resolve(value: ArmySessionPayload): void;
}

interface DeferredVoid {
  readonly playerName: string;
  reject(error: Error): void;
  resolve(): void;
}

interface DeferredProgress {
  readonly complete: boolean;
  readonly playerName: string;
  reject(error: Error): void;
  resolve(result: ArmyProgressResult): void;
}

interface ArmyParticipantState {
  readonly playerName: string;
  readonly waiters: DeferredStart[];
  window: BrowserWindow;
}

export interface ArmySyncState {
  readonly arrived: Map<string, DeferredVoid>;
  readonly key: string;
  readonly label?: string;
  readonly step: number;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface ArmyProgressState {
  readonly arrived: Map<string, DeferredProgress>;
  readonly key: string;
  readonly label?: string;
  readonly step: number;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface ArmySessionState extends ArmyConfigPayload {
  readonly playerKeys: ReadonlySet<string>;
  readonly participants: Map<string, ArmyParticipantState>;
  readonly progressCheckpoints: Map<string, ArmyProgressState>;
  readonly sessionId: string;
  readonly startTimer: ReturnType<typeof setTimeout>;
  readonly syncPoints: Map<string, ArmySyncState>;
  started: boolean;
}

export interface ArmyCoordinatorShape {
  readonly abortSession: (session: ArmySessionState, reason: string) => void;
  readonly failSession: (
    sessionId: string,
    playerName: string,
    reason: string,
  ) => void;
  readonly getOrCreateSession: (config: ArmyConfigPayload) => ArmySessionState;
  readonly getSession: (sessionId: string) => ArmySessionState | undefined;
  readonly getSessions: () => readonly ArmySessionState[];
  readonly join: (
    session: ArmySessionState,
    playerName: string,
    window: BrowserWindow,
  ) => Promise<ArmySessionPayload>;
  readonly leave: (sessionId: string, playerName: string) => void;
  readonly nextSessionId: () => number;
  readonly waitAtProgress: (
    session: ArmySessionState,
    playerName: string,
    payload: {
      readonly complete: boolean;
      readonly label?: string;
      readonly step: number;
      readonly timeoutMs?: number;
    },
  ) => Promise<ArmyProgressResult>;
  readonly waitAtSync: (
    session: ArmySessionState,
    playerName: string,
    payload: {
      readonly label?: string;
      readonly step: number;
      readonly timeoutMs?: number;
    },
  ) => Promise<void>;
}

export class ArmyCoordinator extends Context.Service<
  ArmyCoordinator,
  ArmyCoordinatorShape
>()("lucent/desktop/army/ArmyCoordinator") {}

const findPlayerName = (
  session: Pick<ArmySessionState, "players">,
  playerKey: string,
): string =>
  session.players.find(
    (player) => normalizeArmyPlayerKey(player) === playerKey,
  ) ?? playerKey;

const resolvePlayerNumber = (
  session: Pick<ArmySessionState, "players">,
  playerName: string,
): number => {
  const playerKey = normalizeArmyPlayerKey(playerName);
  const index = session.players.findIndex(
    (player) => normalizeArmyPlayerKey(player) === playerKey,
  );
  return index < 0 ? -1 : index + 1;
};

const toSessionPayload = (
  session: ArmySessionState,
  playerName: string,
): ArmySessionPayload => {
  const playerNumber = resolvePlayerNumber(session, playerName);
  return {
    configName: session.configName,
    items: session.items,
    playerName: findPlayerName(session, normalizeArmyPlayerKey(playerName)),
    playerNumber,
    players: session.players,
    raw: session.raw,
    role: playerNumber === 1 ? "leader" : "member",
    room: session.room,
    sessionId: session.sessionId,
    sets: session.sets,
  };
};

const timeoutMs = (value: number | undefined): number =>
  Math.max(1, Math.trunc(value ?? ARMY_SYNC_TIMEOUT_MS));

const syncLabel = (label?: string): string => label ?? "sync";

const describeLabel = (label?: string): string =>
  label === undefined ? "<none>" : label;

const rejectSync = (sync: ArmySyncState, error: Error): void => {
  clearTimeout(sync.timer);
  for (const waiter of sync.arrived.values()) {
    waiter.reject(error);
  }
  sync.arrived.clear();
};

const rejectProgress = (checkpoint: ArmyProgressState, error: Error): void => {
  clearTimeout(checkpoint.timer);
  for (const waiter of checkpoint.arrived.values()) {
    waiter.reject(error);
  }
  checkpoint.arrived.clear();
};

const syncKey = (step: number): string => String(step);

const getMissingPlayers = (
  session: ArmySessionState,
  arrived: ReadonlySet<string>,
): readonly string[] =>
  session.players.filter(
    (player) => !arrived.has(normalizeArmyPlayerKey(player)),
  );

const sameWindow = (left: BrowserWindow, right: BrowserWindow): boolean =>
  left === right;

export const makeArmyCoordinator = (): ArmyCoordinatorShape => {
  let nextSessionId = 0;
  const sessions = new Map<string, ArmySessionState>();
  const activeSessionByConfig = new Map<string, string>();
  const windowSessionIds = new WeakMap<BrowserWindow, Set<string>>();
  const trackedWindows = new WeakSet<BrowserWindow>();

  const detachSessionFromWindows = (session: ArmySessionState): void => {
    for (const participant of session.participants.values()) {
      windowSessionIds.get(participant.window)?.delete(session.sessionId);
    }
  };

  const abortSession = (session: ArmySessionState, reason: string): void => {
    sessions.delete(session.sessionId);
    if (activeSessionByConfig.get(session.configName) === session.sessionId) {
      activeSessionByConfig.delete(session.configName);
    }

    clearTimeout(session.startTimer);
    const error = new Error(reason);
    for (const participant of session.participants.values()) {
      for (const waiter of participant.waiters) {
        if (waiter.timer !== undefined) {
          clearTimeout(waiter.timer);
        }
        waiter.reject(error);
      }
      participant.waiters.length = 0;
    }

    for (const sync of session.syncPoints.values()) {
      rejectSync(sync, error);
    }
    session.syncPoints.clear();

    for (const checkpoint of session.progressCheckpoints.values()) {
      rejectProgress(checkpoint, error);
    }
    session.progressCheckpoints.clear();

    detachSessionFromWindows(session);
    session.participants.clear();
  };

  const abortWindowSessions = (window: BrowserWindow, reason: string): void => {
    const sessionIds = windowSessionIds.get(window);
    if (sessionIds === undefined) {
      return;
    }

    for (const sessionId of sessionIds) {
      const session = sessions.get(sessionId);
      if (session !== undefined) {
        abortSession(session, reason);
      }
    }
  };

  const trackWindow = (window: BrowserWindow): void => {
    if (trackedWindows.has(window)) {
      return;
    }

    trackedWindows.add(window);
    window.once("closed", () =>
      abortWindowSessions(window, "Army window closed"),
    );
    window.webContents.once("destroyed", () =>
      abortWindowSessions(window, "Army window destroyed"),
    );
  };

  const attachWindow = (
    session: ArmySessionState,
    playerName: string,
    window: BrowserWindow,
  ): ArmyParticipantState => {
    const playerKey = normalizeArmyPlayerKey(playerName);
    if (!session.playerKeys.has(playerKey)) {
      throw new Error(`Player is not in army config: ${playerName}`);
    }

    const current = session.participants.get(playerKey);
    if (current !== undefined) {
      if (isElectronWindowUsable(current.window)) {
        if (sameWindow(current.window, window)) {
          return current;
        }
        throw new Error(`Army player already joined: ${playerName}`);
      }

      current.window = window;
      return current;
    }

    const participant: ArmyParticipantState = {
      playerName: findPlayerName(session, playerKey),
      waiters: [],
      window,
    };
    session.participants.set(playerKey, participant);
    return participant;
  };

  const attachSessionToWindow = (
    session: ArmySessionState,
    window: BrowserWindow,
  ): void => {
    let sessionIds = windowSessionIds.get(window);
    if (sessionIds === undefined) {
      sessionIds = new Set<string>();
      windowSessionIds.set(window, sessionIds);
    }
    sessionIds.add(session.sessionId);
    trackWindow(window);
  };

  const resolveStartIfReady = (session: ArmySessionState): void => {
    if (session.started || session.participants.size < session.players.length) {
      return;
    }

    session.started = true;
    clearTimeout(session.startTimer);
    for (const participant of session.participants.values()) {
      const waiters = participant.waiters.splice(0);
      for (const waiter of waiters) {
        if (waiter.timer !== undefined) {
          clearTimeout(waiter.timer);
        }
        waiter.resolve(toSessionPayload(session, waiter.playerName));
      }
    }
  };

  const service: ArmyCoordinatorShape = {
    abortSession,
    failSession: (sessionId, playerName, reason) => {
      const session = sessions.get(sessionId);
      if (session === undefined) {
        return;
      }

      abortSession(session, `Army failed for ${playerName}: ${reason}`);
    },
    getOrCreateSession: (config) => {
      const activeSessionId = activeSessionByConfig.get(config.configName);
      const activeSession =
        activeSessionId === undefined
          ? undefined
          : sessions.get(activeSessionId);
      if (activeSession !== undefined) {
        return activeSession;
      }

      let session: ArmySessionState;
      const sessionId = `${Date.now().toString(36)}-${nextSessionId++}`;
      const startTimer = setTimeout(() => {
        const current = sessions.get(sessionId);
        if (current === undefined || current.started) {
          return;
        }

        const missing = getMissingPlayers(
          current,
          new Set(current.participants.keys()),
        );
        abortSession(
          current,
          `Timed out waiting for army players: ${missing.join(", ")}`,
        );
      }, ARMY_START_TIMEOUT_MS);

      session = {
        ...config,
        participants: new Map(),
        playerKeys: new Set(config.players.map(normalizeArmyPlayerKey)),
        progressCheckpoints: new Map(),
        sessionId,
        startTimer,
        started: false,
        syncPoints: new Map(),
      };
      sessions.set(session.sessionId, session);
      activeSessionByConfig.set(session.configName, session.sessionId);
      return session;
    },
    getSession: (sessionId) => sessions.get(sessionId),
    getSessions: () => [...sessions.values()],
    join: (session, playerName, window) =>
      new Promise((resolve, reject) => {
        try {
          const participant = attachWindow(session, playerName, window);
          attachSessionToWindow(session, window);
          if (session.started) {
            resolve(toSessionPayload(session, playerName));
            return;
          }

          const waiter: DeferredStart = {
            playerName,
            resolve,
            reject,
            window,
          };
          participant.waiters.push(waiter);
          resolveStartIfReady(session);
        } catch (cause) {
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      }),
    leave: (sessionId, playerName) => {
      const session = sessions.get(sessionId);
      if (session === undefined) {
        return;
      }

      abortSession(session, `Army player left: ${playerName}`);
    },
    nextSessionId: () => nextSessionId++,
    waitAtProgress: (session, playerName, payload) => {
      const playerKey = normalizeArmyPlayerKey(playerName);
      if (!session.started) {
        return Promise.reject(new Error("Army session has not started"));
      }
      if (!session.playerKeys.has(playerKey)) {
        return Promise.reject(
          new Error(`Player is not in army config: ${playerName}`),
        );
      }
      if (!session.participants.has(playerKey)) {
        return Promise.reject(
          new Error(`Army player has not joined: ${playerName}`),
        );
      }

      const key = syncKey(payload.step);
      let checkpoint = session.progressCheckpoints.get(key);
      if (checkpoint === undefined) {
        const timer = setTimeout(() => {
          const current = session.progressCheckpoints.get(key);
          if (
            sessions.get(session.sessionId) !== session ||
            current === undefined
          ) {
            return;
          }

          const missing = getMissingPlayers(
            session,
            new Set(current.arrived.keys()),
          );
          abortSession(
            session,
            `Timed out waiting for army progress ${payload.step} (${syncLabel(
              current.label,
            )}); missing: ${missing.join(", ")}`,
          );
        }, timeoutMs(payload.timeoutMs));

        checkpoint = {
          arrived: new Map(),
          key,
          ...(payload.label === undefined ? {} : { label: payload.label }),
          step: payload.step,
          timer,
        };
        session.progressCheckpoints.set(key, checkpoint);
      }

      if (checkpoint.arrived.has(playerKey)) {
        const error = new Error(
          `Army player already reached progress ${payload.step}: ${playerName}`,
        );
        abortSession(session, error.message);
        return Promise.reject(error);
      }

      if (syncLabel(checkpoint.label) !== syncLabel(payload.label)) {
        const error = new Error(
          `Army progress label mismatch for step ${
            payload.step
          }: expected ${describeLabel(checkpoint.label)}, got ${describeLabel(
            payload.label,
          )}`,
        );
        abortSession(session, error.message);
        return Promise.reject(error);
      }

      return new Promise((resolve, reject) => {
        checkpoint.arrived.set(playerKey, {
          complete: payload.complete,
          playerName,
          reject,
          resolve,
        });

        if (checkpoint.arrived.size < session.players.length) {
          return;
        }

        const completedKeys = new Set<string>();
        for (const [arrivedKey, waiter] of checkpoint.arrived) {
          if (waiter.complete) {
            completedKeys.add(arrivedKey);
          }
        }

        const completedPlayers = session.players.filter((player) =>
          completedKeys.has(normalizeArmyPlayerKey(player)),
        );
        const pendingPlayers = session.players.filter(
          (player) => !completedKeys.has(normalizeArmyPlayerKey(player)),
        );
        const result = {
          complete: pendingPlayers.length === 0,
          completedPlayers,
          pendingPlayers,
        } satisfies ArmyProgressResult;

        clearTimeout(checkpoint.timer);
        session.progressCheckpoints.delete(checkpoint.key);
        const waiters = [...checkpoint.arrived.values()];
        checkpoint.arrived.clear();
        for (const waiter of waiters) {
          waiter.resolve(result);
        }
      });
    },
    waitAtSync: (session, playerName, payload) => {
      const playerKey = normalizeArmyPlayerKey(playerName);
      if (!session.started) {
        return Promise.reject(new Error("Army session has not started"));
      }
      if (!session.playerKeys.has(playerKey)) {
        return Promise.reject(
          new Error(`Player is not in army config: ${playerName}`),
        );
      }
      if (!session.participants.has(playerKey)) {
        return Promise.reject(
          new Error(`Army player has not joined: ${playerName}`),
        );
      }

      const key = syncKey(payload.step);
      let sync = session.syncPoints.get(key);
      if (sync === undefined) {
        const timer = setTimeout(() => {
          const current = session.syncPoints.get(key);
          if (
            sessions.get(session.sessionId) !== session ||
            current === undefined
          ) {
            return;
          }

          const missing = getMissingPlayers(
            session,
            new Set(current.arrived.keys()),
          );
          abortSession(
            session,
            `Timed out waiting for army sync ${payload.step} (${syncLabel(
              current.label,
            )}); missing: ${missing.join(", ")}`,
          );
        }, timeoutMs(payload.timeoutMs));

        sync = {
          arrived: new Map(),
          key,
          ...(payload.label === undefined ? {} : { label: payload.label }),
          step: payload.step,
          timer,
        };
        session.syncPoints.set(key, sync);
      }

      if (sync.arrived.has(playerKey)) {
        const error = new Error(
          `Army player already reached sync ${payload.step}: ${playerName}`,
        );
        abortSession(session, error.message);
        return Promise.reject(error);
      }

      if (syncLabel(sync.label) !== syncLabel(payload.label)) {
        const error = new Error(
          `Army sync label mismatch for step ${
            payload.step
          }: expected ${describeLabel(sync.label)}, got ${describeLabel(
            payload.label,
          )}`,
        );
        abortSession(session, error.message);
        return Promise.reject(error);
      }

      return new Promise((resolve, reject) => {
        sync.arrived.set(playerKey, { playerName, reject, resolve });
        if (sync.arrived.size < session.players.length) {
          return;
        }

        clearTimeout(sync.timer);
        session.syncPoints.delete(sync.key);
        const waiters = [...sync.arrived.values()];
        sync.arrived.clear();
        for (const waiter of waiters) {
          waiter.resolve();
        }
      });
    },
  };

  return service;
};

export const layer = Layer.effect(
  ArmyCoordinator,
  Effect.gen(function* () {
    const service = makeArmyCoordinator();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const session of service.getSessions()) {
          service.abortSession(session, "Application is quitting");
        }
      }),
    );
    return ArmyCoordinator.of(service);
  }),
);
