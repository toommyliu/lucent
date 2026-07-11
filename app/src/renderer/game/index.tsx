import { Effect, Stream } from "effect";

import { mountDesktopRenderer } from "../RendererBootstrap";
import { App } from "./App";
import { flashRuntime } from "./flash";
import { Gateway } from "./flash/bridge/Gateway";
import { installGameConsoleForwarder } from "./gameConsoleForwarder";

installGameConsoleForwarder(window.desktop.gameConsoleObservability);

const diagnosticLogs: unknown[] = [];
(window as any).logs = diagnosticLogs;

let projectionLogWindow: Window | null = null;

const projectionLogs = () =>
  diagnosticLogs.filter(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "phase" in entry &&
      entry.phase === "projection-trace",
  ) as any[];

const formatLogValue = (value: unknown): string =>
  JSON.stringify(
    value,
    (_key, entry: unknown) =>
      entry instanceof Error
        ? { message: entry.message, name: entry.name, stack: entry.stack }
        : entry,
    2,
  ) ?? String(value);

const renderProjectionLogs = (): void => {
  if (projectionLogWindow === null || projectionLogWindow.closed) return;

  const document = projectionLogWindow.document;
  const count = document.querySelector("[data-trace-count]");
  const output = document.querySelector("[data-trace-output]");
  if (count === null || output === null) return;

  const traces = projectionLogs();
  count.textContent = `${traces.length} state-changing packets`;
  output.replaceChildren();

  for (const diagnostic of traces.toReversed()) {
    const trace = diagnostic.arguments?.[0] ?? {};
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const diffCount = Object.keys(trace.diff ?? {}).length;
    const timestamp = new Date(diagnostic.timestamp).toLocaleTimeString();

    summary.textContent = `${timestamp}  ${trace.packet?.direction ?? "?"}  ${trace.packet?.command ?? diagnostic.operation}  (${diffCount} changes)`;
    details.append(summary);

    const comparison = document.createElement("div");
    comparison.className = "comparison";

    for (const [label, value] of [
      ["Diff", trace.diff],
      ["Before", trace.before],
      ["After", trace.after],
      ["Packet", trace.packet],
    ] as const) {
      const section = document.createElement("section");
      const heading = document.createElement("h2");
      const pre = document.createElement("pre");
      heading.textContent = label;
      pre.textContent = formatLogValue(value);
      section.append(heading, pre);
      comparison.append(section);
    }

    details.append(comparison);
    output.append(details);
  }
};

const openProjectionLogs = (): void => {
  projectionLogWindow = window.open("", "projection-logs");
  if (projectionLogWindow === null) return;

  const document = projectionLogWindow.document;
  document.title = "Projection state changes";
  document.head.replaceChildren();
  document.body.replaceChildren();

  const style = document.createElement("style");
  style.textContent = `
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    body { margin: 0; background: #111; color: #eee; }
    header { position: sticky; top: 0; z-index: 1; display: flex; gap: 1rem; align-items: center; padding: 0.75rem 1rem; background: #1c1c1c; border-bottom: 1px solid #444; }
    button { padding: 0.4rem 0.75rem; color: inherit; background: #333; border: 1px solid #666; border-radius: 0.25rem; cursor: pointer; }
    main { padding: 1rem; }
    details { margin-bottom: 0.75rem; border: 1px solid #444; border-radius: 0.25rem; background: #181818; }
    summary { padding: 0.75rem; cursor: pointer; font-family: ui-monospace, monospace; }
    .comparison { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: #444; border-top: 1px solid #444; }
    section { min-width: 0; padding: 0.75rem; background: #181818; }
    h2 { margin: 0 0 0.5rem; font-size: 0.8rem; text-transform: uppercase; color: #aaa; }
    pre { max-height: 32rem; margin: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.75rem; }
    @media (max-width: 900px) { .comparison { grid-template-columns: 1fr; } }
  `;

  const header = document.createElement("header");
  const count = document.createElement("strong");
  count.dataset["traceCount"] = "";
  const copy = document.createElement("button");
  copy.textContent = "Copy all window.logs";
  copy.addEventListener("click", () => {
    void projectionLogWindow?.navigator.clipboard.writeText(
      formatLogValue(diagnosticLogs),
    );
  });
  header.append(count, copy);

  const output = document.createElement("main");
  output.dataset["traceOutput"] = "";
  document.head.append(style);
  document.body.append(header, output);
  renderProjectionLogs();
};

(window as any).openProjectionLogs = openProjectionLogs;
(window as any).copyProjectionLogs = () =>
  navigator.clipboard.writeText(formatLogValue(diagnosticLogs));

void flashRuntime.context().catch((cause) => {
  console.warn("[flash] runtime initialization failed", cause);
});

flashRuntime.runFork(
  Effect.gen(function* () {
    const gateway = yield* Gateway;
    yield* gateway.diagnostics.pipe(
      Stream.runForEach((diagnostic) =>
        Effect.sync(() => {
          diagnosticLogs.push(diagnostic);
          if (diagnostic.phase === "projection-trace") {
            renderProjectionLogs();
            console.debug("[flash:projection]", diagnostic);
            return;
          }
          console.warn("[flash:diagnostic]", diagnostic);
        }),
      ),
    );
  }),
);

mountDesktopRenderer((props) => <App {...props} />, {
  cleanup: () => {
    void flashRuntime.dispose();
  },
  markReady: false,
});
