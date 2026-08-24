import * as React from "react";

import {
  EMPTY_CONSOLE_FILTERS,
  mergeConsoleMessage,
  messageMatchesConsoleFilters,
  trimConsoleMessages,
  type ConsoleConnectionStatus,
  type ConsoleFilters,
  type GameConsoleMessage,
  type GameConsoleState,
} from "@/console-model";
import { consoleTransport, type ConsoleTransport } from "@/console-transport";

const DEFAULT_MAX_ROWS = 5_000;

export interface ConsoleDashboardData {
  readonly autoScroll: boolean;
  readonly clearFilters: () => void;
  readonly connectionStatus: ConsoleConnectionStatus;
  readonly error: string | null;
  readonly filters: ConsoleFilters;
  readonly loadingMessages: boolean;
  readonly loadingState: boolean;
  readonly messages: readonly GameConsoleMessage[];
  readonly paused: boolean;
  readonly refresh: () => Promise<void>;
  readonly selectedMessageId: number | null;
  readonly setAutoScroll: (value: boolean) => void;
  readonly setGeneration: (generation: number | null) => void;
  readonly setQuery: (query: string) => void;
  readonly setSelectedMessageId: (id: number | null) => void;
  readonly setUsername: (username: string) => void;
  readonly setWindowId: (windowId: number | null) => void;
  readonly state: GameConsoleState | null;
  readonly togglePaused: () => void;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

export function useConsole(
  transport: ConsoleTransport = consoleTransport,
): ConsoleDashboardData {
  const [messages, setMessages] = React.useState<readonly GameConsoleMessage[]>(
    [],
  );
  const [state, setState] = React.useState<GameConsoleState | null>(null);
  const [filters, setFiltersState] = React.useState(EMPTY_CONSOLE_FILTERS);
  const [paused, setPaused] = React.useState(false);
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [selectedMessageId, setSelectedMessageId] = React.useState<
    number | null
  >(null);
  const [connectionStatus, setConnectionStatus] =
    React.useState<ConsoleConnectionStatus>("connecting");
  const [loadingMessages, setLoadingMessages] = React.useState(true);
  const [loadingState, setLoadingState] = React.useState(true);
  const [messagesError, setMessagesError] = React.useState<string | null>(null);
  const [stateError, setStateError] = React.useState<string | null>(null);

  const filtersRef = React.useRef(filters);
  const pausedRef = React.useRef(paused);
  const maxRowsRef = React.useRef(DEFAULT_MAX_ROWS);
  const messageRequestRef = React.useRef(0);
  const stateRequestRef = React.useRef(0);

  const updateFilters = React.useCallback(
    (update: (current: ConsoleFilters) => ConsoleFilters) => {
      const next = update(filtersRef.current);
      filtersRef.current = next;
      setFiltersState(next);
    },
    [],
  );

  const loadMessages = React.useCallback(
    async (nextFilters: ConsoleFilters, signal?: AbortSignal) => {
      const request = messageRequestRef.current + 1;
      messageRequestRef.current = request;
      setLoadingMessages(true);
      setMessagesError(null);

      try {
        const nextMessages = await transport.readMessages(nextFilters, signal);
        if (signal?.aborted || messageRequestRef.current !== request) {
          return;
        }
        setMessages(trimConsoleMessages(nextMessages, maxRowsRef.current));
      } catch (cause) {
        if (!isAbortError(cause) && messageRequestRef.current === request) {
          setMessagesError(errorMessage(cause));
        }
      } finally {
        if (signal?.aborted !== true && messageRequestRef.current === request) {
          setLoadingMessages(false);
        }
      }
    },
    [transport],
  );

  const loadState = React.useCallback(
    async (signal?: AbortSignal) => {
      const request = stateRequestRef.current + 1;
      stateRequestRef.current = request;
      setLoadingState(true);
      setStateError(null);

      try {
        const nextState = await transport.readState(signal);
        if (signal?.aborted || stateRequestRef.current !== request) {
          return;
        }
        maxRowsRef.current = nextState.buffer.maxRows;
        setState(nextState);
        setMessages((current) =>
          trimConsoleMessages(current, nextState.buffer.maxRows),
        );
      } catch (cause) {
        if (!isAbortError(cause) && stateRequestRef.current === request) {
          setStateError(errorMessage(cause));
        }
      } finally {
        if (signal?.aborted !== true && stateRequestRef.current === request) {
          setLoadingState(false);
        }
      }
    },
    [transport],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadMessages(filters, controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, loadMessages]);

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadState(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadState]);

  React.useEffect(
    () =>
      transport.subscribe({
        onConnectionChange: setConnectionStatus,
        onMessage: (message) => {
          if (
            pausedRef.current ||
            !messageMatchesConsoleFilters(message, filtersRef.current)
          ) {
            return;
          }
          setMessages((current) =>
            mergeConsoleMessage(current, message, maxRowsRef.current),
          );
        },
        onReconnect: () => {
          void loadState();
          void loadMessages(filtersRef.current);
        },
        onStateInvalidated: () => {
          void loadState();
        },
      }),
    [loadMessages, loadState, transport],
  );

  const setQuery = React.useCallback(
    (query: string) => updateFilters((current) => ({ ...current, query })),
    [updateFilters],
  );

  const setUsername = React.useCallback(
    (username: string) =>
      updateFilters((current) => ({ ...current, username })),
    [updateFilters],
  );

  const setWindowId = React.useCallback(
    (windowId: number | null) =>
      updateFilters((current) => ({
        ...current,
        generation: null,
        windowId,
      })),
    [updateFilters],
  );

  const setGeneration = React.useCallback(
    (generation: number | null) =>
      updateFilters((current) => ({ ...current, generation })),
    [updateFilters],
  );

  const clearFilters = React.useCallback(() => {
    filtersRef.current = EMPTY_CONSOLE_FILTERS;
    setFiltersState(EMPTY_CONSOLE_FILTERS);
  }, []);

  const refresh = React.useCallback(
    async () =>
      Promise.all([loadMessages(filtersRef.current), loadState()]).then(
        () => undefined,
      ),
    [loadMessages, loadState],
  );

  const togglePaused = React.useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (!next) {
      void loadMessages(filtersRef.current);
    }
  }, [loadMessages]);

  const visibleSelectedMessageId =
    selectedMessageId !== null &&
    messages.some((message) => message.id === selectedMessageId)
      ? selectedMessageId
      : null;

  return {
    autoScroll,
    clearFilters,
    connectionStatus,
    error: messagesError ?? stateError,
    filters,
    loadingMessages,
    loadingState,
    messages,
    paused,
    refresh,
    selectedMessageId: visibleSelectedMessageId,
    setAutoScroll,
    setGeneration,
    setQuery,
    setSelectedMessageId,
    setUsername,
    setWindowId,
    state,
    togglePaused,
  };
}
