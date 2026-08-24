import * as React from "react";

import {
  mergeTraceSpans,
  sortTraceSpans,
  traceKey,
  type DesktopTraceResponse,
  type DesktopTraceSpan,
} from "@/trace-model";

type LiveStatus =
  | "Connecting live stream"
  | "Live"
  | "Live stream reconnecting";

interface TraceSnapshot {
  readonly recordingStartedAt: string | null;
  readonly spans: readonly DesktopTraceSpan[];
  readonly truncated: boolean;
}

export interface TraceViewerData extends TraceSnapshot {
  readonly error: string | null;
  readonly liveStatus: LiveStatus;
  readonly loading: boolean;
  readonly refresh: () => Promise<void>;
}

const EMPTY_SNAPSHOT: TraceSnapshot = {
  recordingStartedAt: null,
  spans: [],
  truncated: false,
};

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

export function useTraces(): TraceViewerData {
  const [snapshot, setSnapshot] = React.useState(EMPTY_SNAPSHOT);
  const [error, setError] = React.useState<string | null>(null);
  const [liveStatus, setLiveStatus] = React.useState<LiveStatus>(
    "Connecting live stream",
  );
  const [loading, setLoading] = React.useState(true);
  const latestRequest = React.useRef(0);

  const loadHistory = React.useCallback(async (signal?: AbortSignal) => {
    const request = latestRequest.current + 1;
    latestRequest.current = request;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/traces", {
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as DesktopTraceResponse;
      if (signal?.aborted === true || latestRequest.current !== request) {
        return;
      }

      setSnapshot((current) => {
        const spans =
          current.recordingStartedAt === payload.recordingStartedAt
            ? mergeTraceSpans(payload.spans, current.spans)
            : sortTraceSpans(payload.spans);

        return {
          recordingStartedAt: payload.recordingStartedAt,
          spans,
          truncated: payload.truncated,
        };
      });
    } catch (cause) {
      if (!isAbort(cause) && latestRequest.current === request) {
        setError(errorMessage(cause));
      }
    } finally {
      if (signal?.aborted !== true && latestRequest.current === request) {
        setLoading(false);
      }
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    let events: EventSource | null = null;
    let flushTimer: number | null = null;
    let startTimer: number | null = null;
    const pending = new Map<string, DesktopTraceSpan>();

    const flush = () => {
      flushTimer = null;
      if (pending.size === 0) {
        return;
      }
      const batch = [...pending.values()];
      pending.clear();
      setSnapshot((current) => ({
        ...current,
        spans: mergeTraceSpans(current.spans, batch),
      }));
    };

    const connect = () => {
      if (controller.signal.aborted) {
        return;
      }

      events = new EventSource("/trace-events");
      events.addEventListener("span", (event) => {
        if (!(event instanceof MessageEvent)) {
          return;
        }
        try {
          const span = JSON.parse(event.data) as DesktopTraceSpan;
          pending.set(traceKey(span), span);
          flushTimer ??= window.setTimeout(flush, 50);
        } catch {
          // Ignore an isolated malformed event and keep the reconnecting stream alive.
        }
      });
      events.addEventListener("open", () => setLiveStatus("Live"));
      events.addEventListener("error", () =>
        setLiveStatus("Live stream reconnecting"),
      );
    };

    startTimer = window.setTimeout(() => {
      startTimer = null;
      void loadHistory(controller.signal).finally(connect);
    }, 0);

    return () => {
      controller.abort();
      events?.close();
      if (startTimer !== null) {
        window.clearTimeout(startTimer);
      }
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
      }
    };
  }, [loadHistory]);

  const refresh = React.useCallback(() => loadHistory(), [loadHistory]);

  return {
    ...snapshot,
    error,
    liveStatus,
    loading,
    refresh,
  };
}
