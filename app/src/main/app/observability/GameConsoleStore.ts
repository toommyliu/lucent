import { Buffer } from "buffer";

import type { AccountManagerState } from "@lucent/core/accounts";
import type {
  GameConsoleMessage,
  GameConsoleState,
  GameConsoleWindowState,
} from "../../../shared/ipc";
import { INITIAL_WINDOW_GENERATION } from "../../window/WindowGeneration";

export const DEFAULT_GAME_CONSOLE_MAX_BYTES = 32 * 1024 * 1024;
export const DEFAULT_GAME_CONSOLE_MAX_ROWS = 5_000;
export const DEFAULT_GAME_CONSOLE_MAX_MESSAGE_BYTES = 1024 * 1024;

export type {
  GameConsoleMessage,
  GameConsoleState,
  GameConsoleWindowState,
} from "../../../shared/ipc";

export interface GameConsoleMessageQuery {
  readonly generation?: number;
  readonly limit?: number;
  readonly q?: string;
  readonly sinceId?: number;
  readonly username?: string;
  readonly windowId?: number;
}

export interface GameConsoleStore {
  readonly appendMessage: (input: {
    readonly at?: string;
    readonly gameWindowId: number;
    readonly message: string;
  }) => GameConsoleMessage;
  readonly beginWindowGeneration: (
    gameWindowId: number,
    generation?: number,
  ) => GameConsoleWindowState;
  readonly closeWindow: (
    gameWindowId: number,
    at?: string,
  ) => GameConsoleWindowState;
  readonly openWindow: (
    gameWindowId: number,
    at?: string,
    generation?: number,
  ) => GameConsoleWindowState;
  readonly queryMessages: (
    query?: GameConsoleMessageQuery,
  ) => readonly GameConsoleMessage[];
  readonly state: () => GameConsoleState;
  readonly updateSessions: (
    sessions: readonly GameConsoleSessionSnapshot[],
  ) => readonly GameConsoleWindowState[];
}

interface GameConsoleSessionSnapshot {
  readonly gameWindowId: number;
  readonly username: string | null;
}

export interface GameConsoleStoreOptions {
  readonly maxBytes?: number;
  readonly maxMessageBytes?: number;
  readonly maxRows?: number;
}

const nowIso = (): string => new Date().toISOString();

const normalizeMessage = (message: string, maxBytes: number): string => {
  const bytes = Buffer.byteLength(message, "utf8");
  if (bytes <= maxBytes) {
    return message;
  }

  return Buffer.from(message, "utf8").subarray(0, maxBytes).toString("utf8");
};

const usernameFromState = (
  state: GameConsoleWindowState | undefined,
): string | null => state?.username ?? null;

const compareWindows = (
  left: GameConsoleWindowState,
  right: GameConsoleWindowState,
): number => left.gameWindowId - right.gameWindowId;

/** Maintains the bounded game-console snapshot exposed by the observability API. */
export const makeGameConsoleStore = (
  options: GameConsoleStoreOptions = {},
): GameConsoleStore => {
  const maxRows = Math.max(1, options.maxRows ?? DEFAULT_GAME_CONSOLE_MAX_ROWS);
  const maxBytes = Math.max(
    1,
    options.maxBytes ?? DEFAULT_GAME_CONSOLE_MAX_BYTES,
  );
  const maxMessageBytes = Math.min(
    maxBytes,
    Math.max(
      1,
      options.maxMessageBytes ?? DEFAULT_GAME_CONSOLE_MAX_MESSAGE_BYTES,
    ),
  );
  const messages: GameConsoleMessage[] = [];
  const sessionUsernames = new Map<number, string | null>();
  const windows = new Map<number, GameConsoleWindowState>();
  let bytes = 0;
  let dropped = 0;
  let nextId = 1;

  const setWindow = (state: GameConsoleWindowState): GameConsoleWindowState => {
    windows.set(state.gameWindowId, state);
    return state;
  };

  const openWindow: GameConsoleStore["openWindow"] = (
    gameWindowId,
    at = nowIso(),
    generation = INITIAL_WINDOW_GENERATION,
  ) => {
    const current = windows.get(gameWindowId);
    return setWindow({
      closedAt: null,
      gameWindowId,
      generation: current?.generation ?? generation,
      lastMessageAt: current?.lastMessageAt ?? null,
      lastMessageId: current?.lastMessageId ?? null,
      messageCount: current?.messageCount ?? 0,
      openedAt: current?.openedAt ?? at,
      state: "active",
      username: current?.username ?? sessionUsernames.get(gameWindowId) ?? null,
    });
  };

  const closeWindow: GameConsoleStore["closeWindow"] = (
    gameWindowId,
    at = nowIso(),
  ) => {
    const current = windows.get(gameWindowId);
    return setWindow({
      closedAt: at,
      gameWindowId,
      generation: current?.generation ?? INITIAL_WINDOW_GENERATION,
      lastMessageAt: current?.lastMessageAt ?? null,
      lastMessageId: current?.lastMessageId ?? null,
      messageCount: current?.messageCount ?? 0,
      openedAt: current?.openedAt ?? at,
      state: "closed",
      username: current?.username ?? null,
    });
  };

  const appendMessage: GameConsoleStore["appendMessage"] = (input) => {
    const at = input.at ?? nowIso();
    const state =
      windows.get(input.gameWindowId) ?? openWindow(input.gameWindowId, at);
    const message = normalizeMessage(input.message, maxMessageBytes);
    const row: GameConsoleMessage = {
      id: nextId,
      at,
      gameWindowId: input.gameWindowId,
      generation: state.generation,
      username: usernameFromState(state),
      message,
    };
    nextId += 1;

    messages.push(row);
    bytes += Buffer.byteLength(message, "utf8");
    while (messages.length > maxRows || bytes > maxBytes) {
      const removed = messages.shift();
      if (removed === undefined) break;
      bytes -= Buffer.byteLength(removed.message, "utf8");
      dropped += 1;
    }

    setWindow({
      ...state,
      lastMessageAt: row.at,
      lastMessageId: row.id,
      messageCount: state.messageCount + 1,
    });

    return row;
  };

  const updateSessions: GameConsoleStore["updateSessions"] = (sessions) => {
    const changed: GameConsoleWindowState[] = [];
    for (const session of sessions) {
      sessionUsernames.set(session.gameWindowId, session.username);
      const current = windows.get(session.gameWindowId);
      if (current === undefined) {
        continue;
      }

      const next = {
        ...current,
        username: session.username,
      };
      if (next.username !== current.username) {
        changed.push(setWindow(next));
      }
    }
    return changed;
  };

  const beginWindowGeneration: GameConsoleStore["beginWindowGeneration"] = (
    gameWindowId,
    generation,
  ) => {
    const current = windows.get(gameWindowId) ?? openWindow(gameWindowId);
    return setWindow({
      ...current,
      generation: generation ?? current.generation + 1,
      lastMessageAt: null,
      lastMessageId: null,
      messageCount: 0,
    });
  };

  const queryMessages: GameConsoleStore["queryMessages"] = (query = {}) => {
    const normalizedQuery = query.q?.trim().toLowerCase();
    const normalizedUsername = query.username?.trim().toLowerCase();
    const filtered = messages.filter((row) => {
      if (query.sinceId !== undefined && row.id <= query.sinceId) {
        return false;
      }

      if (query.windowId !== undefined && row.gameWindowId !== query.windowId) {
        return false;
      }

      if (
        query.generation !== undefined &&
        row.generation !== query.generation
      ) {
        return false;
      }

      if (
        normalizedUsername !== undefined &&
        row.username?.toLowerCase() !== normalizedUsername
      ) {
        return false;
      }

      return (
        normalizedQuery === undefined ||
        row.message.toLowerCase().includes(normalizedQuery)
      );
    });

    if (query.limit === 0) {
      return [];
    }

    if (query.limit === undefined || query.limit >= filtered.length) {
      return filtered;
    }

    return filtered.slice(-Math.max(0, query.limit));
  };

  const state: GameConsoleStore["state"] = () => {
    const windowStates = [...windows.values()].toSorted(compareWindows);
    return {
      activeGameWindowCount: windowStates.filter(
        (windowState) => windowState.state === "active",
      ).length,
      buffer: {
        bytes,
        dropped,
        maxBytes,
        maxMessageBytes,
        maxRows,
        size: messages.length,
      },
      windows: windowStates,
    };
  };

  return {
    appendMessage,
    beginWindowGeneration,
    closeWindow,
    openWindow,
    queryMessages,
    state,
    updateSessions,
  };
};

export const usernameFromAccountStateSession = (
  session: AccountManagerState["sessions"][number],
): string | null =>
  session.connection.state === "online" ? session.connection.username : null;

export const sessionsFromAccountState = (
  state: AccountManagerState,
): readonly GameConsoleSessionSnapshot[] =>
  state.sessions.map((session) => ({
    gameWindowId: session.gameWindowId,
    username: usernameFromAccountStateSession(session),
  }));

export const messagesToNdjson = (
  messages: readonly GameConsoleMessage[],
): string =>
  messages.length === 0
    ? ""
    : `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`;
