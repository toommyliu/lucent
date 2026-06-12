import { BrowserWindow, type WebContents } from "electron";
import { Effect, Scope } from "effect";
import {
  ArmyIpcChannels,
  type ArmyBarrierPayload,
  type ArmyLeavePayload,
  type ArmyLoopTauntCastOutcomeReason,
  type ArmyLoopTauntObservationPayload,
  type ArmyLoopTauntParticipantPayload,
  type ArmyLoopTauntStartPayload,
  type ArmyLoopTauntStopPayload,
  type ArmyProgressPayload,
  type ArmyProgressResult,
  type ArmySessionPayload,
  type ArmyStartPayload,
  type ArmyStatusPayload,
  type ArmyStatusResult,
} from "../../../shared/ipc";
import {
  assertValidArmyConfigName,
  type ArmyConfigPayload,
} from "../../../shared/army";
import { WorkspaceFiles } from "../../workspace/WorkspaceFiles";
import { MainIpc } from "../MainIpc";
import { getSenderWindow as getBrowserWindowForSender } from "../SenderAuthorization";
import { LoopTauntCoordinator } from "./LoopTauntCoordinator";
import {
  ArmyRuntimeService,
  type ArmyRuntimeServiceShape,
} from "../runtime/ArmyRuntimeService";

const ARMY_START_TIMEOUT_MS = 120_000;
const ARMY_BARRIER_TIMEOUT_MS = 30 * 60_000;

interface DeferredVoid {
  readonly playerName: string;
  resolve(): void;
  reject(error: Error): void;
}

interface DeferredProgress {
  readonly complete: boolean;
  readonly playerName: string;
  resolve(result: ArmyProgressResult): void;
  reject(error: Error): void;
}

export interface PendingStart {
  readonly playerName: string;
  readonly senderWindow: BrowserWindow;
  readonly timer: ReturnType<typeof setTimeout>;
  resolve(value: ArmySessionPayload): void;
  reject(error: Error): void;
}

export interface ArmyBarrierState {
  readonly key: string;
  readonly step: number;
  readonly label?: string;
  readonly expectedPlayerKeys: ReadonlySet<string>;
  readonly expectedPlayers: readonly string[];
  readonly arrived: Map<string, DeferredVoid>;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface ArmyProgressState {
  readonly key: string;
  readonly step: number;
  readonly label?: string;
  readonly expectedPlayerKeys: ReadonlySet<string>;
  readonly expectedPlayers: readonly string[];
  readonly arrived: Map<string, DeferredProgress>;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface ArmySessionState extends ArmyConfigPayload {
  readonly sessionId: string;
  readonly playerKeys: ReadonlySet<string>;
  readonly windows: Map<string, BrowserWindow>;
  readonly barriers: Map<string, ArmyBarrierState>;
  readonly progressCheckpoints: Map<string, ArmyProgressState>;
  readonly loopTaunts: LoopTauntCoordinator;
}

const normalizePlayerName = (name: string): string => name.trim().toLowerCase();

const getSenderWindow = (sender: WebContents): BrowserWindow => {
  const senderWindow = getBrowserWindowForSender(sender);
  if (!senderWindow) {
    throw new Error("Army IPC requires a sender window");
  }

  return senderWindow;
};

const findSessionPlayerName = (
  session: Pick<ArmySessionState, "players">,
  playerKey: string,
): string =>
  session.players.find((player) => normalizePlayerName(player) === playerKey) ??
  playerKey;

const resolveSenderPlayerName = (
  session: Pick<ArmySessionState, "players" | "windows">,
  sender: WebContents,
): string => {
  const senderWindow = getSenderWindow(sender);
  for (const [playerKey, window] of session.windows) {
    if (window === senderWindow) {
      return findSessionPlayerName(session, playerKey);
    }
  }

  throw new Error("Army sender is not attached to this session");
};

const readArmyConfig = (
  configNameInput: string,
): Effect.Effect<ArmyConfigPayload, Error, WorkspaceFiles> =>
  Effect.gen(function* () {
    const configName = assertValidArmyConfigName(configNameInput);
    const workspace = yield* WorkspaceFiles;
    return yield* workspace.readArmyConfig(configName);
  });

const parseStartPayload = (payload: unknown): ArmyStartPayload => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("Invalid army start payload");
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record["configName"] !== "string" ||
    typeof record["playerName"] !== "string" ||
    record["playerName"].trim() === ""
  ) {
    throw new Error("Invalid army start payload");
  }

  return {
    configName: record["configName"],
    playerName: record["playerName"],
  };
};

const parseLeavePayload = (payload: unknown): ArmyLeavePayload => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("Invalid army leave payload");
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record["sessionId"] !== "string" ||
    record["sessionId"].trim() === ""
  ) {
    throw new Error("Invalid army leave payload");
  }

  const playerName = record["playerName"];
  if (playerName !== undefined && typeof playerName !== "string") {
    throw new Error("Invalid army leave payload");
  }

  return {
    sessionId: record["sessionId"],
    ...(typeof playerName === "string" ? { playerName } : null),
  };
};

const parseBarrierPayload = (payload: unknown): ArmyBarrierPayload => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("Invalid army barrier payload");
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record["sessionId"] !== "string" ||
    record["sessionId"].trim() === "" ||
    typeof record["playerName"] !== "string" ||
    record["playerName"].trim() === "" ||
    typeof record["step"] !== "number" ||
    !Number.isInteger(record["step"]) ||
    record["step"] < 0
  ) {
    throw new Error("Invalid army barrier payload");
  }

  const label = record["label"];
  const players = record["players"];
  const timeoutMs = record["timeoutMs"];
  if (label !== undefined && typeof label !== "string") {
    throw new Error("Invalid army barrier payload");
  }

  if (players !== undefined && !Array.isArray(players)) {
    throw new Error("Invalid army barrier payload");
  }

  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0)
  ) {
    throw new Error("Invalid army barrier payload");
  }

  const normalizedPlayers: string[] = [];
  if (players !== undefined) {
    const seen = new Set<string>();
    for (const player of players) {
      if (typeof player !== "string" || player.trim() === "") {
        throw new Error("Invalid army barrier payload");
      }

      const normalized = player.trim();
      const key = normalizePlayerName(normalized);
      if (seen.has(key)) {
        throw new Error("Invalid army barrier payload");
      }

      seen.add(key);
      normalizedPlayers.push(normalized);
    }

    if (normalizedPlayers.length === 0) {
      throw new Error("Invalid army barrier payload");
    }
  }

  return {
    sessionId: record["sessionId"],
    playerName: record["playerName"],
    step: record["step"],
    ...(typeof label === "string" && label.trim() !== ""
      ? { label: label.trim() }
      : null),
    ...(players === undefined ? null : { players: normalizedPlayers }),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : null),
  };
};

const parseProgressPayload = (payload: unknown): ArmyProgressPayload => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("Invalid army progress payload");
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record["sessionId"] !== "string" ||
    record["sessionId"].trim() === "" ||
    typeof record["playerName"] !== "string" ||
    record["playerName"].trim() === "" ||
    typeof record["step"] !== "number" ||
    !Number.isInteger(record["step"]) ||
    record["step"] < 0 ||
    typeof record["complete"] !== "boolean"
  ) {
    throw new Error("Invalid army progress payload");
  }

  const label = record["label"];
  const players = record["players"];
  const timeoutMs = record["timeoutMs"];
  if (label !== undefined && typeof label !== "string") {
    throw new Error("Invalid army progress payload");
  }

  if (players !== undefined && !Array.isArray(players)) {
    throw new Error("Invalid army progress payload");
  }

  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0)
  ) {
    throw new Error("Invalid army progress payload");
  }

  const normalizedPlayers: string[] = [];
  if (players !== undefined) {
    const seen = new Set<string>();
    for (const player of players) {
      if (typeof player !== "string" || player.trim() === "") {
        throw new Error("Invalid army progress payload");
      }

      const normalized = player.trim();
      const key = normalizePlayerName(normalized);
      if (seen.has(key)) {
        throw new Error("Invalid army progress payload");
      }

      seen.add(key);
      normalizedPlayers.push(normalized);
    }

    if (normalizedPlayers.length === 0) {
      throw new Error("Invalid army progress payload");
    }
  }

  return {
    sessionId: record["sessionId"],
    playerName: record["playerName"],
    step: record["step"],
    complete: record["complete"],
    ...(typeof label === "string" && label.trim() !== ""
      ? { label: label.trim() }
      : null),
    ...(players === undefined ? null : { players: normalizedPlayers }),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : null),
  };
};

const parseStatusPayload = (payload: unknown): ArmyStatusPayload => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("Invalid army status payload");
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record["sessionId"] !== "string" ||
    record["sessionId"].trim() === ""
  ) {
    throw new Error("Invalid army status payload");
  }

  return { sessionId: record["sessionId"] };
};

const parseLoopTauntParticipant = (
  value: unknown,
): ArmyLoopTauntParticipantPayload => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid loop taunt participant");
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record["name"] !== "string" ||
    record["name"].trim() === "" ||
    typeof record["number"] !== "number" ||
    !Number.isInteger(record["number"]) ||
    record["number"] < 1
  ) {
    throw new Error("Invalid loop taunt participant");
  }

  return {
    name: record["name"].trim(),
    number: record["number"],
  };
};

const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const parseLoopTauntSkill = (skill: unknown): number | string => {
  if (typeof skill === "number") {
    if (!Number.isFinite(skill) || !Number.isInteger(skill)) {
      throw new Error("Invalid loop taunt start payload");
    }

    return skill;
  }

  if (typeof skill === "string" && skill.trim() !== "") {
    return skill.trim();
  }

  throw new Error("Invalid loop taunt start payload");
};

const parseLoopTauntStartPayload = (
  payload: unknown,
): ArmyLoopTauntStartPayload => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("Invalid loop taunt start payload");
  }

  const record = payload as Record<string, unknown>;
  const participants = record["participants"];
  const skill = parseLoopTauntSkill(record["skill"]);
  if (
    typeof record["sessionId"] !== "string" ||
    record["sessionId"].trim() === "" ||
    typeof record["playerName"] !== "string" ||
    record["playerName"].trim() === "" ||
    typeof record["id"] !== "string" ||
    record["id"].trim() === "" ||
    typeof record["aura"] !== "string" ||
    record["aura"].trim() === "" ||
    typeof record["delayMs"] !== "number" ||
    !Number.isFinite(record["delayMs"]) ||
    record["delayMs"] < 0 ||
    typeof record["targetMonMapId"] !== "number" ||
    !Number.isInteger(record["targetMonMapId"]) ||
    record["targetMonMapId"] < 1 ||
    !Array.isArray(participants) ||
    participants.length === 0
  ) {
    throw new Error("Invalid loop taunt start payload");
  }

  return {
    sessionId: record["sessionId"],
    playerName: record["playerName"],
    id: record["id"].trim(),
    aura: record["aura"].trim(),
    delayMs: Math.trunc(record["delayMs"]),
    skill,
    targetMonMapId: record["targetMonMapId"],
    participants: participants.map(parseLoopTauntParticipant),
  };
};

const parseLoopTauntStopPayload = (
  payload: unknown,
): ArmyLoopTauntStopPayload => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("Invalid loop taunt stop payload");
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record["sessionId"] !== "string" ||
    record["sessionId"].trim() === "" ||
    typeof record["playerName"] !== "string" ||
    record["playerName"].trim() === "" ||
    typeof record["id"] !== "string" ||
    record["id"].trim() === ""
  ) {
    throw new Error("Invalid loop taunt stop payload");
  }

  return {
    sessionId: record["sessionId"],
    playerName: record["playerName"],
    id: record["id"].trim(),
  };
};

const parseLoopTauntObservationPayload = (
  payload: unknown,
): ArmyLoopTauntObservationPayload => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("Invalid loop taunt observation payload");
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record["sessionId"] !== "string" ||
    record["sessionId"].trim() === "" ||
    typeof record["playerName"] !== "string" ||
    record["playerName"].trim() === "" ||
    typeof record["id"] !== "string" ||
    record["id"].trim() === "" ||
    typeof record["type"] !== "string" ||
    typeof record["targetMonMapId"] !== "number" ||
    !Number.isInteger(record["targetMonMapId"]) ||
    record["targetMonMapId"] < 1
  ) {
    throw new Error("Invalid loop taunt observation payload");
  }

  const validTypes = new Set([
    "aura-added",
    "aura-missing",
    "aura-removed",
    "cast-outcome",
    "client-cast-attempt",
    "server-cast-confirmed",
  ]);
  if (!validTypes.has(record["type"])) {
    throw new Error("Invalid loop taunt observation payload");
  }

  const validReasons = new Set<ArmyLoopTauntCastOutcomeReason>([
    "failed",
    "in-flight",
    "not-alive",
    "not-ready",
    "not-usable",
  ]);
  const reason = record["reason"];
  if (
    hasOwn(record, "reason") &&
    (typeof reason !== "string" ||
      !validReasons.has(reason as ArmyLoopTauntCastOutcomeReason))
  ) {
    throw new Error("Invalid loop taunt observation payload");
  }

  const outcome = record["outcome"];
  if (
    hasOwn(record, "outcome") &&
    outcome !== "cast" &&
    outcome !== "skipped"
  ) {
    throw new Error("Invalid loop taunt observation payload");
  }

  return {
    sessionId: record["sessionId"],
    playerName: record["playerName"],
    id: record["id"].trim(),
    type: record["type"] as ArmyLoopTauntObservationPayload["type"],
    targetMonMapId: record["targetMonMapId"],
    ...(typeof record["auraName"] === "string"
      ? { auraName: record["auraName"] }
      : null),
    ...(typeof record["auraIcon"] === "string"
      ? { auraIcon: record["auraIcon"] }
      : null),
    ...(typeof record["epoch"] === "number" && Number.isInteger(record["epoch"])
      ? { epoch: record["epoch"] }
      : null),
    ...(typeof record["attempt"] === "number" &&
    Number.isInteger(record["attempt"])
      ? { attempt: record["attempt"] }
      : null),
    ...(outcome === "cast" || outcome === "skipped" ? { outcome } : null),
    ...(typeof reason === "string"
      ? { reason: reason as ArmyLoopTauntCastOutcomeReason }
      : null),
  };
};

const resolvePlayerNumber = (
  session: Pick<ArmySessionState, "players">,
  playerName: string,
): number => {
  const playerKey = normalizePlayerName(playerName);
  const index = session.players.findIndex(
    (player) => normalizePlayerName(player) === playerKey,
  );
  return index < 0 ? -1 : index + 1;
};

const toSessionPayload = (
  session: ArmySessionState,
  playerName: string,
): ArmySessionPayload => {
  const leaderKey = normalizePlayerName(session.leader);
  const playerKey = normalizePlayerName(playerName);
  return {
    configName: session.configName,
    leader: session.leader,
    players: session.players,
    raw: session.raw,
    roomNumber: session.roomNumber,
    sessionId: session.sessionId,
    playerName,
    playerNumber: resolvePlayerNumber(session, playerName),
    role: playerKey === leaderKey ? "leader" : "member",
  };
};

const rejectBarrier = (barrier: ArmyBarrierState, error: Error): void => {
  clearTimeout(barrier.timer);
  for (const waiter of barrier.arrived.values()) {
    waiter.reject(error);
  }
  barrier.arrived.clear();
};

const rejectProgress = (checkpoint: ArmyProgressState, error: Error): void => {
  clearTimeout(checkpoint.timer);
  for (const waiter of checkpoint.arrived.values()) {
    waiter.reject(error);
  }
  checkpoint.arrived.clear();
};

const armyBarrierKey = (step: number, label?: string): string =>
  JSON.stringify([step, label ?? ""]);

const abortSession = (
  runtime: ArmyRuntimeServiceShape,
  session: ArmySessionState,
  reason: string,
): void => {
  runtime.deleteSession(session.sessionId);
  runtime.deleteActiveSession(session.configName, session.sessionId);

  for (const barrier of session.barriers.values()) {
    rejectBarrier(barrier, new Error(reason));
  }
  session.barriers.clear();

  for (const checkpoint of session.progressCheckpoints.values()) {
    rejectProgress(checkpoint, new Error(reason));
  }
  session.progressCheckpoints.clear();

  session.loopTaunts.clear();

  runtime.detachSessionFromWindows(session);
  session.windows.clear();
};

const abortWindowSessions = (
  runtime: ArmyRuntimeServiceShape,
  window: BrowserWindow,
  reason: string,
): void => {
  for (const session of runtime.getWindowSessions(window)) {
    abortSession(runtime, session, reason);
  }
};

const trackWindow = (
  runtime: ArmyRuntimeServiceShape,
  window: BrowserWindow,
): void => {
  if (!runtime.trackWindow(window)) {
    return;
  }

  window.once("closed", () =>
    abortWindowSessions(runtime, window, "Army window closed"),
  );
  window.webContents.once("destroyed", () =>
    abortWindowSessions(runtime, window, "Army window destroyed"),
  );
};

const attachWindow = (
  runtime: ArmyRuntimeServiceShape,
  session: ArmySessionState,
  window: BrowserWindow,
  playerName: string,
): void => {
  const playerKey = normalizePlayerName(playerName);
  if (!session.playerKeys.has(playerKey)) {
    throw new Error(`Player is not in army config: ${playerName}`);
  }

  const existingWindow = session.windows.get(playerKey);
  if (
    existingWindow &&
    existingWindow !== window &&
    !existingWindow.isDestroyed()
  ) {
    throw new Error(`Army player already joined: ${playerName}`);
  }

  session.windows.set(playerKey, window);
  runtime.attachSessionToWindow(window, session.sessionId);
  trackWindow(runtime, window);
};

const createSession = (
  runtime: ArmyRuntimeServiceShape,
  config: ArmyConfigPayload,
  leaderWindow: BrowserWindow,
  leaderName: string,
): ArmySessionState => {
  const existingSession = runtime.getActiveSession(config.configName);
  if (existingSession) {
    abortSession(
      runtime,
      existingSession,
      `Army config restarted: ${config.configName}`,
    );
  }

  let session: ArmySessionState;
  const sessionId = `${Date.now().toString(36)}-${runtime.nextSessionId()}`;
  const loopTaunts = new LoopTauntCoordinator({
    sessionId,
    sendCommand: (participant, command) => {
      const window = session.windows.get(normalizePlayerName(participant.name));
      if (
        window &&
        !window.isDestroyed() &&
        !window.webContents.isDestroyed()
      ) {
        window.webContents.send(ArmyIpcChannels.loopTauntCommand, command);
      }
    },
  });

  session = {
    ...config,
    sessionId,
    playerKeys: new Set(config.players.map(normalizePlayerName)),
    windows: new Map<string, BrowserWindow>(),
    barriers: new Map<string, ArmyBarrierState>(),
    progressCheckpoints: new Map<string, ArmyProgressState>(),
    loopTaunts,
  };

  runtime.setSession(session);
  runtime.setActiveSession(session.configName, session.sessionId);
  attachWindow(runtime, session, leaderWindow, leaderName);
  runtime.resolvePendingStarts(
    session,
    (targetSession, window, playerName) =>
      attachWindow(runtime, targetSession, window, playerName),
    toSessionPayload,
  );
  return session;
};

const waitForLeaderSession = (
  runtime: ArmyRuntimeServiceShape,
  configName: string,
  senderWindow: BrowserWindow,
  playerName: string,
): Promise<ArmySessionPayload> =>
  new Promise((resolve, reject) => {
    let waiter: PendingStart;
    const timer = setTimeout(() => {
      runtime.removePendingStart(configName, waiter);
      reject(new Error(`Timed out waiting for army leader: ${configName}`));
    }, ARMY_START_TIMEOUT_MS);

    waiter = {
      playerName,
      senderWindow,
      timer,
      resolve,
      reject,
    };
    runtime.addPendingStart(configName, waiter);
  });

const releaseBarrierIfComplete = (
  session: ArmySessionState,
  barrier: ArmyBarrierState,
): void => {
  if (barrier.arrived.size < barrier.expectedPlayerKeys.size) {
    return;
  }

  clearTimeout(barrier.timer);
  session.barriers.delete(barrier.key);
  for (const waiter of barrier.arrived.values()) {
    waiter.resolve();
  }
  barrier.arrived.clear();
};

const releaseProgressIfComplete = (
  session: ArmySessionState,
  checkpoint: ArmyProgressState,
): void => {
  if (checkpoint.arrived.size < checkpoint.expectedPlayerKeys.size) {
    return;
  }

  const completedKeys = new Set<string>();
  for (const [playerKey, waiter] of checkpoint.arrived) {
    if (waiter.complete) {
      completedKeys.add(playerKey);
    }
  }

  const completedPlayers = checkpoint.expectedPlayers.filter((player) =>
    completedKeys.has(normalizePlayerName(player)),
  );
  const pendingPlayers = checkpoint.expectedPlayers.filter(
    (player) => !completedKeys.has(normalizePlayerName(player)),
  );
  const result = {
    complete: pendingPlayers.length === 0,
    completedPlayers,
    pendingPlayers,
  } satisfies ArmyProgressResult;

  clearTimeout(checkpoint.timer);
  session.progressCheckpoints.delete(checkpoint.key);
  for (const waiter of checkpoint.arrived.values()) {
    waiter.resolve(result);
  }
  checkpoint.arrived.clear();
};

const getBarrierTimeoutMs = (payload: ArmyBarrierPayload): number =>
  Math.max(1, Math.trunc(payload.timeoutMs ?? ARMY_BARRIER_TIMEOUT_MS));

const getProgressTimeoutMs = (payload: ArmyProgressPayload): number =>
  Math.max(1, Math.trunc(payload.timeoutMs ?? ARMY_BARRIER_TIMEOUT_MS));

const resolveBarrierExpectedPlayers = (
  session: ArmySessionState,
  payload: Pick<ArmyBarrierPayload, "players">,
): {
  readonly keys: ReadonlySet<string>;
  readonly players: readonly string[];
} => {
  if (payload.players === undefined) {
    return {
      keys: session.playerKeys,
      players: session.players,
    };
  }

  const canonicalPlayersByKey = new Map(
    session.players.map(
      (player) => [normalizePlayerName(player), player] as const,
    ),
  );
  const keys = new Set<string>();
  const players: string[] = [];

  for (const player of payload.players) {
    const key = normalizePlayerName(player);
    const canonicalPlayer = canonicalPlayersByKey.get(key);
    if (canonicalPlayer === undefined) {
      throw new Error(`Player is not in army config: ${player}`);
    }

    if (keys.has(key)) {
      throw new Error(`Duplicate army barrier player: ${player}`);
    }

    keys.add(key);
    players.push(canonicalPlayer);
  }

  return { keys, players };
};

const samePlayerSet = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean => {
  if (left.size !== right.size) {
    return false;
  }

  for (const key of left) {
    if (!right.has(key)) {
      return false;
    }
  }

  return true;
};

const waitAtBarrier = (
  session: ArmySessionState,
  playerName: string,
  payload: ArmyBarrierPayload,
): Promise<void> => {
  const playerKey = normalizePlayerName(playerName);
  if (!session.playerKeys.has(playerKey)) {
    return Promise.reject(
      new Error(`Player is not in army config: ${playerName}`),
    );
  }

  if (!session.windows.has(playerKey)) {
    return Promise.reject(
      new Error(`Army player has not joined: ${playerName}`),
    );
  }

  let expectedPlayers: {
    readonly keys: ReadonlySet<string>;
    readonly players: readonly string[];
  };
  try {
    expectedPlayers = resolveBarrierExpectedPlayers(session, payload);
  } catch (error) {
    return Promise.reject(error);
  }

  if (!expectedPlayers.keys.has(playerKey)) {
    return Promise.resolve();
  }

  const key = armyBarrierKey(payload.step, payload.label);
  let barrier = session.barriers.get(key);
  if (!barrier) {
    const step = payload.step;
    const timer = setTimeout(() => {
      const current = session.barriers.get(key);
      if (!current) {
        return;
      }

      const arrived = new Set(current.arrived.keys());
      const missing = current.expectedPlayers.filter(
        (player) => !arrived.has(normalizePlayerName(player)),
      );
      session.barriers.delete(key);
      rejectBarrier(
        current,
        new Error(
          `Timed out waiting for army step ${step}${
            current.label ? ` (${current.label})` : ""
          }; missing: ${missing.join(", ")}`,
        ),
      );
    }, getBarrierTimeoutMs(payload));

    barrier = {
      key,
      step,
      ...(payload.label !== undefined ? { label: payload.label } : null),
      expectedPlayerKeys: expectedPlayers.keys,
      expectedPlayers: expectedPlayers.players,
      arrived: new Map<string, DeferredVoid>(),
      timer,
    };
    session.barriers.set(key, barrier);
  }

  if (barrier.arrived.has(playerKey)) {
    return Promise.reject(
      new Error(
        `Army player already reached step ${payload.step}: ${playerName}`,
      ),
    );
  }

  if (
    payload.label !== undefined &&
    barrier.label !== undefined &&
    payload.label !== barrier.label
  ) {
    return Promise.reject(
      new Error(
        `Army step label mismatch for step ${payload.step}: expected ${barrier.label}, got ${payload.label}`,
      ),
    );
  }

  if (!samePlayerSet(barrier.expectedPlayerKeys, expectedPlayers.keys)) {
    return Promise.reject(
      new Error(`Army step player set mismatch for step ${payload.step}`),
    );
  }

  return new Promise((resolve, reject) => {
    barrier.arrived.set(playerKey, { playerName, resolve, reject });
    releaseBarrierIfComplete(session, barrier);
  });
};

const waitAtProgress = (
  session: ArmySessionState,
  playerName: string,
  payload: ArmyProgressPayload,
): Promise<ArmyProgressResult> => {
  const playerKey = normalizePlayerName(playerName);
  if (!session.playerKeys.has(playerKey)) {
    return Promise.reject(
      new Error(`Player is not in army config: ${playerName}`),
    );
  }

  if (!session.windows.has(playerKey)) {
    return Promise.reject(
      new Error(`Army player has not joined: ${playerName}`),
    );
  }

  let expectedPlayers: {
    readonly keys: ReadonlySet<string>;
    readonly players: readonly string[];
  };
  try {
    expectedPlayers = resolveBarrierExpectedPlayers(session, payload);
  } catch (error) {
    return Promise.reject(error);
  }

  if (!expectedPlayers.keys.has(playerKey)) {
    return Promise.resolve({
      complete: true,
      completedPlayers: [],
      pendingPlayers: [],
    });
  }

  const key = armyBarrierKey(payload.step, payload.label);
  let checkpoint = session.progressCheckpoints.get(key);
  if (!checkpoint) {
    const step = payload.step;
    const timer = setTimeout(() => {
      const current = session.progressCheckpoints.get(key);
      if (!current) {
        return;
      }

      const arrived = new Set(current.arrived.keys());
      const missing = current.expectedPlayers.filter(
        (player) => !arrived.has(normalizePlayerName(player)),
      );
      session.progressCheckpoints.delete(key);
      rejectProgress(
        current,
        new Error(
          `Timed out waiting for army progress ${step}${
            current.label ? ` (${current.label})` : ""
          }; missing: ${missing.join(", ")}`,
        ),
      );
    }, getProgressTimeoutMs(payload));

    checkpoint = {
      key,
      step,
      ...(payload.label !== undefined ? { label: payload.label } : null),
      expectedPlayerKeys: expectedPlayers.keys,
      expectedPlayers: expectedPlayers.players,
      arrived: new Map<string, DeferredProgress>(),
      timer,
    };
    session.progressCheckpoints.set(key, checkpoint);
  }

  if (checkpoint.arrived.has(playerKey)) {
    return Promise.reject(
      new Error(
        `Army player already reached progress ${payload.step}: ${playerName}`,
      ),
    );
  }

  if (!samePlayerSet(checkpoint.expectedPlayerKeys, expectedPlayers.keys)) {
    return Promise.reject(
      new Error(`Army progress player set mismatch for step ${payload.step}`),
    );
  }

  return new Promise((resolve, reject) => {
    checkpoint.arrived.set(playerKey, {
      complete: payload.complete,
      playerName,
      resolve,
      reject,
    });
    releaseProgressIfComplete(session, checkpoint);
  });
};

export const registerArmyIpcHandlers = (): Effect.Effect<
  void,
  never,
  ArmyRuntimeService | MainIpc | Scope.Scope | WorkspaceFiles
> =>
  Effect.gen(function* () {
    const ipc = yield* MainIpc;
    const runtime = yield* ArmyRuntimeService;

    yield* ipc.handle(ArmyIpcChannels.loadConfig, (_event, fileName) => {
      if (typeof fileName !== "string") {
        return Effect.fail(new Error("Army config name is required"));
      }

      return readArmyConfig(fileName);
    });

    yield* ipc.handle(ArmyIpcChannels.start, (event, rawPayload) =>
      Effect.gen(function* () {
        const payload = parseStartPayload(rawPayload);
        const config = yield* readArmyConfig(payload.configName);
        const senderWindow = getSenderWindow(event.sender);
        const playerNumber = resolvePlayerNumber(config, payload.playerName);
        if (playerNumber < 1) {
          return yield* Effect.fail(
            new Error(`Player is not in army config: ${payload.playerName}`),
          );
        }

        const activeSession = runtime.getActiveSession(config.configName);
        if (activeSession) {
          attachWindow(
            runtime,
            activeSession,
            senderWindow,
            payload.playerName,
          );
          return toSessionPayload(activeSession, payload.playerName);
        }

        if (
          normalizePlayerName(payload.playerName) ===
          normalizePlayerName(config.leader)
        ) {
          const session = createSession(
            runtime,
            config,
            senderWindow,
            payload.playerName,
          );
          return toSessionPayload(session, payload.playerName);
        }

        return yield* Effect.promise(() =>
          waitForLeaderSession(
            runtime,
            config.configName,
            senderWindow,
            payload.playerName,
          ),
        );
      }),
    );

    yield* ipc.handle(ArmyIpcChannels.leave, (_event, rawPayload) =>
      Effect.sync(() => {
        const payload = parseLeavePayload(rawPayload);
        const session = runtime.getSession(payload.sessionId);
        if (!session) {
          return;
        }

        abortSession(
          runtime,
          session,
          payload.playerName === undefined
            ? "Army session left"
            : `Army player left: ${payload.playerName}`,
        );
      }),
    );

    yield* ipc.handle(ArmyIpcChannels.barrier, (_event, rawPayload) =>
      Effect.gen(function* () {
        const payload = parseBarrierPayload(rawPayload);
        const session = runtime.getSession(payload.sessionId);
        if (!session) {
          return yield* Effect.fail(new Error("Army session is not active"));
        }

        yield* Effect.promise(() =>
          waitAtBarrier(session, payload.playerName, payload),
        );
      }),
    );

    yield* ipc.handle(ArmyIpcChannels.progress, (_event, rawPayload) =>
      Effect.gen(function* () {
        const payload = parseProgressPayload(rawPayload);
        const session = runtime.getSession(payload.sessionId);
        if (!session) {
          return yield* Effect.fail(new Error("Army session is not active"));
        }

        return yield* Effect.promise(() =>
          waitAtProgress(session, payload.playerName, payload),
        );
      }),
    );

    yield* ipc.handle(ArmyIpcChannels.status, (_event, rawPayload) =>
      Effect.sync(() => {
        const payload = parseStatusPayload(rawPayload);
        const session = runtime.getSession(payload.sessionId);
        if (!session) {
          return { active: false } satisfies ArmyStatusResult;
        }

        return {
          active: true,
          configName: session.configName,
          players: session.players,
          joinedPlayers: [...session.windows.keys()],
          waitingBarriers:
            session.barriers.size + session.progressCheckpoints.size,
        } satisfies ArmyStatusResult;
      }),
    );

    yield* ipc.handle(ArmyIpcChannels.loopTauntStart, (event, rawPayload) =>
      Effect.sync(() => {
        const payload = parseLoopTauntStartPayload(rawPayload);
        const session = runtime.getSession(payload.sessionId);
        if (!session) {
          throw new Error("Army session is not active");
        }

        session.loopTaunts.start({
          ...payload,
          playerName: resolveSenderPlayerName(session, event.sender),
        });
      }),
    );

    yield* ipc.handle(ArmyIpcChannels.loopTauntStop, (event, rawPayload) =>
      Effect.sync(() => {
        const payload = parseLoopTauntStopPayload(rawPayload);
        const session = runtime.getSession(payload.sessionId);
        if (!session) {
          return;
        }

        session.loopTaunts.stop({
          ...payload,
          playerName: resolveSenderPlayerName(session, event.sender),
        });
      }),
    );

    yield* ipc.handle(
      ArmyIpcChannels.loopTauntObservation,
      (event, rawPayload) =>
        Effect.sync(() => {
          const payload = parseLoopTauntObservationPayload(rawPayload);
          const session = runtime.getSession(payload.sessionId);
          if (!session) {
            return;
          }

          session.loopTaunts.observe({
            ...payload,
            playerName: resolveSenderPlayerName(session, event.sender),
          });
        }),
    );

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const session of runtime.getSessions()) {
          abortSession(runtime, session, "Application is quitting");
        }
        for (const configName of runtime.getPendingStartConfigNames()) {
          runtime.rejectPendingStarts(
            configName,
            new Error("Application is quitting"),
          );
        }
      }),
    );
  });
