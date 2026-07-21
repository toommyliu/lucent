import { Effect, Stream } from "effect";

import { mountDesktopRenderer } from "../../RendererBootstrap";
import { App } from "./App";
import { flashRuntime } from "./flash";
import { Gateway } from "./flash/bridge/Gateway";
import { diagnosticTimestamp } from "./flash/contract/Diagnostic";
import { installGameConsoleForwarder } from "./gameConsoleForwarder";

installGameConsoleForwarder(window.desktop.gameConsoleObservability);

const diagnosticLogs: unknown[] = [];
(window as any).logs = diagnosticLogs;

let projectionLogHost: HTMLDivElement | null = null;
let projectionLogRoot: ShadowRoot | null = null;

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

const formatTimestamp = (timestamp: number): string => {
  const milliseconds = Math.floor(timestamp);
  const date = new Date(milliseconds);
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  const microseconds = Math.floor(timestamp * 1_000) % 1_000_000;
  return `${time}.${String(microseconds).padStart(6, "0")}`;
};

const renderProjectionLogs = (): void => {
  const root = projectionLogRoot;
  if (root === null) return;

  const count = root.querySelector("[data-trace-count]");
  const output = root.querySelector("[data-trace-output]");
  if (count === null || output === null) return;

  const traces = projectionLogs();
  const changed = traces.filter(
    (diagnostic) => diagnostic.arguments?.[0]?.changed === true,
  ).length;
  count.textContent = `${changed} changed / ${traces.length} projected packets`;
  output.replaceChildren();

  for (const diagnostic of traces.toReversed()) {
    const trace = diagnostic.arguments?.[0] ?? {};
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const diffCount = Object.keys(trace.diff ?? {}).length;
    const timestamp = formatTimestamp(diagnostic.timestamp);
    const result = trace.changed ? `${diffCount} changes` : "no state change";

    summary.textContent = `${timestamp}  ${trace.packet?.direction ?? "?"}  ${trace.packet?.command ?? diagnostic.operation}  (${result})`;
    details.dataset["changed"] = trace.changed === true ? "true" : "false";
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

const closeProjectionLogs = (): void => {
  projectionLogHost?.remove();
  projectionLogHost = null;
  projectionLogRoot = null;
};

const openProjectionLogs = (): void => {
  if (projectionLogHost !== null) {
    renderProjectionLogs();
    return;
  }

  const host = document.createElement("div");
  host.dataset["projectionLogViewer"] = "";
  Object.assign(host.style, {
    background: "rgba(0, 0, 0, 0.72)",
    inset: "0",
    position: "fixed",
    zIndex: "2147483647",
  });
  const root = host.attachShadow({ mode: "open" });
  projectionLogHost = host;
  projectionLogRoot = root;

  const style = document.createElement("style");
  style.textContent = `
    :host { color-scheme: dark; font-family: system-ui, sans-serif; }
    .panel { position: absolute; inset: 1.5rem; display: flex; flex-direction: column; overflow: hidden; background: #111; color: #eee; border: 1px solid #555; border-radius: 0.5rem; box-shadow: 0 1rem 4rem #000; }
    header { position: sticky; top: 0; z-index: 1; display: flex; gap: 1rem; align-items: center; padding: 0.75rem 1rem; background: #1c1c1c; border-bottom: 1px solid #444; }
    button { padding: 0.4rem 0.75rem; color: inherit; background: #333; border: 1px solid #666; border-radius: 0.25rem; cursor: pointer; }
    button:last-child { margin-left: auto; }
    main { flex: 1; overflow: auto; padding: 1rem; }
    details { margin-bottom: 0.75rem; border: 1px solid #444; border-radius: 0.25rem; background: #181818; }
    details[data-changed="false"] { border-color: #745f2e; }
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
    void navigator.clipboard.writeText(formatLogValue(diagnosticLogs));
  });
  const close = document.createElement("button");
  close.textContent = "Close";
  close.addEventListener("click", closeProjectionLogs);
  header.append(count, copy, close);

  const output = document.createElement("main");
  output.dataset["traceOutput"] = "";
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.append(header, output);
  root.append(style, panel);
  document.body.append(host);
  renderProjectionLogs();
};

if (window.desktop.debug) {
  (window as any).openProjectionLogs = openProjectionLogs;
  (window as any).closeProjectionLogs = closeProjectionLogs;
  (window as any).copyProjectionLogs = () =>
    navigator.clipboard.writeText(formatLogValue(diagnosticLogs));
}

void flashRuntime.context().catch((cause) => {
  console.warn("[flash] runtime initialization failed", cause);
});

flashRuntime.runFork(
  Effect.gen(function* () {
    const gateway = yield* Gateway;
    const consumeDiagnostics = gateway.diagnostics.pipe(
      Stream.runForEach((diagnostic) =>
        Effect.sync(() => {
          if (diagnostic.phase === "projection-trace") {
            if (window.desktop.debug) {
              diagnosticLogs.push(diagnostic);
              renderProjectionLogs();
              console.debug("[flash:projection]", diagnostic);
            }
            return;
          }
          diagnosticLogs.push(diagnostic);
          console.warn("[flash:diagnostic]", diagnostic);
        }),
      ),
    );
    const consumePackets = gateway.packets.pipe(
      Stream.runForEach((packet) =>
        Effect.sync(() => {
          diagnosticLogs.push({
            packet,
            phase: "packet",
            timestamp: diagnosticTimestamp(),
          });
        }),
      ),
    );

    yield* Effect.all([consumeDiagnostics, consumePackets], {
      concurrency: "unbounded",
      discard: true,
    });
  }),
);

mountDesktopRenderer((props) => <App {...props} />, {
  cleanup: () => {
    void flashRuntime.dispose();
  },
  markReady: false,
});
