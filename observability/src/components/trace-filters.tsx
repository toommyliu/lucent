import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OutcomeFilter, SourceFilter, TimelineScale } from "@/trace-model";

const OUTCOME_LABELS: Record<OutcomeFilter, string> = {
  all: "All outcomes",
  Failure: "Failures",
  Interrupted: "Interrupted",
  Success: "Success",
};

const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: "All sources",
  effect: "Main / Effect",
  renderer: "Renderer",
};

const SCALE_LABELS: Record<TimelineScale, string> = {
  fit: "Fit launch",
  "0.05": "0.05 px/ms",
  "0.2": "0.2 px/ms",
  "1": "1 px/ms",
  "4": "4 px/ms",
};

interface TraceFiltersProps {
  readonly autoScroll: boolean;
  readonly loading: boolean;
  readonly onAutoScrollChange: (value: boolean) => void;
  readonly onOutcomeChange: (value: OutcomeFilter) => void;
  readonly onQueryChange: (value: string) => void;
  readonly onRefresh: () => void;
  readonly onScaleChange: (value: TimelineScale) => void;
  readonly onSourceChange: (value: SourceFilter) => void;
  readonly outcome: OutcomeFilter;
  readonly query: string;
  readonly scale: TimelineScale;
  readonly source: SourceFilter;
}

export function TraceFilters({
  autoScroll,
  loading,
  onAutoScrollChange,
  onOutcomeChange,
  onQueryChange,
  onRefresh,
  onScaleChange,
  onSourceChange,
  outcome,
  query,
  scale,
  source,
}: TraceFiltersProps) {
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-2 shadow-xs/5"
      onSubmit={(event) => event.preventDefault()}
    >
      <Field className="min-w-56 flex-1 gap-1 sm:max-w-md">
        <FieldLabel htmlFor="trace-search">Search</FieldLabel>
        <Input
          id="trace-search"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Span, channel, renderer, trace ID"
          size="sm"
          type="search"
          value={query}
        />
      </Field>

      <Field className="min-w-36 gap-1">
        <FieldLabel id="outcome-label">Outcome</FieldLabel>
        <Select<OutcomeFilter>
          items={OUTCOME_LABELS}
          onValueChange={(value) => value !== null && onOutcomeChange(value)}
          value={outcome}
        >
          <SelectTrigger aria-labelledby="outcome-label" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field className="min-w-36 gap-1">
        <FieldLabel id="source-label">Source</FieldLabel>
        <Select<SourceFilter>
          items={SOURCE_LABELS}
          onValueChange={(value) => value !== null && onSourceChange(value)}
          value={source}
        >
          <SelectTrigger aria-labelledby="source-label" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field className="min-w-36 gap-1">
        <FieldLabel id="timeline-scale-label">Timeline scale</FieldLabel>
        <Select<TimelineScale>
          items={SCALE_LABELS}
          onValueChange={(value) => value !== null && onScaleChange(value)}
          value={scale}
        >
          <SelectTrigger aria-labelledby="timeline-scale-label" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SCALE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Button loading={loading} onClick={onRefresh} size="sm" variant="outline">
        Refresh traces
      </Button>
      <Button
        aria-pressed={autoScroll}
        onClick={() => onAutoScrollChange(!autoScroll)}
        size="sm"
        variant="outline"
      >
        Auto-scroll {autoScroll ? "on" : "off"}
      </Button>
    </form>
  );
}
