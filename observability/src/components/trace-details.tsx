import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  formatDuration,
  traceOutcome,
  type DesktopTraceSpan,
} from "@/trace-model";

interface TraceDetailsProps {
  readonly span: DesktopTraceSpan | null;
}

const OUTCOME_VARIANT = {
  Failure: "error",
  Interrupted: "warning",
  Success: "success",
} as const;

export function TraceDetails({ span }: TraceDetailsProps) {
  return (
    <aside
      aria-labelledby="span-details-heading"
      className="size-full min-h-0 overflow-auto rounded-lg border bg-card p-3 shadow-xs/5"
    >
      <h2
        className="text-wrap-balance text-sm font-semibold break-words"
        id="span-details-heading"
      >
        {span?.name ?? "Select a span"}
      </h2>

      {span === null ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Select a waterfall row to inspect its attributes, events, links, and
          failure details.
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="min-w-0 font-mono tabular-nums">
              {formatDuration(span.durationMs)}
            </dd>
            <dt className="text-muted-foreground">Outcome</dt>
            <dd>
              <Badge size="sm" variant={OUTCOME_VARIANT[traceOutcome(span)]}>
                {traceOutcome(span)}
              </Badge>
            </dd>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="min-w-0 font-mono">{span.source}</dd>
            <dt className="text-muted-foreground">Trace</dt>
            <dd className="min-w-0 font-mono break-all" translate="no">
              {span.traceId}
            </dd>
            <dt className="text-muted-foreground">Span</dt>
            <dd className="min-w-0 font-mono break-all" translate="no">
              {span.spanId}
            </dd>
            <dt className="text-muted-foreground">Parent</dt>
            <dd className="min-w-0 font-mono break-all" translate="no">
              {span.parentSpanId ?? "Root"}
            </dd>
          </dl>
          <Separator className="my-3" />
          <pre
            className="overflow-auto rounded-md border bg-background p-2 font-mono text-[0.6875rem] leading-relaxed break-words whitespace-pre-wrap tabular-nums"
            tabIndex={0}
          >
            {JSON.stringify(
              {
                attributes: span.attributes,
                events: span.events,
                links: span.links,
                exit: span.exit,
              },
              null,
              2,
            )}
          </pre>
        </>
      )}
    </aside>
  );
}
