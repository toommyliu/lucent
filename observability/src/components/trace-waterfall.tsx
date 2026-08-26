import { useVirtualizer } from "@tanstack/react-virtual";
import { Tooltip } from "@base-ui/react/tooltip";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleCheckIcon,
  CirclePauseIcon,
  CircleXIcon,
} from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  asNanos,
  formatDuration,
  TRACE_AXIS_HEIGHT,
  TRACE_LABEL_WIDTH,
  TRACE_ROW_HEIGHT,
  TRACE_TIMELINE_GUTTER,
  traceDepths,
  traceKey,
  traceOutcome,
  type DesktopTraceSpan,
  type TimelineScale,
} from "@/trace-model";

const SCALE_PX_PER_MS: Record<Exclude<TimelineScale, "fit">, number> = {
  "0.05": 0.05,
  "0.2": 0.2,
  "1": 1,
  "4": 4,
};

const OUTCOME_ICON = {
  Failure: CircleXIcon,
  Interrupted: CirclePauseIcon,
  Success: CircleCheckIcon,
} as const;

interface EmptyState {
  readonly action?: {
    readonly label: string;
    readonly run: () => void;
  };
  readonly description: string;
  readonly title: string;
}

interface TraceWaterfallProps {
  readonly allSpans: readonly DesktopTraceSpan[];
  readonly autoScroll: boolean;
  readonly emptyState: EmptyState;
  readonly onSelect: (span: DesktopTraceSpan) => void;
  readonly scale: TimelineScale;
  readonly selectedKey: string | null;
  readonly spans: readonly DesktopTraceSpan[];
}

interface TraceStyle extends React.CSSProperties {
  "--trace-label-width": string;
  "--trace-timeline-gutter": string;
  "--trace-timeline-width": string;
}

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState(0);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }

    const update = () => setWidth(element.clientWidth);
    const observer = new ResizeObserver(update);
    update();
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

interface TraceSpanRowProps {
  readonly depth: number;
  readonly height: number;
  readonly left: string;
  readonly onSelect: (span: DesktopTraceSpan) => void;
  readonly selected: boolean;
  readonly span: DesktopTraceSpan;
  readonly top: number;
  readonly width: string;
}

function TraceSpanRow({
  depth,
  height,
  left,
  onSelect,
  selected,
  span,
  top,
  width,
}: TraceSpanRowProps) {
  const [tooltipOpen, setTooltipOpen] = React.useState(false);
  const outcome = traceOutcome(span);
  const OutcomeIcon = OUTCOME_ICON[outcome];

  return (
    <Tooltip.Root onOpenChange={setTooltipOpen} open={tooltipOpen}>
      <button
        aria-current={selected ? "true" : undefined}
        aria-label={`${span.name}, ${formatDuration(span.durationMs)}, ${outcome}`}
        className="trace-row trace-span-row group absolute start-0 w-full cursor-pointer border-0 text-start outline-none"
        onBlur={() => setTooltipOpen(false)}
        onClick={() => onSelect(span)}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) {
            setTooltipOpen(true);
          }
        }}
        style={{ height: `${height}px`, top: `${top}px` }}
        type="button"
      >
        <Tooltip.Trigger
          className="trace-name-cell flex min-w-0 items-center gap-1.5 pe-2 font-mono text-xs"
          render={<span />}
          style={{
            paddingInlineStart: `${10 + Math.min(depth, 8) * 14}px`,
          }}
        >
          <OutcomeIcon
            aria-hidden="true"
            className={`size-3.5 shrink-0 trace-outcome-${outcome.toLocaleLowerCase()}`}
            strokeWidth={1.5}
          />
          <Badge className="shrink-0 font-sans" size="sm" variant="secondary">
            {span.source}
          </Badge>
          <span className="block min-w-0 flex-1 truncate" translate="no">
            {span.name}
          </span>
        </Tooltip.Trigger>
        <span aria-hidden="true" className="trace-timeline-cell block">
          <span className="trace-timeline-track relative block h-full">
            <span
              className={`trace-span-bar trace-outcome-${outcome.toLocaleLowerCase()}`}
              style={{ insetInlineStart: left, width }}
            />
          </span>
        </span>
      </button>
      <Tooltip.Portal>
        <Tooltip.Positioner
          align="center"
          className="z-50"
          collisionPadding={8}
          positionMethod="fixed"
          side="inline-end"
          sideOffset={6}
        >
          <Tooltip.Popup
            className="max-w-[min(28rem,calc(100vw-1rem))] rounded-md bg-primary px-2 py-1 font-mono text-xs break-words text-primary-foreground shadow-md"
            translate="no"
          >
            {span.name}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function TraceWaterfall({
  allSpans,
  autoScroll,
  emptyState,
  onSelect,
  scale,
  selectedKey,
  spans,
}: TraceWaterfallProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [horizontalOffset, setHorizontalOffset] = React.useState(0);
  const viewportWidth = useElementWidth(scrollRef);
  const depths = React.useMemo(() => traceDepths(allSpans), [allSpans]);

  const firstStart =
    allSpans.length === 0 ? 0n : asNanos(allSpans[0]!.startTimeUnixNano);
  const lastEnd = allSpans.reduce((latest, span) => {
    const end = asNanos(span.endTimeUnixNano);
    return end > latest ? end : latest;
  }, firstStart + 1n);
  const rangeNanos = lastEnd > firstStart ? lastEnd - firstStart : 1n;
  const totalMs = Number(rangeNanos) / 1_000_000;
  const fitWidth = Math.max(
    320,
    viewportWidth - TRACE_LABEL_WIDTH - TRACE_TIMELINE_GUTTER * 2,
  );
  const pxPerMs = scale === "fit" ? null : SCALE_PX_PER_MS[scale];
  const timelineWidth =
    pxPerMs === null ? fitWidth : Math.max(fitWidth, totalMs * pxPerMs);

  // TanStack Virtual intentionally returns mutable callbacks that React Compiler skips.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: spans.length,
    estimateSize: () => TRACE_ROW_HEIGHT,
    getItemKey: (index) => traceKey(spans[index]!),
    getScrollElement: () => scrollRef.current,
    overscan: 12,
    paddingStart: TRACE_AXIS_HEIGHT,
  });

  const style: TraceStyle = {
    "--trace-label-width": `${TRACE_LABEL_WIDTH}px`,
    "--trace-timeline-gutter": `${TRACE_TIMELINE_GUTTER}px`,
    "--trace-timeline-width": `${Math.round(timelineWidth)}px`,
  };

  const virtualRows = virtualizer.getVirtualItems();
  const selectedVirtualRow =
    selectedKey === null
      ? undefined
      : virtualRows.find(
          (virtualRow) => traceKey(spans[virtualRow.index]!) === selectedKey,
        );
  const selectedSpan =
    selectedVirtualRow === undefined
      ? undefined
      : spans[selectedVirtualRow.index];
  // Use scroll-content coordinates so the sticky name column is excluded from
  // the portion of the timeline where a selected bar can actually be seen.
  const selectedBarBounds = (() => {
    if (selectedSpan === undefined) {
      return undefined;
    }

    const offsetNanos = asNanos(selectedSpan.startTimeUnixNano) - firstStart;
    const offsetPx =
      pxPerMs === null
        ? (Number(offsetNanos) / Number(rangeNanos)) * timelineWidth
        : (Number(offsetNanos) / 1_000_000) * pxPerMs;
    const widthPx =
      pxPerMs === null
        ? Math.max(3, (selectedSpan.durationMs / totalMs) * timelineWidth)
        : Math.max(3, selectedSpan.durationMs * pxPerMs);
    const left = TRACE_LABEL_WIDTH + TRACE_TIMELINE_GUTTER + offsetPx;

    return { left, right: left + widthPx };
  })();
  const visibleTimelineStart =
    horizontalOffset + TRACE_LABEL_WIDTH + TRACE_TIMELINE_GUTTER;
  const visibleTimelineEnd =
    horizontalOffset + viewportWidth - TRACE_TIMELINE_GUTTER;
  const revealDirection =
    selectedBarBounds === undefined || viewportWidth === 0
      ? undefined
      : selectedBarBounds.right <= visibleTimelineStart
        ? "left"
        : selectedBarBounds.left >= visibleTimelineEnd
          ? "right"
          : undefined;

  const revealSelectedSpan = () => {
    const scrollElement = scrollRef.current;
    if (scrollElement === null || selectedBarBounds === undefined) {
      return;
    }

    const barCenter =
      selectedBarBounds.left +
      (selectedBarBounds.right - selectedBarBounds.left) / 2;
    const visibleTimelineCenter =
      (TRACE_LABEL_WIDTH + scrollElement.clientWidth) / 2;
    const targetLeft = Math.max(
      0,
      Math.min(
        scrollElement.scrollWidth - scrollElement.clientWidth,
        barCenter - visibleTimelineCenter,
      ),
    );
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth";

    scrollElement.focus({ preventScroll: true });
    scrollElement.scrollTo({
      behavior,
      left: targetLeft,
      top: scrollElement.scrollTop,
    });
  };

  const newestSpanKey =
    spans.length === 0 ? null : traceKey(spans[spans.length - 1]!);

  React.useLayoutEffect(() => {
    if (!autoScroll || newestSpanKey === null) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const scrollElement = scrollRef.current;
      if (scrollElement !== null) {
        scrollElement.scrollTo({
          left: scrollElement.scrollLeft,
          top: scrollElement.scrollHeight,
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoScroll, newestSpanKey]);

  return (
    <Tooltip.Provider closeDelay={0} delay={250}>
      <section
        aria-labelledby="waterfall-heading"
        className="size-full min-h-0 overflow-hidden rounded-lg border bg-card shadow-xs/5"
      >
        <h2 className="sr-only" id="waterfall-heading">
          Trace waterfall
        </h2>
        <div
          aria-busy={emptyState.title === "Loading traces"}
          className="trace-scroll size-full overflow-auto overscroll-contain [overflow-anchor:none]"
          id="trace-waterfall-scroll"
          onScroll={(event) => {
            const nextOffset = event.currentTarget.scrollLeft;
            setHorizontalOffset((currentOffset) =>
              currentOffset === nextOffset ? currentOffset : nextOffset,
            );
          }}
          ref={scrollRef}
          style={style}
          tabIndex={0}
        >
          <div
            className="relative min-w-[calc(var(--trace-label-width)+var(--trace-timeline-width))]"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            <div className="trace-row trace-axis-row">
              <div className="trace-name-cell z-30 px-2.5 py-2 text-xs font-medium text-muted-foreground">
                Span
              </div>
              <div
                aria-hidden="true"
                className="trace-timeline-cell text-[0.6875rem] text-muted-foreground tabular-nums"
              >
                <div className="trace-timeline-track relative h-full">
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                    <span
                      className={`absolute top-0 h-full border-border/80 ps-1 pt-2 whitespace-nowrap ${ratio === 0 ? "" : "border-s"}`}
                      key={ratio}
                      style={{
                        insetInlineStart: `${ratio * 100}%`,
                        translate: ratio === 1 ? "-100% 0" : undefined,
                      }}
                    >
                      {formatDuration(totalMs * ratio)}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {spans.length === 0 ? (
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
              virtualRows.map((virtualRow) => {
                const span = spans[virtualRow.index]!;
                const key = traceKey(span);
                const selected = key === selectedKey;
                const offsetNanos =
                  asNanos(span.startTimeUnixNano) - firstStart;
                const left =
                  pxPerMs === null
                    ? `${Number((offsetNanos * 100_000n) / rangeNanos) / 1_000}%`
                    : `${(Number(offsetNanos) / 1_000_000) * pxPerMs}px`;
                const width =
                  pxPerMs === null
                    ? `max(3px, ${Math.max(
                        0.001,
                        Number(
                          (BigInt(
                            Math.max(
                              1,
                              Math.round(span.durationMs * 1_000_000),
                            ),
                          ) *
                            100_000n) /
                            rangeNanos,
                        ) / 1_000,
                      )}%)`
                    : `${Math.max(3, span.durationMs * pxPerMs)}px`;

                return (
                  <TraceSpanRow
                    depth={depths.get(key) ?? 0}
                    height={virtualRow.size}
                    key={virtualRow.key}
                    left={left}
                    onSelect={onSelect}
                    selected={selected}
                    span={span}
                    top={virtualRow.start}
                    width={width}
                  />
                );
              })
            )}

            {revealDirection !== undefined &&
              selectedVirtualRow !== undefined && (
                <Button
                  aria-controls="trace-waterfall-scroll"
                  aria-label={`Reveal selected span to the ${revealDirection}`}
                  className={`absolute z-20 -translate-y-1/2 rounded-full shadow-md ${revealDirection === "right" ? "-translate-x-full" : ""}`}
                  onClick={revealSelectedSpan}
                  size="icon-sm"
                  style={{
                    insetInlineStart:
                      revealDirection === "left"
                        ? `${horizontalOffset + TRACE_LABEL_WIDTH + TRACE_TIMELINE_GUTTER + 8}px`
                        : `${horizontalOffset + viewportWidth - TRACE_TIMELINE_GUTTER - 8}px`,
                    top: `${selectedVirtualRow.start + selectedVirtualRow.size / 2}px`,
                  }}
                  title={`Reveal selected span to the ${revealDirection}`}
                  variant="outline"
                >
                  {revealDirection === "left" ? (
                    <ArrowLeftIcon aria-hidden="true" strokeWidth={1.5} />
                  ) : (
                    <ArrowRightIcon aria-hidden="true" strokeWidth={1.5} />
                  )}
                </Button>
              )}
          </div>
        </div>
      </section>
    </Tooltip.Provider>
  );
}
