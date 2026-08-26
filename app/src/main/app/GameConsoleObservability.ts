import { Buffer } from "buffer";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "http";

import { ipcMain, type IpcMainEvent } from "electron";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import type { AccountManagerState } from "@lucent/core/accounts";
import { GameConsoleIpc } from "../../shared/ipc";
import { Accounts } from "../internal/accounts/Accounts";
import { DesktopWindows } from "../window/DesktopWindows";
import { INITIAL_WINDOW_GENERATION } from "../window/WindowGeneration";
import { DesktopObservability } from "./DesktopObservability";
import {
  makeDesktopTraceViewer,
  type DesktopTraceViewerHandler,
} from "./DesktopTraceViewer";

/**
 * Game window console observability.
 *
 * Enable with `--debug`. When enabled, Lucent starts a loopback-only HTTP/SSE
 * server at `http://127.0.0.1:10637` and captures only
 * console messages from windows registered as DesktopWindow kind `"game"`.
 * `--trace-projections` enables this server and adds projection traces.
 * Renderer reloads start a numbered generation; earlier generations remain
 * available until the bounded message buffer evicts them.
 */
export const DEFAULT_GAME_CONSOLE_OBSERVABILITY_PORT = 10_637;
export const DEFAULT_GAME_CONSOLE_MAX_BYTES = 32 * 1024 * 1024;
export const DEFAULT_GAME_CONSOLE_MAX_ROWS = 5_000;
export const DEFAULT_GAME_CONSOLE_MAX_MESSAGE_BYTES = 1024 * 1024;

export interface GameConsoleObservabilityOptions {
  readonly port: number;
}

export interface GameConsoleObservabilityInstall {
  readonly port: number;
  readonly url: string;
}

export class GameConsoleObservabilityStartError extends Schema.TaggedErrorClass<GameConsoleObservabilityStartError>()(
  "GameConsoleObservabilityStartError",
  {
    port: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to start game console observability on port ${this.port}.`;
  }
}

export interface GameConsoleMessage {
  readonly id: number;
  readonly at: string;
  readonly gameWindowId: number;
  readonly generation: number;
  readonly username: string | null;
  readonly message: string;
}

export interface GameConsoleWindowState {
  readonly closedAt: string | null;
  readonly gameWindowId: number;
  readonly generation: number;
  readonly lastMessageAt: string | null;
  readonly lastMessageId: number | null;
  readonly messageCount: number;
  readonly openedAt: string;
  readonly state: "active" | "closed";
  readonly username: string | null;
}

export interface GameConsoleState {
  readonly activeGameWindowCount: number;
  readonly buffer: {
    readonly bytes: number;
    readonly dropped: number;
    readonly maxBytes: number;
    readonly maxMessageBytes: number;
    readonly maxRows: number;
    readonly size: number;
  };
  readonly windows: readonly GameConsoleWindowState[];
}

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
  readonly beginWindowGeneration: (
    gameWindowId: number,
    generation?: number,
  ) => GameConsoleWindowState;
  readonly state: () => GameConsoleState;
  readonly updateSessions: (
    sessions: readonly GameConsoleSessionSnapshot[],
  ) => readonly GameConsoleWindowState[];
}

interface GameConsoleSessionSnapshot {
  readonly gameWindowId: number;
  readonly username: string | null;
}

interface GameConsoleStoreOptions {
  readonly maxBytes?: number;
  readonly maxMessageBytes?: number;
  readonly maxRows?: number;
}

interface GameConsoleHttpHandlerOptions {
  readonly addSseClient?: (response: ServerResponse) => () => void;
  readonly handleTraceRequest?: DesktopTraceViewerHandler;
}

const decodeRendererMessagePayload = Option.liftThrowable(
  GameConsoleIpc.rendererMessage.decodePayload,
);

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

const parsePositiveInteger = (value: string | null): number | undefined => {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const parseMessageQuery = (url: URL): GameConsoleMessageQuery => {
  const query: {
    generation?: number;
    limit?: number;
    q?: string;
    sinceId?: number;
    username?: string;
    windowId?: number;
  } = {};
  const generation = parsePositiveInteger(url.searchParams.get("generation"));
  const sinceId = parsePositiveInteger(url.searchParams.get("sinceId"));
  const limit = parsePositiveInteger(url.searchParams.get("limit"));
  const windowId = parsePositiveInteger(url.searchParams.get("windowId"));
  const username = url.searchParams.get("username")?.trim();
  const q = url.searchParams.get("q")?.trim();

  if (generation !== undefined) {
    query.generation = generation;
  }
  if (sinceId !== undefined) {
    query.sinceId = sinceId;
  }
  if (limit !== undefined) {
    query.limit = limit;
  }
  if (windowId !== undefined) {
    query.windowId = windowId;
  }
  if (username !== undefined && username.length > 0) {
    query.username = username;
  }
  if (q !== undefined && q.length > 0) {
    query.q = q;
  }

  return query;
};

const writeResponse = (
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void => {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", contentType);
  response.end(body);
};

const writeJson = (
  response: ServerResponse,
  value: unknown,
  status = 200,
): void => {
  writeResponse(
    response,
    status,
    "application/json; charset=utf-8",
    JSON.stringify(value),
  );
};

const dashboardHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        --background: #0e0e0f;
        --border: #262628;
        --control: #202022;
        --control-border: #2e2e31;
        --muted: #a6a6a6;
        --sticky: #121214;
        --sticky-cell: #0e0e0f;
        --text: #f5f5f5;
        --time-column: 7.5rem;
        --username-column: 9rem;
        --window-column: 7rem;
        --header-height: 22px;
        color-scheme: dark;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background: var(--background);
        color: var(--text);
      }
      body {
        background: var(--background);
        margin: 0;
        overflow: hidden;
        padding: 6px;
        box-sizing: border-box;
        height: 100vh;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      header,
      .toolbar {
        align-items: center;
        display: flex;
        gap: 0.375rem;
        padding: 0 6px;
        box-sizing: border-box;
        flex-shrink: 0;
        border: 1px solid var(--border);
        border-radius: 2px;
      }
      header {
        background: var(--background);
        height: 24px;
      }
      .toolbar {
        align-content: center;
        background: var(--sticky);
        flex-wrap: wrap;
        min-height: 32px;
      }
      button,
      input,
      select {
        background: var(--control);
        border: 1px solid var(--control-border);
        border-radius: 2px;
        color: inherit;
        font-family: inherit;
        font-size: 11px;
        padding: 2px 6px;
        height: 22px;
        box-sizing: border-box;
      }
      button {
        cursor: pointer;
        font-weight: 500;
        transition: background-color 100ms, border-color 100ms;
      }
      button:hover {
        background: var(--border);
        border-color: var(--muted);
      }
      input::placeholder {
        color: var(--muted);
        opacity: 0.6;
      }
      .toolbar input#query {
        flex: 1;
        min-width: 150px;
        max-width: 320px;
      }
      .toolbar input#usernameFilter {
        width: 120px;
      }
      .toolbar select#windowFilter {
        width: 110px;
      }
      .toolbar select#generationFilter {
        width: 105px;
      }
      .status {
        color: var(--muted);
        font-size: 11px;
        margin-left: auto;
      }
      header nav {
        display: flex;
        gap: 3px;
      }
      header a {
        border-radius: 2px;
        color: var(--muted);
        font-size: 11px;
        padding: 2px 6px;
        text-decoration: none;
      }
      header a:hover,
      header a[aria-current="page"] {
        background: var(--control);
        color: var(--text);
      }
      :focus-visible {
        outline: 2px solid #8ab4f8;
        outline-offset: 2px;
      }
      main {
        flex: 1;
        min-height: 0;
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: 2px;
        background: var(--background);
      }
      .table {
        display: flex;
        flex-direction: column;
        width: 100%;
        min-width: 100%;
      }
      .thead {
        position: sticky;
        top: 0;
        z-index: 3;
        flex-shrink: 0;
      }
      .row {
        align-items: stretch;
        display: grid;
        grid-template-columns: var(--time-column) var(--window-column) var(--username-column) 1fr;
        box-sizing: border-box;
      }
      .tbody .row {
        border-bottom: 1px solid var(--border);
      }
      .tbody .row.selected .cell {
        box-shadow:
          inset 0 1px 0 var(--muted),
          inset 0 -1px 0 var(--muted);
      }
      .tbody .row.selected .cell:first-child {
        box-shadow:
          inset 1px 0 0 var(--muted),
          inset 0 1px 0 var(--muted),
          inset 0 -1px 0 var(--muted);
      }
      .tbody .row.selected .cell:last-child {
        box-shadow:
          inset -1px 0 0 var(--muted),
          inset 0 1px 0 var(--muted),
          inset 0 -1px 0 var(--muted);
      }
      .cell {
        border-right: 1px solid var(--border);
        padding: 2px 6px;
        text-align: left;
        vertical-align: top;
        box-sizing: border-box;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        line-height: 1.4;
        min-width: 0;
      }
      .tbody .cell {
        min-height: 100%;
      }
      .cell:last-child {
        border-right: none;
      }
      .header-cell {
        background: var(--sticky);
        font-size: 10px;
        color: var(--muted);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        height: var(--header-height);
        line-height: 16px;
        padding: 3px 6px;
        border-bottom: 1px solid var(--border);
      }
      .row .cell:nth-child(1) {
        position: sticky;
        left: 0;
        z-index: 1;
      }
      .row .cell:nth-child(2) {
        position: sticky;
        left: var(--time-column);
        z-index: 1;
      }
      .row .cell:nth-child(3) {
        position: sticky;
        left: calc(var(--time-column) + var(--window-column));
        z-index: 1;
      }
      .tbody .row .cell:nth-child(-n + 3) {
        position: sticky;
        background: var(--sticky-cell);
        z-index: 2;
      }
      .header-row .cell:nth-child(-n + 3) {
        z-index: 4;
      }
      .header-row .cell:nth-child(4) {
        z-index: 3;
      }
      .window,
      .time,
      .username {
        white-space: nowrap;
      }
      .pinned-cell-content {
        display: block;
        position: sticky;
        top: calc(var(--header-height) + 2px);
      }
      .message {
        display: grid;
        gap: 6px;
        grid-template-columns: auto minmax(0, 1fr);
        white-space: normal;
      }
      .message-text {
        white-space: pre-wrap;
        word-break: break-word;
      }
      .copy-message {
        align-self: start;
        height: 18px;
        padding: 0 5px;
        position: sticky;
        top: calc(var(--header-height) + 2px);
        width: 48px;
      }
      button[aria-pressed="true"] {
        border-color: var(--muted);
      }
    </style>
  </head>
  <body>
    <header>
      <nav aria-label="Observability views">
        <a href="/" aria-current="page">Console</a>
        <a href="/traces">Traces</a>
      </nav>
      <div class="status" id="status">Connecting...</div>
    </header>
    <section class="toolbar">
      <input id="query" placeholder="Search messages" />
      <select id="windowFilter">
        <option value="">All windows</option>
      </select>
      <select id="generationFilter" disabled>
        <option value="">All generations</option>
      </select>
      <input id="usernameFilter" placeholder="Username" />
      <button id="prevLog" title="Previous log entry">Prev</button>
      <button id="nextLog" title="Next log entry">Next</button>
      <button id="pause">Pause</button>
      <button id="autoscroll" aria-pressed="true">Auto-scroll: On</button>
      <button id="copy">Copy All</button>
    </section>
    <main>
      <div class="table">
        <div class="thead">
          <div class="row header-row">
            <div class="cell header-cell">Time</div>
            <div class="cell header-cell">Window · Gen</div>
            <div class="cell header-cell">Username</div>
            <div class="cell header-cell">Message</div>
          </div>
        </div>
        <div id="rows" class="tbody"></div>
      </div>
    </main>
    <script>
      const mainEl = document.querySelector("main");
      const rowsEl = document.getElementById("rows");
      const statusEl = document.getElementById("status");
      const queryEl = document.getElementById("query");
      const windowFilterEl = document.getElementById("windowFilter");
      const generationFilterEl = document.getElementById("generationFilter");
      const usernameFilterEl = document.getElementById("usernameFilter");
      const prevLogEl = document.getElementById("prevLog");
      const nextLogEl = document.getElementById("nextLog");
      const pauseEl = document.getElementById("pause");
      const autoscrollEl = document.getElementById("autoscroll");
      const copyEl = document.getElementById("copy");
      let autoScroll = true;
      let bufferMaxRows = 5000;
      let hasConnectedEvents = false;
      let paused = false;
      let lastId = 0;
      let reloadOnEventsReconnect = false;
      let rows = [];
      let selectedRowId = null;
      let windowStates = [];

      const formatTime = (value) => {
        const date = new Date(value);
        const parts = new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        }).formatToParts(date);
        const period = parts.find((part) => part.type === "dayPeriod")?.value;
        const time = parts
          .filter((part) => part.type !== "dayPeriod")
          .map((part) => part.value)
          .join("")
          .trim();
        const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
        return time + "." + milliseconds + (period ? " " + period : "");
      };

      const copyText = async (text) => {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return;
        }

        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      };

      const params = () => {
        const search = new URLSearchParams();
        if (queryEl.value.trim()) search.set("q", queryEl.value.trim());
        if (windowFilterEl.value) search.set("windowId", windowFilterEl.value);
        if (windowFilterEl.value && generationFilterEl.value) {
          search.set("generation", generationFilterEl.value);
        }
        if (usernameFilterEl.value.trim()) search.set("username", usernameFilterEl.value.trim());
        return search.toString();
      };

      const rowMatchesFilters = (row) => {
        const query = queryEl.value.trim().toLowerCase();
        const username = usernameFilterEl.value.trim().toLowerCase();
        const windowId = windowFilterEl.value;
        const generation = generationFilterEl.value;
        if (windowId && String(row.gameWindowId) !== windowId) return false;
        if (windowId && generation && String(row.generation) !== generation) return false;
        if (username && (row.username ?? "").toLowerCase() !== username) return false;
        return !query || row.message.toLowerCase().includes(query);
      };

      const scrollToBottom = () => {
        if (mainEl) mainEl.scrollTop = mainEl.scrollHeight;
      };

      const logHeaderOffset = () => {
        const source = getComputedStyle(document.documentElement)
          .getPropertyValue("--header-height")
          .trim();
        const parsed = Number.parseFloat(source);
        return Number.isFinite(parsed) ? parsed : 22;
      };

      const setAutoScroll = (value) => {
        autoScroll = value;
        updateAutoscrollButton();
      };

      const updateAutoscrollButton = () => {
        autoscrollEl.textContent = autoScroll ? "Auto-scroll: On" : "Auto-scroll: Off";
        autoscrollEl.setAttribute("aria-pressed", String(autoScroll));
      };

      const renderedRows = () => Array.from(rowsEl.children);

      const selectedRenderedRowIndex = () =>
        selectedRowId === null
          ? -1
          : renderedRows().findIndex(
              (row) => Number(row.dataset.rowId) === selectedRowId,
            );

      const updateSelectedRowClass = () => {
        for (const row of renderedRows()) {
          row.classList.toggle(
            "selected",
            selectedRowId !== null && Number(row.dataset.rowId) === selectedRowId,
          );
        }
      };

      const currentRowIndex = () => {
        const rowElements = renderedRows();
        if (rowElements.length === 0 || !mainEl) return -1;

        const viewportTop =
          mainEl.getBoundingClientRect().top + logHeaderOffset() + 3;
        for (let index = 0; index < rowElements.length; index += 1) {
          const row = rowElements[index];
          if (row.getBoundingClientRect().bottom > viewportTop) {
            return index;
          }
        }

        return rowElements.length - 1;
      };

      const scrollToRowIndex = (index) => {
        const rowElements = renderedRows();
        const row = rowElements[index];
        if (!row || !mainEl) return;

        const mainTop = mainEl.getBoundingClientRect().top;
        const rowTop = row.getBoundingClientRect().top;
        mainEl.scrollTop = Math.max(
          0,
          mainEl.scrollTop + rowTop - mainTop - logHeaderOffset(),
        );
      };

      const selectRowIndex = (index, shouldScroll) => {
        const rowElements = renderedRows();
        const row = rowElements[index];
        if (!row) return;

        selectedRowId = Number(row.dataset.rowId);
        updateSelectedRowClass();
        if (shouldScroll) scrollToRowIndex(index);
      };

      const scrollToAdjacentLog = (direction) => {
        const rowElements = renderedRows();
        if (rowElements.length === 0) return;

        setAutoScroll(false);
        const selectedIndex = selectedRenderedRowIndex();
        const fallbackIndex = currentRowIndex();
        const baseIndex = selectedIndex === -1 ? fallbackIndex : selectedIndex;
        if (baseIndex === -1) return;

        const delta = direction === "next" ? 1 : -1;
        selectRowIndex(
          Math.max(0, Math.min(rowElements.length - 1, baseIndex + delta)),
          true,
        );
      };

      const createRow = (row) => {
        const divRow = document.createElement("div");
        divRow.className = "row";
        divRow.dataset.rowId = String(row.id);
        divRow.classList.toggle("selected", selectedRowId === row.id);
        divRow.addEventListener("click", () => {
          selectedRowId = row.id;
          updateSelectedRowClass();
        });

        const createPinnedCell = (className, value, title) => {
          const cell = document.createElement("div");
          cell.className = "cell " + className;
          if (title) cell.title = title;
          const content = document.createElement("span");
          content.className = "pinned-cell-content";
          content.textContent = value;
          cell.appendChild(content);
          return cell;
        };

        divRow.appendChild(createPinnedCell("time", formatTime(row.at), row.at));
        divRow.appendChild(
          createPinnedCell(
            "window",
            row.gameWindowId + " · g" + row.generation,
          ),
        );
        divRow.appendChild(createPinnedCell("username", row.username ?? ""));

        const messageCell = document.createElement("div");
        messageCell.className = "cell message";
        const copyMessageButton = document.createElement("button");
        copyMessageButton.className = "copy-message";
        copyMessageButton.type = "button";
        copyMessageButton.textContent = "Copy";
        copyMessageButton.title = "Copy message";
        copyMessageButton.addEventListener("click", async (event) => {
          event.stopPropagation();
          try {
            await copyText(row.message);
            copyMessageButton.textContent = "Copied";
            window.setTimeout(() => {
              copyMessageButton.textContent = "Copy";
            }, 900);
          } catch {
            copyMessageButton.textContent = "Failed";
            window.setTimeout(() => {
              copyMessageButton.textContent = "Copy";
            }, 1200);
          }
        });
        const messageText = document.createElement("div");
        messageText.className = "message-text";
        messageText.textContent = row.message;
        messageCell.appendChild(copyMessageButton);
        messageCell.appendChild(messageText);
        divRow.appendChild(messageCell);

        return divRow;
      };

      const trimRenderedRows = () => {
        while (rows.length > bufferMaxRows) {
          const removed = rows.shift();
          if (removed?.id === selectedRowId) {
            selectedRowId = null;
          }
          rowsEl.firstElementChild?.remove();
        }
      };

      const renderRows = () => {
        if (!rows.some((row) => row.id === selectedRowId)) {
          selectedRowId = null;
        }
        rowsEl.textContent = "";
        const fragment = document.createDocumentFragment();
        for (const row of rows) {
          fragment.appendChild(createRow(row));
        }
        rowsEl.appendChild(fragment);
        if (autoScroll) scrollToBottom();
      };

      const refreshGenerationFilter = (reset = false) => {
        const selected = reset ? "" : generationFilterEl.value;
        const windowState = windowStates.find(
          (state) => String(state.gameWindowId) === windowFilterEl.value,
        );
        generationFilterEl.textContent = "";
        const all = document.createElement("option");
        all.value = "";
        all.textContent = "All generations";
        generationFilterEl.appendChild(all);
        generationFilterEl.disabled = windowState === undefined;
        if (windowState === undefined) return;

        for (
          let generation = 1;
          generation <= windowState.generation;
          generation += 1
        ) {
          const option = document.createElement("option");
          option.value = String(generation);
          option.textContent = "Generation " + generation;
          generationFilterEl.appendChild(option);
        }
        generationFilterEl.value = selected;
      };

      const refreshWindows = async () => {
        const state = await fetch("/api/state").then((response) => response.json());
        windowStates = state.windows;
        const selected = windowFilterEl.value;
        windowFilterEl.textContent = "";
        const all = document.createElement("option");
        all.value = "";
        all.textContent = "All windows";
        windowFilterEl.appendChild(all);
        for (const windowState of state.windows) {
          const option = document.createElement("option");
          option.value = String(windowState.gameWindowId);
          option.textContent =
            windowState.gameWindowId +
            " · g" +
            windowState.generation +
            " (" +
            windowState.state +
            ")";
          windowFilterEl.appendChild(option);
        }
        windowFilterEl.value = selected;
        refreshGenerationFilter();
        bufferMaxRows = state.buffer.maxRows;
        statusEl.textContent = state.activeGameWindowCount + " active window(s), " + state.buffer.size + " buffered message(s)";
      };

      const refreshMessages = async () => {
        const suffix = params();
        rows = await fetch("/api/messages" + (suffix ? "?" + suffix : "")).then((response) => response.json());
        lastId = rows.reduce((id, row) => Math.max(id, row.id), lastId);
        renderRows();
      };

      const appendRow = (row) => {
        lastId = Math.max(lastId, row.id);
        if (paused) return;
        if (!rowMatchesFilters(row)) return;
        rows.push(row);
        rowsEl.appendChild(createRow(row));
        trimRenderedRows();
        if (autoScroll) scrollToBottom();
      };

      queryEl.addEventListener("input", refreshMessages);
      windowFilterEl.addEventListener("change", () => {
        refreshGenerationFilter(true);
        refreshMessages();
      });
      generationFilterEl.addEventListener("change", refreshMessages);
      usernameFilterEl.addEventListener("input", refreshMessages);
      prevLogEl.addEventListener("click", () => {
        scrollToAdjacentLog("previous");
      });
      nextLogEl.addEventListener("click", () => {
        scrollToAdjacentLog("next");
      });
      pauseEl.addEventListener("click", () => {
        paused = !paused;
        pauseEl.textContent = paused ? "Resume" : "Pause";
        if (!paused) refreshMessages();
      });
      autoscrollEl.addEventListener("click", () => {
        setAutoScroll(!autoScroll);
        if (autoScroll) scrollToBottom();
      });
      copyEl.addEventListener("click", async () => {
        const text = rows.map((row) => JSON.stringify(row)).join("\\n") + (rows.length ? "\\n" : "");
        await copyText(text);
      });

      const connect = () => {
        const events = new EventSource("/events");
        events.addEventListener("open", () => {
          if (reloadOnEventsReconnect) {
            statusEl.textContent = "Reconnected; refreshing...";
            window.location.reload();
            return;
          }

          hasConnectedEvents = true;
          statusEl.textContent = "Connected";
        });
        events.addEventListener("message", (event) => {
          appendRow(JSON.parse(event.data));
        });
        events.addEventListener("window-opened", refreshWindows);
        events.addEventListener("window-closed", refreshWindows);
        events.addEventListener("window-generation", refreshWindows);
        events.addEventListener("session-updated", refreshWindows);
        events.addEventListener("error", () => {
          if (hasConnectedEvents) {
            reloadOnEventsReconnect = true;
            statusEl.textContent = "Disconnected; refreshing when server returns...";
          } else {
            statusEl.textContent = "Disconnected; retrying...";
          }
        });
      };

      refreshWindows();
      refreshMessages();
      updateAutoscrollButton();
      connect();
    </script>
  </body>
</html>
`;

/**
 * Local observability routes served only on 127.0.0.1 when `--debug` is enabled.
 *
 * - `/` renders the live dashboard.
 * - `/api/messages` returns JSON console rows. Each row has only `id`, `at`,
 *   `gameWindowId`, `generation`, `username`, and `message`; `at` is ISO-8601
 *   with millisecond precision. Optional filters: `sinceId`, `limit`,
 *   `windowId`, `generation`, `username`, and `q`.
 * - `/api/messages.ndjson` returns the same filtered rows as newline-delimited
 *   JSON for agents and shell tools.
 * - `/api/state` returns buffer stats and active/closed game-window state.
 * - `/traces` renders the trace waterfall and `/api/traces` reads its spans
 *   from the existing rotating log on demand. `/trace-events` streams new
 *   spans while a viewer is connected.
 * - `/events` streams new messages and window/session updates with SSE.
 * - `/health` returns a small health/status payload.
 */
export const createGameConsoleHttpHandler =
  (
    store: GameConsoleStore,
    options: GameConsoleHttpHandlerOptions = {},
  ): ((request: IncomingMessage, response: ServerResponse) => void) =>
  (request, response) => {
    if (request.method !== "GET") {
      writeJson(response, { error: "Method not allowed" }, 405);
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (options.handleTraceRequest?.(request, response, url) === true) {
      return;
    }
    switch (url.pathname) {
      case "/":
        writeResponse(response, 200, "text/html; charset=utf-8", dashboardHtml);
        return;
      case "/api/messages":
        writeJson(response, store.queryMessages(parseMessageQuery(url)));
        return;
      case "/api/messages.ndjson":
        writeResponse(
          response,
          200,
          "application/x-ndjson; charset=utf-8",
          messagesToNdjson(store.queryMessages(parseMessageQuery(url))),
        );
        return;
      case "/api/state":
        writeJson(response, store.state());
        return;
      case "/events": {
        response.statusCode = 200;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Connection", "keep-alive");
        response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        response.write(": connected\n\n");
        const remove = options.addSseClient?.(response);
        request.on("close", () => {
          remove?.();
        });
        return;
      }
      case "/health": {
        const state = store.state();
        writeJson(response, {
          ok: true,
          activeGameWindowCount: state.activeGameWindowCount,
          buffer: state.buffer,
        });
        return;
      }
      default:
        writeJson(response, { error: "Not found" }, 404);
        return;
    }
  };

export const sendSseEvent = (
  response: ServerResponse,
  event: string,
  data: unknown,
): void => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
};

const startHttpServer = (
  server: Server,
  port: number,
): Promise<GameConsoleObservabilityInstall> =>
  new Promise((resolve, reject) => {
    const rejectOnce = (cause: unknown): void => {
      server.removeListener("listening", resolveOnce);
      reject(cause);
    };
    const resolveOnce = (): void => {
      server.removeListener("error", rejectOnce);
      const address = server.address();
      const resolvedPort =
        typeof address === "object" && address !== null ? address.port : port;
      resolve({
        port: resolvedPort,
        url: `http://127.0.0.1:${resolvedPort}`,
      });
    };

    server.once("error", rejectOnce);
    server.once("listening", resolveOnce);
    server.listen(port, "127.0.0.1");
  });

export interface GameConsoleObservabilityShape {
  readonly install: (
    options: GameConsoleObservabilityOptions,
  ) => Effect.Effect<
    GameConsoleObservabilityInstall,
    GameConsoleObservabilityStartError,
    Scope.Scope
  >;
}

export class GameConsoleObservability extends Context.Service<
  GameConsoleObservability,
  GameConsoleObservabilityShape
>()("lucent/desktop/app/GameConsoleObservability") {}

const makeGameConsoleObservability = Effect.gen(function* () {
  const accounts = yield* Accounts;
  const observability = yield* DesktopObservability;
  const windows = yield* DesktopWindows;

  const install: GameConsoleObservabilityShape["install"] = (options) =>
    Effect.gen(function* () {
      const store = makeGameConsoleStore();
      const sseClients = new Set<ServerResponse>();
      const publish = (event: string, data: unknown): void => {
        for (const client of sseClients) {
          sendSseEvent(client, event, data);
        }
      };
      const applyAccountState = (state: AccountManagerState): void => {
        for (const windowState of store.updateSessions(
          sessionsFromAccountState(state),
        )) {
          publish("session-updated", windowState);
        }
      };
      const context = yield* Effect.context<never>();
      const runPromise = Effect.runPromiseWith(context);
      const handleRendererMessage = (
        event: IpcMainEvent,
        rawPayload: unknown,
      ): void => {
        const decodedPayload = decodeRendererMessagePayload(rawPayload);
        if (Option.isNone(decodedPayload)) {
          return;
        }
        const payload = decodedPayload.value;

        const rendererId = event.sender.id;

        void runPromise(
          windows.getRendererKind(rendererId).pipe(
            Effect.flatMap((kind) =>
              kind === "game"
                ? observability
                    .record({
                      component: "renderer",
                      event: "console",
                      data: {
                        message: payload.message,
                        rendererId,
                        view: kind,
                      },
                    })
                    .pipe(
                      Effect.flatMap(() =>
                        Effect.sync(() => {
                          const row = store.appendMessage({
                            gameWindowId: rendererId,
                            message: payload.message,
                          });
                          publish("message", row);
                        }),
                      ),
                    )
                : Effect.void,
            ),
            Effect.catch(() => Effect.void),
          ),
        ).catch(() => undefined);
      };

      const unsubscribeCreated = yield* windows.onCreated((event) => {
        if (event.kind !== "game") {
          return Effect.void;
        }

        return Effect.sync(() => {
          const windowState = store.openWindow(
            event.rendererId,
            undefined,
            event.generation,
          );
          publish("window-opened", windowState);
        });
      });
      const unsubscribeReloaded = yield* windows.onRendererReloaded((event) => {
        if (event.kind !== "game") {
          return Effect.void;
        }

        return Effect.sync(() => {
          const windowState = store.beginWindowGeneration(
            event.rendererId,
            event.generation,
          );
          publish("window-generation", windowState);
        });
      });
      const unsubscribeClosed = yield* windows.onClosed((event) => {
        if (event.kind !== "game") {
          return Effect.void;
        }

        return Effect.sync(() => {
          const windowState = store.closeWindow(event.rendererId);
          publish("window-closed", windowState);
        });
      });
      const initialState = yield* accounts.getState.pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      if (initialState !== null) {
        yield* Effect.sync(() => {
          applyAccountState(initialState);
        });
      }
      const unsubscribeAccounts = yield* accounts.onChanged((state) => {
        applyAccountState(state);
      });
      yield* Effect.sync(() => {
        ipcMain.on(
          GameConsoleIpc.rendererMessage.channel,
          handleRendererMessage,
        );
      });

      const traceViewer = makeDesktopTraceViewer(observability.logFilePath);
      const unsubscribeTraces = observability.subscribe((record) => {
        if (record.component === "trace" && record.event === "span.completed") {
          traceViewer.publish(record.data);
        }
      });
      const server = createServer(
        createGameConsoleHttpHandler(store, {
          addSseClient: (response) => {
            sseClients.add(response);
            return () => {
              sseClients.delete(response);
            };
          },
          handleTraceRequest: traceViewer.handle,
        }),
      );
      let cleanedUp = false;
      const cleanup = (): void => {
        if (cleanedUp) {
          return;
        }

        cleanedUp = true;
        ipcMain.removeListener(
          GameConsoleIpc.rendererMessage.channel,
          handleRendererMessage,
        );
        unsubscribeAccounts();
        unsubscribeClosed();
        unsubscribeCreated();
        unsubscribeReloaded();
        unsubscribeTraces();
        traceViewer.close();
        for (const client of sseClients) {
          client.end();
        }
        sseClients.clear();
        try {
          server.close();
        } catch {}
      };
      const installed = yield* Effect.tryPromise({
        try: () => startHttpServer(server, options.port),
        catch: (cause) =>
          new GameConsoleObservabilityStartError({
            cause,
            port: options.port,
          }),
      }).pipe(Effect.tapError(() => Effect.sync(cleanup)));

      console.info(
        `[observability] Game console observability listening on ${installed.url}`,
      );
      yield* observability.info(
        "game-console",
        "Game console observability listening",
        {
          port: installed.port,
          url: installed.url,
        },
      );

      yield* Effect.addFinalizer(() => Effect.sync(cleanup));

      return installed;
    });

  return GameConsoleObservability.of({ install });
});

export const layer = Layer.effect(
  GameConsoleObservability,
  makeGameConsoleObservability,
);
