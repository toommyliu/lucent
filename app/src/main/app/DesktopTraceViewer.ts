import { promises as fs } from "fs";
import type { IncomingMessage, ServerResponse } from "http";

import type { DesktopTraceSpan } from "../../shared/ipc";

const MAX_TRACE_SPANS = 20_000;

interface DesktopTraceResponse {
  readonly recordingStartedAt: string | null;
  readonly spans: readonly DesktopTraceSpan[];
  readonly truncated: boolean;
}

const isMissingFileError = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause as NodeJS.ErrnoException).code === "ENOENT";

const readLogFile = async (path: string): Promise<string> => {
  try {
    return await fs.readFile(path, "utf8");
  } catch (cause) {
    if (isMissingFileError(cause)) {
      return "";
    }
    throw cause;
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isTraceSpan = (value: unknown): value is DesktopTraceSpan =>
  isObject(value) &&
  typeof value["name"] === "string" &&
  typeof value["traceId"] === "string" &&
  typeof value["spanId"] === "string" &&
  typeof value["startTimeUnixNano"] === "string" &&
  typeof value["endTimeUnixNano"] === "string" &&
  typeof value["durationMs"] === "number" &&
  isObject(value["attributes"]) &&
  Array.isArray(value["events"]) &&
  Array.isArray(value["links"]) &&
  isObject(value["exit"]);

const parseTraceRecords = (
  sources: readonly string[],
): DesktopTraceResponse => {
  const spans: DesktopTraceSpan[] = [];
  let recordingStartedAt: string | null = null;
  let truncated = false;

  for (const source of sources) {
    for (const line of source.split("\n")) {
      if (line.length === 0) {
        continue;
      }
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isObject(record)) {
        continue;
      }
      if (record["event"] === "recording.started") {
        recordingStartedAt =
          typeof record["at"] === "string" ? record["at"] : recordingStartedAt;
        spans.length = 0;
        truncated = false;
        continue;
      }
      if (
        record["component"] !== "trace" ||
        record["event"] !== "span.completed" ||
        !isTraceSpan(record["data"])
      ) {
        continue;
      }
      if (spans.length >= MAX_TRACE_SPANS) {
        truncated = true;
        continue;
      }
      spans.push(record["data"]);
    }
  }

  return {
    recordingStartedAt,
    spans,
    truncated: truncated || recordingStartedAt === null,
  };
};

const loadLatestTraces = async (
  logFilePath: string,
): Promise<DesktopTraceResponse> => {
  const current = await readLogFile(logFilePath);
  if (current.includes('"event":"recording.started"')) {
    return parseTraceRecords([current]);
  }

  const previous = await readLogFile(`${logFilePath}.1`);
  return parseTraceRecords([previous, current]);
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
  body: unknown,
  status = 200,
): void =>
  writeResponse(
    response,
    status,
    "application/json; charset=utf-8",
    JSON.stringify(body),
  );

const traceViewerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lucent traces</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --background: #0e0e0f;
        --panel: #121214;
        --control: #202022;
        --border: #303034;
        --muted: #aaaab2;
        --text: #f5f5f7;
        --success: #5dbb93;
        --failure: #e16c70;
        --interrupted: #d2a85c;
        --selected: #8ab4f8;
        --label-width: 300px;
        --timeline-width: 900px;
      }
      * { box-sizing: border-box; }
      body {
        background: var(--background);
        color: var(--text);
        display: flex;
        flex-direction: column;
        gap: 8px;
        height: 100vh;
        margin: 0;
        padding: 8px;
      }
      header,
      .toolbar,
      .waterfall-panel,
      .details {
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--panel);
      }
      header {
        align-items: center;
        display: flex;
        gap: 16px;
        min-height: 36px;
        padding: 4px 10px;
      }
      h1 {
        font-size: 14px;
        margin: 0;
      }
      nav { display: flex; gap: 4px; }
      nav a {
        border-radius: 3px;
        color: var(--muted);
        font-size: 12px;
        padding: 4px 7px;
        text-decoration: none;
      }
      nav a:hover,
      nav a[aria-current="page"] {
        background: var(--control);
        color: var(--text);
      }
      .status {
        color: var(--muted);
        font-size: 11px;
        margin-left: auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .toolbar {
        align-items: end;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 7px;
      }
      label {
        color: var(--muted);
        display: grid;
        font-size: 10px;
        gap: 3px;
      }
      button,
      input,
      select {
        background: var(--control);
        border: 1px solid var(--border);
        border-radius: 3px;
        color: var(--text);
        font: inherit;
        font-size: 12px;
        min-height: 28px;
        padding: 4px 7px;
      }
      button { cursor: pointer; }
      button:hover { border-color: var(--muted); }
      :focus-visible {
        outline: 2px solid var(--selected);
        outline-offset: 2px;
      }
      #query { min-width: 220px; width: min(34vw, 420px); }
      .workspace {
        display: grid;
        flex: 1;
        gap: 8px;
        grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
        min-height: 0;
      }
      .waterfall-panel,
      .details { min-height: 0; overflow: hidden; }
      .waterfall-scroll {
        height: 100%;
        overflow: auto;
        position: relative;
      }
      .waterfall-row {
        display: grid;
        grid-template-columns: var(--label-width) var(--timeline-width);
        min-width: calc(var(--label-width) + var(--timeline-width));
      }
      .axis-row {
        background: var(--panel);
        border-bottom: 1px solid var(--border);
        height: 28px;
        position: sticky;
        top: 0;
        z-index: 5;
      }
      .name-heading,
      .span-name {
        background: var(--panel);
        border-right: 1px solid var(--border);
        left: 0;
        overflow: hidden;
        position: sticky;
        text-overflow: ellipsis;
        white-space: nowrap;
        z-index: 3;
      }
      .name-heading {
        color: var(--muted);
        font-size: 10px;
        font-weight: 600;
        padding: 7px 10px;
      }
      .axis {
        color: var(--muted);
        font-size: 10px;
        position: relative;
      }
      .axis-tick {
        border-left: 1px solid var(--border);
        height: 100%;
        padding-left: 4px;
        position: absolute;
        top: 0;
      }
      .span-row { border-bottom: 1px solid #232326; height: 30px; }
      .span-name {
        align-items: center;
        display: flex;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        gap: 6px;
        padding-right: 8px;
      }
      .source {
        color: var(--muted);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 9px;
        text-transform: uppercase;
      }
      .timeline-cell {
        background-image: linear-gradient(to right, transparent calc(25% - 1px), #242427 25%, transparent calc(25% + 1px), transparent calc(50% - 1px), #242427 50%, transparent calc(50% + 1px), transparent calc(75% - 1px), #242427 75%, transparent calc(75% + 1px));
        position: relative;
      }
      .span-bar {
        border: 0;
        border-radius: 2px;
        height: 20px;
        min-height: 20px;
        padding: 0;
        position: absolute;
        top: 5px;
      }
      .span-bar.success { background: var(--success); }
      .span-bar.failure { background: var(--failure); }
      .span-bar.interrupted { background: var(--interrupted); }
      .span-bar.selected { box-shadow: 0 0 0 2px var(--selected); }
      .empty {
        color: var(--muted);
        font-size: 12px;
        padding: 28px;
      }
      .details {
        overflow: auto;
        padding: 12px;
      }
      .details h2 {
        font-size: 14px;
        margin: 0 0 12px;
        overflow-wrap: anywhere;
      }
      .details dl {
        display: grid;
        font-size: 11px;
        gap: 7px 10px;
        grid-template-columns: max-content minmax(0, 1fr);
        margin: 0 0 14px;
      }
      .details dt { color: var(--muted); }
      .details dd {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-variant-numeric: tabular-nums;
        margin: 0;
        overflow-wrap: anywhere;
      }
      pre {
        background: var(--background);
        border: 1px solid var(--border);
        border-radius: 3px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 10px;
        line-height: 1.45;
        margin: 0;
        overflow: auto;
        padding: 9px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .sr-only {
        clip: rect(0, 0, 0, 0);
        clip-path: inset(50%);
        height: 1px;
        overflow: hidden;
        position: absolute;
        white-space: nowrap;
        width: 1px;
      }
      @media (max-width: 900px) {
        .workspace {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: minmax(280px, 1fr) minmax(220px, 42vh);
        }
        #query { width: min(70vw, 420px); }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Lucent observability</h1>
      <nav aria-label="Observability views">
        <a href="/">Console</a>
        <a href="/traces" aria-current="page">Traces</a>
      </nav>
      <div class="status" id="status" aria-live="polite">Loading traces…</div>
    </header>
    <form class="toolbar" id="filters">
      <label>Search
        <input id="query" type="search" placeholder="Span, channel, renderer, trace ID" />
      </label>
      <label>Outcome
        <select id="outcome">
          <option value="">All outcomes</option>
          <option value="Failure">Failures</option>
          <option value="Interrupted">Interrupted</option>
          <option value="Success">Success</option>
        </select>
      </label>
      <label>Source
        <select id="source">
          <option value="">All sources</option>
          <option value="renderer">Renderer</option>
          <option value="effect">Main / Effect</option>
        </select>
      </label>
      <label>Timeline scale
        <select id="zoom">
          <option value="fit">Fit launch</option>
          <option value="0.05">0.05 px/ms</option>
          <option value="0.2">0.2 px/ms</option>
          <option value="1">1 px/ms</option>
          <option value="4">4 px/ms</option>
        </select>
      </label>
      <button id="refresh" type="button">Refresh traces</button>
    </form>
    <main class="workspace">
      <section class="waterfall-panel" aria-labelledby="waterfall-heading">
        <h2 id="waterfall-heading" class="sr-only">Trace waterfall</h2>
        <div class="waterfall-scroll" id="waterfallScroll">
          <div class="waterfall-row axis-row">
            <div class="name-heading">Span</div>
            <div class="axis" id="axis"></div>
          </div>
          <div id="rows"></div>
          <div class="empty" id="empty" hidden>No spans match these filters.</div>
        </div>
      </section>
      <aside class="details" aria-labelledby="detailHeading">
        <h2 id="detailHeading">Select a span</h2>
        <dl id="summary" hidden>
          <dt>Duration</dt><dd id="detailDuration"></dd>
          <dt>Outcome</dt><dd id="detailOutcome"></dd>
          <dt>Source</dt><dd id="detailSource"></dd>
          <dt>Trace</dt><dd id="detailTrace"></dd>
          <dt>Span</dt><dd id="detailSpan"></dd>
          <dt>Parent</dt><dd id="detailParent"></dd>
        </dl>
        <pre id="detailJson" tabindex="0">Click a bar to inspect its attributes, events, links, and failure details.</pre>
      </aside>
    </main>
    <script>
      const MAX_RENDERED_SPANS = 5000;
      const LABEL_WIDTH = 300;
      const state = { spans: [], selectedSpanId: null, recordingStartedAt: null, truncated: false, liveStatus: "Connecting live stream" };
      const statusEl = document.getElementById("status");
      const rowsEl = document.getElementById("rows");
      const emptyEl = document.getElementById("empty");
      const axisEl = document.getElementById("axis");
      const scrollEl = document.getElementById("waterfallScroll");
      const queryEl = document.getElementById("query");
      const outcomeEl = document.getElementById("outcome");
      const sourceEl = document.getElementById("source");
      const zoomEl = document.getElementById("zoom");
      const refreshEl = document.getElementById("refresh");
      const detailHeadingEl = document.getElementById("detailHeading");
      const summaryEl = document.getElementById("summary");
      const detailJsonEl = document.getElementById("detailJson");

      const asNanos = (value) => {
        try { return BigInt(value); } catch { return 0n; }
      };
      const formatDuration = (durationMs) => {
        if (durationMs < 0.001) return Math.round(durationMs * 1000000) + " ns";
        if (durationMs < 1) return (durationMs * 1000).toFixed(2) + " µs";
        if (durationMs < 1000) return durationMs.toFixed(durationMs < 10 ? 3 : 1) + " ms";
        return (durationMs / 1000).toFixed(2) + " s";
      };
      const outcomeClass = (span) => span.exit._tag.toLowerCase();
      const keyFor = (span) => span.traceId + ":" + span.spanId;

      const selectSpan = (span, bar) => {
        state.selectedSpanId = keyFor(span);
        document.querySelectorAll(".span-bar.selected").forEach((selected) => selected.classList.remove("selected"));
        bar.classList.add("selected");
        detailHeadingEl.textContent = span.name;
        summaryEl.hidden = false;
        document.getElementById("detailDuration").textContent = formatDuration(span.durationMs);
        document.getElementById("detailOutcome").textContent = span.exit._tag;
        document.getElementById("detailSource").textContent = span.source;
        document.getElementById("detailTrace").textContent = span.traceId;
        document.getElementById("detailSpan").textContent = span.spanId;
        document.getElementById("detailParent").textContent = span.parentSpanId || "Root";
        detailJsonEl.textContent = JSON.stringify({
          attributes: span.attributes,
          events: span.events,
          links: span.links,
          exit: span.exit,
        }, null, 2);
      };

      const renderAxis = (totalMs) => {
        axisEl.replaceChildren();
        [0, 0.25, 0.5, 0.75, 1].forEach((ratio) => {
          const tick = document.createElement("span");
          tick.className = "axis-tick";
          tick.style.left = (ratio * 100) + "%";
          tick.textContent = formatDuration(totalMs * ratio);
          axisEl.append(tick);
        });
      };

      const render = () => {
        const allSpans = state.spans;
        const firstStart = allSpans.length === 0 ? 0n : asNanos(allSpans[0].startTimeUnixNano);
        const lastEnd = allSpans.reduce((latest, span) => {
          const end = asNanos(span.endTimeUnixNano);
          return end > latest ? end : latest;
        }, firstStart + 1n);
        const rangeNanos = lastEnd > firstStart ? lastEnd - firstStart : 1n;
        const totalMs = Number(rangeNanos) / 1000000;
        const scale = zoomEl.value === "fit" ? null : Number(zoomEl.value);
        const viewportWidth = Math.max(320, scrollEl.clientWidth - LABEL_WIDTH);
        const timelineWidth = scale === null ? viewportWidth : Math.max(viewportWidth, totalMs * scale);
        document.documentElement.style.setProperty("--timeline-width", Math.round(timelineWidth) + "px");
        renderAxis(totalMs);

        const query = queryEl.value.trim().toLowerCase();
        const outcome = outcomeEl.value;
        const source = sourceEl.value;
        const parentById = new Map(allSpans.map((span) => [keyFor(span), span]));
        const depthFor = (span) => {
          let depth = 0;
          let parentId = span.parentSpanId;
          const visited = new Set();
          while (parentId && depth < 12) {
            const parentKey = span.traceId + ":" + parentId;
            if (visited.has(parentKey)) break;
            visited.add(parentKey);
            const parent = parentById.get(parentKey);
            if (!parent) break;
            depth += 1;
            parentId = parent.parentSpanId;
          }
          return depth;
        };
        const filtered = allSpans.filter((span) => {
          if (outcome && span.exit._tag !== outcome) return false;
          if (source && span.source !== source) return false;
          if (!query) return true;
          let attributes = "";
          try { attributes = JSON.stringify(span.attributes).toLowerCase(); } catch {}
          return span.name.toLowerCase().includes(query) ||
            span.traceId.toLowerCase().includes(query) ||
            span.spanId.toLowerCase().includes(query) ||
            attributes.includes(query);
        });
        const visible = filtered.slice(0, MAX_RENDERED_SPANS);
        rowsEl.replaceChildren();
        emptyEl.hidden = visible.length !== 0;

        visible.forEach((span) => {
          const row = document.createElement("div");
          row.className = "waterfall-row span-row";
          const name = document.createElement("div");
          name.className = "span-name";
          name.style.paddingLeft = (10 + Math.min(depthFor(span), 8) * 14) + "px";
          const sourceBadge = document.createElement("span");
          sourceBadge.className = "source";
          sourceBadge.textContent = span.source === "renderer" ? "renderer" : "effect";
          const nameText = document.createElement("span");
          nameText.textContent = span.name;
          name.title = span.name;
          name.append(sourceBadge, nameText);

          const timeline = document.createElement("div");
          timeline.className = "timeline-cell";
          const bar = document.createElement("button");
          const selected = state.selectedSpanId === keyFor(span);
          bar.className = "span-bar " + outcomeClass(span) + (selected ? " selected" : "");
          bar.type = "button";
          bar.setAttribute("aria-label", span.name + ", " + formatDuration(span.durationMs) + ", " + span.exit._tag);
          bar.title = span.name + " · " + formatDuration(span.durationMs) + " · " + span.exit._tag;
          const offsetNanos = asNanos(span.startTimeUnixNano) - firstStart;
          if (scale === null) {
            const left = Number(offsetNanos * 100000n / rangeNanos) / 1000;
            const width = Number(BigInt(Math.max(1, Math.round(span.durationMs * 1000000))) * 100000n / rangeNanos) / 1000;
            bar.style.left = left + "%";
            bar.style.width = "max(3px, " + Math.max(0.001, width) + "%)";
          } else {
            bar.style.left = (Number(offsetNanos) / 1000000 * scale) + "px";
            bar.style.width = Math.max(3, span.durationMs * scale) + "px";
          }
          bar.addEventListener("click", () => selectSpan(span, bar));
          timeline.append(bar);
          row.append(name, timeline);
          rowsEl.append(row);
        });

        const traceCount = new Set(allSpans.map((span) => span.traceId)).size;
        const launch = state.recordingStartedAt ? new Date(state.recordingStartedAt).toLocaleString() : "unknown launch";
        const clipped = state.truncated ? " · log window is truncated" : "";
        const matches = filtered.length === allSpans.length ? "" : " · " + filtered.length + " matches";
        const limited = filtered.length > visible.length ? " · showing first " + visible.length + " matches" : "";
        statusEl.textContent = allSpans.length + " spans · " + traceCount + " traces · " + launch + " · " + state.liveStatus + matches + clipped + limited;
      };

      const mergeSpan = (span) => {
        const key = keyFor(span);
        const existingIndex = state.spans.findIndex((candidate) => keyFor(candidate) === key);
        if (existingIndex === -1) state.spans.push(span);
        else state.spans[existingIndex] = span;
        state.spans.sort((left, right) => {
          const leftStart = asNanos(left.startTimeUnixNano);
          const rightStart = asNanos(right.startTimeUnixNano);
          return leftStart < rightStart ? -1 : leftStart > rightStart ? 1 : 0;
        });
      };

      let renderTimer;
      const scheduleRender = () => {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(render, 50);
      };

      const connectLiveStream = () => {
        const events = new EventSource("/trace-events");
        events.addEventListener("span", (event) => {
          try {
            mergeSpan(JSON.parse(event.data));
            scheduleRender();
          } catch {}
        });
        events.onopen = () => {
          state.liveStatus = "Live";
          render();
        };
        events.onerror = () => {
          state.liveStatus = "Live stream reconnecting";
          render();
        };
      };

      const load = async () => {
        refreshEl.disabled = true;
        statusEl.textContent = "Loading traces…";
        try {
          const response = await fetch("/api/traces", { cache: "no-store" });
          if (!response.ok) throw new Error("HTTP " + response.status);
          const payload = await response.json();
          state.spans = payload.spans.slice().sort((left, right) => {
            const leftStart = asNanos(left.startTimeUnixNano);
            const rightStart = asNanos(right.startTimeUnixNano);
            return leftStart < rightStart ? -1 : leftStart > rightStart ? 1 : 0;
          });
          state.recordingStartedAt = payload.recordingStartedAt;
          state.truncated = payload.truncated;
          if (state.selectedSpanId && !state.spans.some((span) => keyFor(span) === state.selectedSpanId)) {
            state.selectedSpanId = null;
          }
          render();
        } catch (cause) {
          statusEl.textContent = "Could not load traces: " + (cause instanceof Error ? cause.message : String(cause));
        } finally {
          refreshEl.disabled = false;
        }
      };

      document.getElementById("filters").addEventListener("submit", (event) => event.preventDefault());
      queryEl.addEventListener("input", render);
      outcomeEl.addEventListener("change", render);
      sourceEl.addEventListener("change", render);
      zoomEl.addEventListener("change", render);
      refreshEl.addEventListener("click", load);
      let resizeTimer;
      window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(render, 50);
      });
      load().finally(connectLiveStream);
    </script>
  </body>
</html>`;

export type DesktopTraceViewerHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => boolean;

export interface DesktopTraceViewer {
  readonly close: () => void;
  readonly handle: DesktopTraceViewerHandler;
  readonly publish: (span: unknown) => void;
}

/** Serves trace history from the log and streams new spans to connected viewers. */
export const makeDesktopTraceViewer = (
  logFilePath: string,
): DesktopTraceViewer => {
  const clients = new Set<ServerResponse>();
  const handle: DesktopTraceViewerHandler = (request, response, url) => {
    if (url.pathname === "/traces" || url.pathname === "/traces/") {
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      );
      writeResponse(response, 200, "text/html; charset=utf-8", traceViewerHtml);
      return true;
    }
    if (url.pathname === "/trace-events") {
      response.statusCode = 200;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Connection", "keep-alive");
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.write(": connected\n\n");
      clients.add(response);
      request.on("close", () => {
        clients.delete(response);
      });
      return true;
    }
    if (url.pathname !== "/api/traces") {
      return false;
    }

    void loadLatestTraces(logFilePath)
      .then((traces) => writeJson(response, traces))
      .catch((cause: unknown) =>
        writeJson(
          response,
          {
            error:
              cause instanceof Error ? cause.message : "Failed to read traces",
          },
          500,
        ),
      );
    return true;
  };

  return {
    close: () => {
      for (const client of clients) {
        client.end();
      }
      clients.clear();
    },
    handle,
    publish: (span) => {
      if (clients.size === 0 || !isTraceSpan(span)) {
        return;
      }
      const event = `event: span\ndata: ${JSON.stringify(span)}\n\n`;
      for (const client of clients) {
        try {
          client.write(event);
        } catch {
          clients.delete(client);
        }
      }
    },
  };
};
