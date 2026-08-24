import { useVirtualizer } from "@tanstack/react-virtual";
import { CopyIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { writeClipboardText } from "@/console-clipboard";
import type { GameConsoleMessage } from "@/console-model";
import { cn } from "@/lib/utils";

const CONSOLE_HEADER_HEIGHT = 32;
const CONSOLE_ROW_ESTIMATE = 36;

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

export interface ConsoleLogHandle {
  readonly next: () => void;
  readonly previous: () => void;
}

interface ConsoleLogEmptyState {
  readonly action?: {
    readonly label: string;
    readonly run: () => void;
  };
  readonly description: string;
  readonly title: string;
}

interface ConsoleLogProps {
  readonly autoScroll: boolean;
  readonly emptyState: ConsoleLogEmptyState;
  readonly loading: boolean;
  readonly messages: readonly GameConsoleMessage[];
  readonly onAutoScrollChange: (value: boolean) => void;
  readonly onSelect: (id: number) => void;
  readonly selectedMessageId: number | null;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  const parts = TIME_FORMATTER.formatToParts(date);
  const period = parts.find((part) => part.type === "dayPeriod")?.value;
  const time = parts
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${time}.${milliseconds}${period === undefined ? "" : ` ${period}`}`;
}

interface ConsoleMessageRowProps {
  readonly index: number;
  readonly message: GameConsoleMessage;
  readonly onSelect: (id: number) => void;
  readonly selected: boolean;
  readonly setMeasureElement: (element: Element | null) => void;
  readonly top: number;
}

function ConsoleMessageRow({
  index,
  message,
  onSelect,
  selected,
  setMeasureElement,
  top,
}: ConsoleMessageRowProps) {
  const [copyLabel, setCopyLabel] = React.useState("Copy");
  const resetTimer = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
      }
    },
    [],
  );

  const copyMessage = async () => {
    try {
      await writeClipboardText(message.message);
      setCopyLabel("Copied");
      resetTimer.current = window.setTimeout(() => setCopyLabel("Copy"), 900);
    } catch {
      setCopyLabel("Copy failed");
      resetTimer.current = window.setTimeout(() => setCopyLabel("Copy"), 1_200);
    }
  };

  const select = () => onSelect(message.id);

  return (
    <div
      aria-current={selected ? "true" : undefined}
      aria-rowindex={index + 2}
      className={cn(
        "group absolute start-0 grid w-full grid-cols-[7.5rem_7rem_9rem_minmax(32rem,1fr)] items-stretch border-b text-xs outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        selected && "bg-accent",
      )}
      data-index={index}
      data-message-id={message.id}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      }}
      ref={setMeasureElement}
      role="row"
      style={{ top }}
      tabIndex={0}
    >
      <div
        className={cn(
          "sticky start-0 z-10 border-e bg-background px-2 py-1.5 font-mono tabular-nums group-hover:bg-muted/40",
          selected && "bg-accent",
        )}
        role="cell"
        title={message.at}
      >
        <span className="sticky top-9 block">{formatTime(message.at)}</span>
      </div>
      <div
        className={cn(
          "sticky start-[7.5rem] z-10 border-e bg-background px-2 py-1.5 font-mono tabular-nums group-hover:bg-muted/40",
          selected && "bg-accent",
        )}
        role="cell"
      >
        <span className="sticky top-9 block">
          {message.gameWindowId} · g{message.generation}
        </span>
      </div>
      <div
        className={cn(
          "sticky start-[14.5rem] z-10 border-e bg-background px-2 py-1.5 font-mono group-hover:bg-muted/40",
          selected && "bg-accent",
        )}
        role="cell"
      >
        <span className="sticky top-9 block break-words">
          {message.username ?? ""}
        </span>
      </div>
      <div
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 px-2 py-1.5 font-mono leading-relaxed"
        role="cell"
      >
        <Button
          className="sticky top-9"
          onClick={(event) => {
            event.stopPropagation();
            void copyMessage();
          }}
          size="xs"
          variant="ghost"
        >
          <CopyIcon aria-hidden="true" strokeWidth={1.5} />
          {copyLabel}
        </Button>
        <span
          className="min-w-0 break-words whitespace-pre-wrap"
          translate="no"
        >
          {message.message}
        </span>
      </div>
    </div>
  );
}

export const ConsoleLog = React.forwardRef<ConsoleLogHandle, ConsoleLogProps>(
  function ConsoleLog(
    {
      autoScroll,
      emptyState,
      loading,
      messages,
      onAutoScrollChange,
      onSelect,
      selectedMessageId,
    },
    ref,
  ) {
    const scrollRef = React.useRef<HTMLDivElement>(null);

    // TanStack Virtual intentionally returns mutable callbacks that React Compiler skips.
    // eslint-disable-next-line react-hooks/incompatible-library
    const virtualizer = useVirtualizer({
      count: messages.length,
      estimateSize: () => CONSOLE_ROW_ESTIMATE,
      getItemKey: (index) => messages[index]!.id,
      getScrollElement: () => scrollRef.current,
      measureElement: (element) => element.getBoundingClientRect().height,
      overscan: 12,
      paddingStart: CONSOLE_HEADER_HEIGHT,
      scrollPaddingStart: CONSOLE_HEADER_HEIGHT,
    });

    const scrollToAdjacent = React.useCallback(
      (direction: "next" | "previous") => {
        if (messages.length === 0) {
          return;
        }

        onAutoScrollChange(false);
        const selectedIndex =
          selectedMessageId === null
            ? -1
            : messages.findIndex((message) => message.id === selectedMessageId);
        const scrollOffset = virtualizer.scrollOffset ?? 0;
        const currentIndex =
          virtualizer
            .getVirtualItems()
            .find((row) => row.end > scrollOffset + CONSOLE_HEADER_HEIGHT)
            ?.index ?? 0;
        const baseIndex = selectedIndex === -1 ? currentIndex : selectedIndex;
        const delta = direction === "next" ? 1 : -1;
        const nextIndex = Math.max(
          0,
          Math.min(messages.length - 1, baseIndex + delta),
        );
        const nextMessage = messages[nextIndex];
        if (nextMessage === undefined) {
          return;
        }

        onSelect(nextMessage.id);
        virtualizer.scrollToIndex(nextIndex, { align: "start" });
      },
      [messages, onAutoScrollChange, onSelect, selectedMessageId, virtualizer],
    );

    React.useImperativeHandle(
      ref,
      () => ({
        next: () => scrollToAdjacent("next"),
        previous: () => scrollToAdjacent("previous"),
      }),
      [scrollToAdjacent],
    );

    React.useLayoutEffect(() => {
      if (!autoScroll || messages.length === 0) {
        return;
      }
      const frame = window.requestAnimationFrame(() => {
        virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
      });
      return () => window.cancelAnimationFrame(frame);
    }, [autoScroll, messages, virtualizer]);

    return (
      <section
        aria-labelledby="console-log-heading"
        className="size-full min-h-0 overflow-hidden rounded-lg border bg-card shadow-xs/5"
      >
        <h2 className="sr-only" id="console-log-heading">
          Console messages
        </h2>
        <div
          aria-busy={loading}
          aria-colcount={4}
          aria-rowcount={messages.length + 1}
          className="size-full overflow-auto overscroll-contain [overflow-anchor:none]"
          ref={scrollRef}
          role="table"
          tabIndex={0}
        >
          <div
            className="relative min-w-[55.5rem]"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            <div
              aria-rowindex={1}
              className="sticky top-0 z-30 grid h-8 grid-cols-[7.5rem_7rem_9rem_minmax(32rem,1fr)] bg-card text-xs text-muted-foreground"
              role="row"
            >
              <div
                className="sticky start-0 z-40 border-e border-b bg-card px-2 py-2 font-medium"
                role="columnheader"
              >
                Time
              </div>
              <div
                className="sticky start-[7.5rem] z-40 border-e border-b bg-card px-2 py-2 font-medium"
                role="columnheader"
              >
                Window · Gen
              </div>
              <div
                className="sticky start-[14.5rem] z-40 border-e border-b bg-card px-2 py-2 font-medium"
                role="columnheader"
              >
                Username
              </div>
              <div
                className="border-b bg-card px-2 py-2 font-medium"
                role="columnheader"
              >
                Message
              </div>
            </div>

            {messages.length === 0 ? (
              <Empty className="absolute inset-x-0 top-8 min-h-64">
                <EmptyHeader>
                  <EmptyTitle className="text-base">
                    {emptyState.title}
                  </EmptyTitle>
                  <EmptyDescription>{emptyState.description}</EmptyDescription>
                </EmptyHeader>
                {emptyState.action !== undefined && (
                  <EmptyContent>
                    <Button
                      onClick={emptyState.action.run}
                      size="sm"
                      variant="outline"
                    >
                      {emptyState.action.label}
                    </Button>
                  </EmptyContent>
                )}
              </Empty>
            ) : (
              virtualizer.getVirtualItems().map((virtualRow) => {
                const message = messages[virtualRow.index]!;
                return (
                  <ConsoleMessageRow
                    index={virtualRow.index}
                    key={virtualRow.key}
                    message={message}
                    onSelect={onSelect}
                    selected={message.id === selectedMessageId}
                    setMeasureElement={virtualizer.measureElement}
                    top={virtualRow.start}
                  />
                );
              })
            )}
          </div>
        </div>
      </section>
    );
  },
);
