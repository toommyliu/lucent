import * as React from "react";

import { ConsoleDashboard } from "@/components/console-dashboard";
import {
  ObservabilityHeader,
  type ObservabilityView,
} from "@/components/observability-header";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useMediaQuery } from "@/hooks/use-media-query";
import { TraceDetails } from "@/components/trace-details";
import { TraceFilters } from "@/components/trace-filters";
import { TraceWaterfall } from "@/components/trace-waterfall";
import {
  filterTraceSpans,
  traceKey,
  type OutcomeFilter,
  type SourceFilter,
  type TimelineScale,
} from "@/trace-model";
import { useTraces } from "@/use-traces";

function launchLabel(recordingStartedAt: string | null): string {
  if (recordingStartedAt === null) {
    return "unknown launch";
  }

  const date = new Date(recordingStartedAt);
  return Number.isNaN(date.valueOf())
    ? "unknown launch"
    : date.toLocaleString();
}

function selectedView(): ObservabilityView {
  return new URLSearchParams(window.location.search).get("view") === "traces"
    ? "traces"
    : "console";
}

function TraceDashboard() {
  const traces = useTraces();
  const stacked = useMediaQuery({ max: 900 });
  const [query, setQuery] = React.useState("");
  const [outcome, setOutcome] = React.useState<OutcomeFilter>("all");
  const [source, setSource] = React.useState<SourceFilter>("all");
  const [scale, setScale] = React.useState<TimelineScale>("fit");
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);

  const filteredSpans = React.useMemo(
    () => filterTraceSpans(traces.spans, query, outcome, source),
    [outcome, query, source, traces.spans],
  );
  const selectedSpan = React.useMemo(
    () =>
      selectedKey === null
        ? null
        : (traces.spans.find((span) => traceKey(span) === selectedKey) ?? null),
    [selectedKey, traces.spans],
  );
  const traceCount = React.useMemo(
    () => new Set(traces.spans.map((span) => span.traceId)).size,
    [traces.spans],
  );

  const filtersActive =
    query.trim().length > 0 || outcome !== "all" || source !== "all";
  const statusParts = [
    `${traces.spans.length} spans`,
    `${traceCount} traces`,
    launchLabel(traces.recordingStartedAt),
    traces.liveStatus,
  ];
  if (filtersActive) {
    statusParts.push(`${filteredSpans.length} matches`);
  }
  if (traces.truncated) {
    statusParts.push("log window is truncated");
  }
  if (traces.error !== null) {
    statusParts.push("history refresh failed");
  }

  const emptyState = traces.loading
    ? {
        description: "Reading completed spans from the current Lucent log.",
        title: "Loading traces",
      }
    : traces.error !== null && traces.spans.length === 0
      ? {
          action: {
            label: "Retry loading traces",
            run: () => void traces.refresh(),
          },
          description: `Unable to load trace history: ${traces.error}`,
          title: "Unable to load traces",
        }
      : filtersActive
        ? {
            description: "Adjust the search, outcome, or source filters.",
            title: "No spans match these filters",
          }
        : {
            description: "Completed spans will appear here while Lucent runs.",
            title: "No traces recorded yet",
          };

  return (
    <div className="flex h-svh min-h-0 flex-col gap-2 bg-background p-2 text-foreground antialiased">
      <a
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:ring-2 focus:ring-ring"
        href="#trace-workspace"
      >
        Skip to trace waterfall
      </a>

      <ObservabilityHeader
        currentView="traces"
        status={
          traces.loading && traces.spans.length === 0
            ? "Loading traces…"
            : statusParts.join(" · ")
        }
        statusTitle={traces.error ?? statusParts.join(" · ")}
      />

      <TraceFilters
        autoScroll={autoScroll}
        loading={traces.loading}
        onAutoScrollChange={setAutoScroll}
        onOutcomeChange={setOutcome}
        onQueryChange={setQuery}
        onRefresh={() => void traces.refresh()}
        onScaleChange={setScale}
        onSourceChange={setSource}
        outcome={outcome}
        query={query}
        scale={scale}
        source={source}
      />

      <main className="min-h-0 flex-1" id="trace-workspace">
        <ResizablePanelGroup
          className="min-h-0"
          key={stacked ? "stacked" : "side-by-side"}
          orientation={stacked ? "vertical" : "horizontal"}
        >
          <ResizablePanel
            defaultSize={stacked ? "64%" : "70%"}
            id="trace-waterfall-panel"
            minSize={stacked ? "240px" : "45%"}
          >
            <TraceWaterfall
              allSpans={traces.spans}
              autoScroll={autoScroll}
              emptyState={emptyState}
              onSelect={(span) => setSelectedKey(traceKey(span))}
              scale={scale}
              selectedKey={selectedSpan === null ? null : selectedKey}
              spans={filteredSpans}
            />
          </ResizablePanel>
          <ResizableHandle
            aria-label="Resize trace waterfall and span details"
            className="w-2 bg-transparent aria-[orientation=horizontal]:h-2 aria-[orientation=horizontal]:bg-transparent"
            withHandle
          />
          <ResizablePanel
            defaultSize={stacked ? "36%" : "30%"}
            id="span-details-panel"
            minSize={stacked ? "160px" : "260px"}
          >
            <TraceDetails span={selectedSpan} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
    </div>
  );
}

export function App() {
  const view = selectedView();

  React.useEffect(() => {
    document.title = view === "console" ? "Lucent console" : "Lucent traces";
  }, [view]);

  return view === "console" ? <ConsoleDashboard /> : <TraceDashboard />;
}

export default App;
