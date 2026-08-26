import type {
  GameConsoleMessage,
  GameConsoleState,
  GameConsoleWindowState,
} from "../../app/src/shared/ipc/diagnostics";

export type { GameConsoleMessage, GameConsoleState, GameConsoleWindowState };

export interface ConsoleFilters {
  readonly generation: number | null;
  readonly query: string;
  readonly username: string;
  readonly windowId: number | null;
}

export type ConsoleConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting";

export const EMPTY_CONSOLE_FILTERS: ConsoleFilters = {
  generation: null,
  query: "",
  username: "",
  windowId: null,
};

export function consoleFiltersActive(filters: ConsoleFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.username.trim().length > 0 ||
    filters.windowId !== null
  );
}

export function messageMatchesConsoleFilters(
  message: GameConsoleMessage,
  filters: ConsoleFilters,
): boolean {
  if (filters.windowId !== null && message.gameWindowId !== filters.windowId) {
    return false;
  }
  if (
    filters.windowId !== null &&
    filters.generation !== null &&
    message.generation !== filters.generation
  ) {
    return false;
  }

  const username = filters.username.trim().toLocaleLowerCase();
  if (
    username.length > 0 &&
    (message.username ?? "").toLocaleLowerCase() !== username
  ) {
    return false;
  }

  const query = filters.query.trim().toLocaleLowerCase();
  return (
    query.length === 0 || message.message.toLocaleLowerCase().includes(query)
  );
}

export function consoleMessageQuery(filters: ConsoleFilters): URLSearchParams {
  const search = new URLSearchParams();
  const query = filters.query.trim();
  const username = filters.username.trim();

  if (query.length > 0) {
    search.set("q", query);
  }
  if (filters.windowId !== null) {
    search.set("windowId", String(filters.windowId));
  }
  if (filters.windowId !== null && filters.generation !== null) {
    search.set("generation", String(filters.generation));
  }
  if (username.length > 0) {
    search.set("username", username);
  }

  return search;
}

export function mergeConsoleMessage(
  current: readonly GameConsoleMessage[],
  incoming: GameConsoleMessage,
  maxRows: number,
): readonly GameConsoleMessage[] {
  const existingIndex = current.findIndex(
    (message) => message.id === incoming.id,
  );
  const merged =
    existingIndex === -1
      ? [...current, incoming]
      : current.map((message, index) =>
          index === existingIndex ? incoming : message,
        );
  merged.sort((left, right) => left.id - right.id);

  const boundedMaxRows = Math.max(1, maxRows);
  return merged.length > boundedMaxRows
    ? merged.slice(-boundedMaxRows)
    : merged;
}

export function trimConsoleMessages(
  messages: readonly GameConsoleMessage[],
  maxRows: number,
): readonly GameConsoleMessage[] {
  const boundedMaxRows = Math.max(1, maxRows);
  return messages.length > boundedMaxRows
    ? messages.slice(-boundedMaxRows)
    : messages;
}

export function consoleMessagesToNdjson(
  messages: readonly GameConsoleMessage[],
): string {
  return messages.length === 0
    ? ""
    : `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`;
}

export function selectedConsoleWindow(
  state: GameConsoleState | null,
  windowId: number | null,
): GameConsoleWindowState | null {
  if (state === null || windowId === null) {
    return null;
  }
  return (
    state.windows.find(
      (windowState) => windowState.gameWindowId === windowId,
    ) ?? null
  );
}

export function consoleGenerations(
  windowState: GameConsoleWindowState | null,
): readonly number[] {
  if (windowState === null) {
    return [];
  }
  return Array.from(
    { length: Math.max(0, windowState.generation) },
    (_, index) => index + 1,
  );
}
