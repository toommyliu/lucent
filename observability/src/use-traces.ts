import * as React from "react";

import {
  DESKTOP_TRACE_MAX_SPANS,
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
        const sameRecording =
          current.recordingStartedAt === payload.recordingStartedAt;
        const spans = sameRecording
          ? mergeTraceSpans(payload.spans, current.spans)
          : sortTraceSpans(payload.spans);

        return {
          recordingStartedAt: payload.recordingStartedAt,
          spans,
          truncated:
            payload.truncated ||
            payload.spans.length > DESKTOP_TRACE_MAX_SPANS ||
            (sameRecording && current.truncated),
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
    let flushTimer: number | null = null;
    let pendingTruncated = false;
    const pending = new Map<string, DesktopTraceSpan>();

    const clearPending = () => {
      pending.clear();
      pendingTruncated = false;
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
    };

    const flush = () => {
      flushTimer = null;
      if (pending.size === 0) {
        return;
      }
      const batch = [...pending.values()];
      const batchTruncated = pendingTruncated;
      pending.clear();
      pendingTruncated = false;
      setSnapshot((current) => {
        const spans = mergeTraceSpans(current.spans, batch);
        return {
          ...current,
          spans,
          truncated:
            current.truncated ||
            batchTruncated ||
            current.spans.length + batch.length > DESKTOP_TRACE_MAX_SPANS,
        };
      });
    };

    const events = new EventSource("/trace-events");
    events.addEventListener("snapshot", (event) => {
      if (!(event instanceof MessageEvent)) {
        return;
      }
      try {
        const payload = JSON.parse(event.data) as DesktopTraceResponse;
        latestRequest.current += 1;
        clearPending();
        const spans = sortTraceSpans(payload.spans);
        setSnapshot({
          recordingStartedAt: payload.recordingStartedAt,
          spans,
          truncated:
            payload.truncated || payload.spans.length > DESKTOP_TRACE_MAX_SPANS,
        });
        setError(null);
        setLoading(false);
      } catch {
        setError("The live trace snapshot was invalid. Refresh to try again.");
        setLoading(false);
      }
    });
    events.addEventListener("span", (event) => {
      if (!(event instanceof MessageEvent)) {
        return;
      }
      try {
        const span = JSON.parse(event.data) as DesktopTraceSpan;
        const key = traceKey(span);
        if (!pending.has(key) && pending.size >= DESKTOP_TRACE_MAX_SPANS) {
          const oldestKey = pending.keys().next().value;
          if (oldestKey !== undefined) {
            pending.delete(oldestKey);
            pendingTruncated = true;
          }
        }
        pending.set(key, span);
        flushTimer ??= window.setTimeout(flush, 50);
      } catch {
        // Ignore an isolated malformed event and keep the reconnecting stream alive.
      }
    });
    events.addEventListener("open", () => setLiveStatus("Live"));
    events.addEventListener("error", () =>
      setLiveStatus("Live stream reconnecting"),
    );

    return () => {
      latestRequest.current += 1;
      events.close();
      clearPending();
    };
  }, []);

  const refresh = React.useCallback(() => loadHistory(), [loadHistory]);

  return {
    ...snapshot,
    error,
    liveStatus,
    loading,
    refresh,
  };
}
