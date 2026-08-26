import {
  consoleMessageQuery,
  type ConsoleConnectionStatus,
  type ConsoleFilters,
  type GameConsoleMessage,
  type GameConsoleState,
  type GameConsoleWindowState,
} from "@/console-model";

export interface ConsoleStreamHandlers {
  readonly onConnectionChange: (status: ConsoleConnectionStatus) => void;
  readonly onMessage: (message: GameConsoleMessage) => void;
  readonly onReconnect: () => void;
  readonly onStateInvalidated: () => void;
}

export interface ConsoleTransport {
  readonly readMessages: (
    filters: ConsoleFilters,
    signal?: AbortSignal,
  ) => Promise<readonly GameConsoleMessage[]>;
  readonly readState: (signal?: AbortSignal) => Promise<GameConsoleState>;
  readonly subscribe: (handlers: ConsoleStreamHandlers) => () => void;
}

export interface ConsoleEndpoints {
  readonly events: string;
  readonly messages: string;
  readonly state: string;
}

const DEFAULT_ENDPOINTS: ConsoleEndpoints = {
  events: "/events",
  messages: "/api/messages",
  state: "/api/state",
};

const WINDOW_EVENT_NAMES = [
  "window-opened",
  "window-closed",
  "window-generation",
  "session-updated",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function isGameConsoleMessage(
  value: unknown,
): value is GameConsoleMessage {
  return (
    isRecord(value) &&
    typeof value.at === "string" &&
    isSafeInteger(value.gameWindowId) &&
    isSafeInteger(value.generation) &&
    isSafeInteger(value.id) &&
    typeof value.message === "string" &&
    isNullableString(value.username)
  );
}

function isGameConsoleWindowState(
  value: unknown,
): value is GameConsoleWindowState {
  return (
    isRecord(value) &&
    isNullableString(value.closedAt) &&
    isSafeInteger(value.gameWindowId) &&
    isSafeInteger(value.generation) &&
    isNullableString(value.lastMessageAt) &&
    (isSafeInteger(value.lastMessageId) || value.lastMessageId === null) &&
    isSafeInteger(value.messageCount) &&
    typeof value.openedAt === "string" &&
    (value.state === "active" || value.state === "closed") &&
    isNullableString(value.username)
  );
}

function isGameConsoleState(value: unknown): value is GameConsoleState {
  if (
    !isRecord(value) ||
    !isSafeInteger(value.activeGameWindowCount) ||
    !isRecord(value.buffer) ||
    !Array.isArray(value.windows)
  ) {
    return false;
  }

  const buffer = value.buffer;
  return (
    isSafeInteger(buffer.bytes) &&
    isSafeInteger(buffer.dropped) &&
    isSafeInteger(buffer.maxBytes) &&
    isSafeInteger(buffer.maxMessageBytes) &&
    isSafeInteger(buffer.maxRows) &&
    isSafeInteger(buffer.size) &&
    value.windows.every(isGameConsoleWindowState)
  );
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`);
  }
  return (await response.json()) as unknown;
}

function parseMessages(value: unknown): readonly GameConsoleMessage[] {
  if (!Array.isArray(value) || !value.every(isGameConsoleMessage)) {
    throw new Error("The console messages response is invalid");
  }
  return value;
}

function parseState(value: unknown): GameConsoleState {
  if (!isGameConsoleState(value)) {
    throw new Error("The console state response is invalid");
  }
  return value;
}

function parseEventMessage(event: Event): GameConsoleMessage | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
    return null;
  }

  try {
    const value: unknown = JSON.parse(event.data);
    return isGameConsoleMessage(value) ? value : null;
  } catch {
    return null;
  }
}

export function createConsoleTransport(
  endpoints: Partial<ConsoleEndpoints> = {},
): ConsoleTransport {
  const resolvedEndpoints = { ...DEFAULT_ENDPOINTS, ...endpoints };

  return {
    async readMessages(filters, signal) {
      const search = consoleMessageQuery(filters);
      const suffix = search.size === 0 ? "" : `?${search.toString()}`;
      const response = await fetch(`${resolvedEndpoints.messages}${suffix}`, {
        cache: "no-store",
        signal,
      });
      return parseMessages(await readJson(response));
    },

    async readState(signal) {
      const response = await fetch(resolvedEndpoints.state, {
        cache: "no-store",
        signal,
      });
      return parseState(await readJson(response));
    },

    subscribe(handlers) {
      const source = new EventSource(resolvedEndpoints.events);
      let refreshOnOpen = false;

      handlers.onConnectionChange("connecting");
      source.addEventListener("open", () => {
        const shouldRefresh = refreshOnOpen;
        refreshOnOpen = false;
        handlers.onConnectionChange("connected");
        if (shouldRefresh) {
          handlers.onReconnect();
        }
      });
      source.addEventListener("error", () => {
        refreshOnOpen = true;
        handlers.onConnectionChange("reconnecting");
      });
      source.addEventListener("message", (event) => {
        const message = parseEventMessage(event);
        if (message !== null) {
          handlers.onMessage(message);
        }
      });
      for (const eventName of WINDOW_EVENT_NAMES) {
        source.addEventListener(eventName, handlers.onStateInvalidated);
      }

      return () => source.close();
    },
  };
}

export const consoleTransport = createConsoleTransport();
