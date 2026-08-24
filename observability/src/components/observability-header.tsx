import { segmentedControlItemVariants } from "@/lib/segmented-control";
import { ThemeToggle } from "@/components/theme-toggle";

export type ObservabilityView = "console" | "traces";

interface ObservabilityHeaderProps {
  readonly currentView: ObservabilityView;
  readonly status: string;
  readonly statusTitle?: string;
}

export function ObservabilityHeader({
  currentView,
  status,
  statusTitle = status,
}: ObservabilityHeaderProps) {
  return (
    <header className="flex min-h-10 items-center gap-3 rounded-lg border bg-card px-3 py-1.5 shadow-xs/5">
      <h1 className="sr-only">
        Lucent {currentView === "console" ? "console" : "traces"}
      </h1>
      <nav
        aria-label="Observability views"
        className="flex items-center gap-0.5"
      >
        <a
          aria-current={currentView === "console" ? "page" : undefined}
          className={segmentedControlItemVariants({
            size: "sm",
            state: currentView === "console" ? "current" : undefined,
          })}
          href="/?view=console"
        >
          Console
        </a>
        <a
          aria-current={currentView === "traces" ? "page" : undefined}
          className={segmentedControlItemVariants({
            size: "sm",
            state: currentView === "traces" ? "current" : undefined,
          })}
          href="/?view=traces"
        >
          Traces
        </a>
      </nav>
      <div
        className="ms-auto min-w-0 truncate text-[0.6875rem] text-muted-foreground tabular-nums"
        role="status"
        title={statusTitle}
      >
        {status}
      </div>
      <ThemeToggle />
    </header>
  );
}
