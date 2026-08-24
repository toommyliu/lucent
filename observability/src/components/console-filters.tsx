import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  PauseIcon,
  PlayIcon,
} from "lucide-react";

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
import {
  consoleGenerations,
  selectedConsoleWindow,
  type ConsoleFilters,
  type GameConsoleState,
} from "@/console-model";

const ALL = "all";

interface ConsoleFiltersProps {
  readonly autoScroll: boolean;
  readonly canCopy: boolean;
  readonly canNavigate: boolean;
  readonly copyAllLabel: string;
  readonly filters: ConsoleFilters;
  readonly onAutoScrollChange: (value: boolean) => void;
  readonly onCopyAll: () => void;
  readonly onGenerationChange: (value: number | null) => void;
  readonly onNext: () => void;
  readonly onPauseChange: () => void;
  readonly onPrevious: () => void;
  readonly onQueryChange: (value: string) => void;
  readonly onUsernameChange: (value: string) => void;
  readonly onWindowChange: (value: number | null) => void;
  readonly paused: boolean;
  readonly state: GameConsoleState | null;
}

function selectedNumber(value: string | null): number | null {
  if (value === null || value === ALL) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function ConsoleFilters({
  autoScroll,
  canCopy,
  canNavigate,
  copyAllLabel,
  filters,
  onAutoScrollChange,
  onCopyAll,
  onGenerationChange,
  onNext,
  onPauseChange,
  onPrevious,
  onQueryChange,
  onUsernameChange,
  onWindowChange,
  paused,
  state,
}: ConsoleFiltersProps) {
  const windowItems: Record<string, string> = { [ALL]: "All windows" };
  for (const windowState of state?.windows ?? []) {
    windowItems[String(windowState.gameWindowId)] =
      `Window ${windowState.gameWindowId} · g${windowState.generation} · ${windowState.state}`;
  }

  const windowState = selectedConsoleWindow(state, filters.windowId);
  const generations = consoleGenerations(windowState);
  const generationItems: Record<string, string> = {
    [ALL]: "All generations",
  };
  for (const generation of generations) {
    generationItems[String(generation)] = `Generation ${generation}`;
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-2 shadow-xs/5"
      onSubmit={(event) => event.preventDefault()}
    >
      <Field className="min-w-52 flex-1 gap-1 sm:max-w-sm">
        <FieldLabel htmlFor="console-search">Search</FieldLabel>
        <Input
          id="console-search"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Message text"
          size="sm"
          type="search"
          value={filters.query}
        />
      </Field>

      <Field className="min-w-44 gap-1">
        <FieldLabel id="console-window-label">Window</FieldLabel>
        <Select<string>
          items={windowItems}
          onValueChange={(value) => onWindowChange(selectedNumber(value))}
          value={filters.windowId === null ? ALL : String(filters.windowId)}
        >
          <SelectTrigger aria-labelledby="console-window-label" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(windowItems).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field className="min-w-40 gap-1">
        <FieldLabel id="console-generation-label">Generation</FieldLabel>
        <Select<string>
          disabled={windowState === null}
          items={generationItems}
          onValueChange={(value) => onGenerationChange(selectedNumber(value))}
          value={filters.generation === null ? ALL : String(filters.generation)}
        >
          <SelectTrigger aria-labelledby="console-generation-label" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(generationItems).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field className="min-w-36 gap-1">
        <FieldLabel htmlFor="console-username">Username</FieldLabel>
        <Input
          id="console-username"
          onChange={(event) => onUsernameChange(event.currentTarget.value)}
          placeholder="Exact username"
          size="sm"
          type="search"
          value={filters.username}
        />
      </Field>

      <div
        aria-label="Console actions"
        className="flex flex-wrap items-center gap-1"
        role="group"
      >
        <Button
          disabled={!canNavigate}
          onClick={onPrevious}
          size="sm"
          variant="outline"
        >
          <ChevronUpIcon aria-hidden="true" strokeWidth={1.5} />
          Previous
        </Button>
        <Button
          disabled={!canNavigate}
          onClick={onNext}
          size="sm"
          variant="outline"
        >
          <ChevronDownIcon aria-hidden="true" strokeWidth={1.5} />
          Next
        </Button>
        <Button
          aria-pressed={paused}
          onClick={onPauseChange}
          size="sm"
          variant="outline"
        >
          {paused ? (
            <PlayIcon aria-hidden="true" strokeWidth={1.5} />
          ) : (
            <PauseIcon aria-hidden="true" strokeWidth={1.5} />
          )}
          {paused ? "Resume" : "Pause"}
        </Button>
        <Button
          aria-pressed={autoScroll}
          onClick={() => onAutoScrollChange(!autoScroll)}
          size="sm"
          variant="outline"
        >
          Auto-scroll {autoScroll ? "on" : "off"}
        </Button>
        <Button
          disabled={!canCopy}
          onClick={onCopyAll}
          size="sm"
          variant="outline"
        >
          <CopyIcon aria-hidden="true" strokeWidth={1.5} />
          {copyAllLabel}
        </Button>
      </div>
    </form>
  );
}
