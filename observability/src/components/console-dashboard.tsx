import * as React from "react";

import { ConsoleFilters } from "@/components/console-filters";
import { ConsoleLog, type ConsoleLogHandle } from "@/components/console-log";
import { ObservabilityHeader } from "@/components/observability-header";
import { writeClipboardText } from "@/console-clipboard";
import { consoleFiltersActive, consoleMessagesToNdjson } from "@/console-model";
import type { ConsoleTransport } from "@/console-transport";
import { cn } from "@/lib/utils";
import { useConsole } from "@/use-console";

const CONNECTION_LABEL = {
  connected: "Live",
  connecting: "Connecting to live stream…",
  reconnecting: "Live stream reconnecting…",
} as const;

export interface ConsoleDashboardProps {
  readonly className?: string;
  readonly transport?: ConsoleTransport;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function ConsoleDashboard({
  className,
  transport,
}: ConsoleDashboardProps) {
  const consoleData = useConsole(transport);
  const logRef = React.useRef<ConsoleLogHandle>(null);
  const [copyAllLabel, setCopyAllLabel] = React.useState("Copy all");
  const copyResetTimer = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
    },
    [],
  );

  const filtersActive = consoleFiltersActive(consoleData.filters);
  const state = consoleData.state;
  const statusParts = [
    state === null
      ? "Console state unavailable"
      : countLabel(state.activeGameWindowCount, "active window"),
    state === null
      ? countLabel(consoleData.messages.length, "visible message")
      : countLabel(state.buffer.size, "buffered message"),
    CONNECTION_LABEL[consoleData.connectionStatus],
  ];
  if (filtersActive) {
    statusParts.push(countLabel(consoleData.messages.length, "match"));
  }
  if (consoleData.paused) {
    statusParts.push("Paused");
  }
  if (consoleData.error !== null) {
    statusParts.push("History refresh failed");
  }

  const emptyState = consoleData.loadingMessages
    ? {
        description: "Reading buffered game console messages.",
        title: "Loading console messages",
      }
    : consoleData.error !== null
      ? {
          action: {
            label: "Retry loading messages",
            run: () => void consoleData.refresh(),
          },
          description: `Unable to load console messages: ${consoleData.error}`,
          title: "Unable to load messages",
        }
      : filtersActive
        ? {
            action: {
              label: "Clear filters",
              run: consoleData.clearFilters,
            },
            description:
              "Adjust the message, window, generation, or username filters.",
            title: "No messages match these filters",
          }
        : {
            description:
              "Messages will appear here when an active game window writes to the console.",
            title: "No console messages yet",
          };

  const copyAll = async () => {
    if (copyResetTimer.current !== null) {
      window.clearTimeout(copyResetTimer.current);
    }
    try {
      await writeClipboardText(consoleMessagesToNdjson(consoleData.messages));
      setCopyAllLabel("Copied");
      copyResetTimer.current = window.setTimeout(
        () => setCopyAllLabel("Copy all"),
        900,
      );
    } catch {
      setCopyAllLabel("Copy failed");
      copyResetTimer.current = window.setTimeout(
        () => setCopyAllLabel("Copy all"),
        1_200,
      );
    }
  };

  return (
    <div
      className={cn(
        "flex h-svh min-h-0 flex-col gap-2 bg-background p-2 text-foreground antialiased",
        className,
      )}
    >
      <a
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:ring-2 focus:ring-ring"
        href="#console-workspace"
      >
        Skip to console messages
      </a>

      <ObservabilityHeader
        currentView="console"
        status={
          consoleData.loadingState && state === null
            ? "Loading console state…"
            : statusParts.join(" · ")
        }
        statusTitle={consoleData.error ?? statusParts.join(" · ")}
      />

      <ConsoleFilters
        autoScroll={consoleData.autoScroll}
        canCopy={consoleData.messages.length > 0}
        canNavigate={consoleData.messages.length > 0}
        copyAllLabel={copyAllLabel}
        filters={consoleData.filters}
        onAutoScrollChange={consoleData.setAutoScroll}
        onCopyAll={() => void copyAll()}
        onGenerationChange={consoleData.setGeneration}
        onNext={() => logRef.current?.next()}
        onPauseChange={consoleData.togglePaused}
        onPrevious={() => logRef.current?.previous()}
        onQueryChange={consoleData.setQuery}
        onUsernameChange={consoleData.setUsername}
        onWindowChange={consoleData.setWindowId}
        paused={consoleData.paused}
        state={state}
      />

      <main className="min-h-0 flex-1" id="console-workspace">
        <ConsoleLog
          autoScroll={consoleData.autoScroll}
          emptyState={emptyState}
          loading={consoleData.loadingMessages}
          messages={consoleData.messages}
          onAutoScrollChange={consoleData.setAutoScroll}
          onSelect={consoleData.setSelectedMessageId}
          ref={logRef}
          selectedMessageId={consoleData.selectedMessageId}
        />
      </main>
    </div>
  );
}
