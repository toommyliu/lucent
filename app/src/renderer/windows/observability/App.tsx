/* @refresh reload */
import "../../styles.css";
import "./style.css";
import {
  AppShell,
  Badge,
  Checkbox,
  Icon,
  Input,
  TooltipIconButton,
} from "@lucent/ui";
import { createVirtualizer, type VirtualItem } from "@tanstack/solid-virtual";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";
import { render } from "solid-js/web";
import {
  isObservabilityConsoleMessageData,
  type ObservabilityLevel,
  type ObservabilityRecord,
} from "../../../shared/observability";
import { downloadText } from "../../lib/download";
import {
  allWindowsFilter,
  consoleRecordKey,
  consoleLevelOptions,
  consoleRecordWindowComponents,
  excludeConsoleRecordKeys,
  exportConsoleRecords,
  filterConsoleRecords,
  formatConsoleRecordWindowComponent,
  formatConsoleTimestamp,
  mergeConsoleRecords,
  type ConsoleWindowAccount,
} from "./model";

type ConnectionState =
  | "connecting"
  | "live"
  | "paused"
  | "reconnecting"
  | "error";

const snapshotPath = "/api/observability/console/snapshot";
const eventsPath = "/api/observability/console/events";
const windowsPath = "/api/observability/console/windows";
const consoleRowHeight = 38;
const consoleWrappedRowHeightEstimate = 88;
const consoleRowOverscan = 16;
const snapshotReconcileIntervalMs = 2_000;
const followTailThresholdPx = consoleRowHeight * 2;

type ConsoleVirtualRow = {
  readonly record: ObservabilityRecord;
  readonly item: VirtualItem;
};

interface ConsoleWindowMetadata {
  readonly component: string;
  readonly account?: ConsoleWindowAccount;
}

const readSnapshot = async (): Promise<readonly ObservabilityRecord[]> => {
  const response = await fetch(snapshotPath, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Snapshot request failed: ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as readonly ObservabilityRecord[]) : [];
};

const readWindowMetadata = async (): Promise<
  readonly ConsoleWindowMetadata[]
> => {
  const response = await fetch(windowsPath, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Window metadata request failed: ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as readonly ConsoleWindowMetadata[]) : [];
};

const statusVariant = (
  state: ConnectionState,
): "success" | "warning" | "error" | "info" =>
  state === "live"
    ? "success"
    : state === "paused" || state === "reconnecting"
      ? "warning"
      : state === "error"
        ? "error"
        : "info";

const levelLabel = (level: ObservabilityLevel): string =>
  level === "warn" ? "warning" : level;

const recordSourceLabel = (record: ObservabilityRecord): string => {
  const data = isObservabilityConsoleMessageData(record.data)
    ? record.data
    : null;
  return data === null ? "-" : `${data.sourceId}:${data.line}`;
};

function App() {
  const [records, setRecords] = createSignal<readonly ObservabilityRecord[]>(
    [],
  );
  const [live, setLive] = createSignal(true);
  const [connectionState, setConnectionState] =
    createSignal<ConnectionState>("connecting");
  const [enabledLevels, setEnabledLevels] = createSignal<
    readonly ObservabilityLevel[]
  >([...consoleLevelOptions]);
  const [hiddenRecordKeys, setHiddenRecordKeys] = createSignal<
    ReadonlySet<string>
  >(new Set());
  const [windowAccounts, setWindowAccounts] = createSignal<
    ReadonlyMap<string, ConsoleWindowAccount>
  >(new Map());
  const [windowComponent, setWindowComponent] = createSignal(allWindowsFilter);
  const [wrapMessages, setWrapMessages] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [copiedMessageKey, setCopiedMessageKey] = createSignal("");
  let tableViewport: HTMLDivElement | undefined;
  let copiedMessageTimeout: ReturnType<typeof setTimeout> | undefined;

  const levelSet = createMemo(() => new Set(enabledLevels()));
  const windowComponents = createMemo(() =>
    consoleRecordWindowComponents(records()),
  );
  const windowLabels = createMemo(
    () =>
      new Map(
        windowComponents().map((component) => [
          component,
          formatConsoleRecordWindowComponent(
            component,
            records(),
            windowAccounts().get(component),
          ),
        ]),
      ),
  );
  const windowLabel = (component: string): string =>
    windowLabels().get(component) ?? component;
  const visibleRecords = createMemo(() =>
    filterConsoleRecords(records(), {
      accountsByComponent: windowAccounts(),
      levels: levelSet(),
      search: search(),
      windowComponent: windowComponent(),
    }),
  );
  const tableVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return visibleRecords().length;
    },
    estimateSize: () =>
      wrapMessages() ? consoleWrappedRowHeightEstimate : consoleRowHeight,
    getItemKey: (index) => {
      const record = visibleRecords()[index];
      return record === undefined ? index : `${record.runId}:${record.id}`;
    },
    getScrollElement: () => tableViewport ?? null,
    measureElement: (element) =>
      wrapMessages()
        ? Math.max(
            consoleRowHeight,
            Math.ceil(element.getBoundingClientRect().height),
          )
        : consoleRowHeight,
    overscan: consoleRowOverscan,
  });
  const virtualRows = createMemo<readonly ConsoleVirtualRow[]>(() => {
    const entries = visibleRecords();
    const rows: ConsoleVirtualRow[] = [];

    for (const item of tableVirtualizer.getVirtualItems()) {
      const record = entries[item.index];
      if (record) {
        rows.push({ item, record });
      }
    }

    return rows;
  });
  const isFollowingTail = (): boolean => {
    const viewport = tableViewport;
    if (viewport === undefined) {
      return true;
    }

    return (
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
      followTailThresholdPx
    );
  };
  const scrollToLatest = (): void => {
    queueMicrotask(() => {
      const count = visibleRecords().length;
      if (count > 0) {
        tableVirtualizer.scrollToIndex(count - 1, { align: "end" });
      }
    });
  };
  const mergeRecords = (
    nextRecords: readonly ObservabilityRecord[],
    options: { readonly followTail?: boolean } = {},
  ): void => {
    const shouldFollowTail = options.followTail ?? isFollowingTail();
    const hiddenKeys = hiddenRecordKeys();
    const visibleNextRecords = excludeConsoleRecordKeys(
      nextRecords,
      hiddenKeys,
    );
    setRecords((current) =>
      excludeConsoleRecordKeys(
        mergeConsoleRecords(current, visibleNextRecords),
        hiddenKeys,
      ),
    );
    if (shouldFollowTail) {
      scrollToLatest();
    }
  };
  const applyWindowMetadata = (
    metadata: readonly ConsoleWindowMetadata[],
  ): void => {
    setWindowAccounts(
      new Map(
        metadata.flatMap((windowMetadata) =>
          windowMetadata.account === undefined
            ? []
            : [[windowMetadata.component, windowMetadata.account]],
        ),
      ),
    );
  };
  const copyRecordMessage = async (
    record: ObservabilityRecord,
  ): Promise<void> => {
    try {
      await navigator.clipboard.writeText(record.message);
      setCopiedMessageKey(consoleRecordKey(record));
      setNotice("Message copied");
      if (copiedMessageTimeout !== undefined) {
        clearTimeout(copiedMessageTimeout);
      }
      copiedMessageTimeout = setTimeout(() => {
        setCopiedMessageKey("");
        copiedMessageTimeout = undefined;
      }, 1200);
    } catch {
      setNotice("Copy failed");
    }
  };

  const ConsoleRecordRow = (props: {
    readonly item: VirtualItem;
    readonly record: ObservabilityRecord;
  }): JSX.Element => (
    <div
      aria-rowindex={props.item.index + 2}
      class="observability-viewer__row"
      data-level={props.record.level}
      ref={(element) => {
        element.setAttribute("data-index", String(props.item.index));
        if (wrapMessages()) {
          tableVirtualizer.measureElement(element);
        }
      }}
      role="row"
      style={{
        top: `${props.item.start}px`,
        ...(wrapMessages() ? {} : { height: `${props.item.size}px` }),
      }}
    >
      <div
        class="observability-viewer__cell observability-viewer__time"
        role="cell"
      >
        {formatConsoleTimestamp(props.record.timestamp)}
      </div>
      <div class="observability-viewer__cell" role="cell">
        <span class="observability-viewer__level">
          {levelLabel(props.record.level)}
        </span>
      </div>
      <div
        class="observability-viewer__cell observability-viewer__window"
        role="cell"
        title={windowLabel(props.record.component)}
      >
        {windowLabel(props.record.component)}
      </div>
      <div
        class="observability-viewer__cell observability-viewer__source"
        role="cell"
        title={recordSourceLabel(props.record)}
      >
        {recordSourceLabel(props.record)}
      </div>
      <div
        class="observability-viewer__cell observability-viewer__message"
        role="cell"
        title={props.record.message}
      >
        <span class="observability-viewer__message-text">
          {props.record.message}
        </span>
        <TooltipIconButton
          aria-label="Copy message"
          class="observability-viewer__message-copy"
          tooltip={
            copiedMessageKey() === consoleRecordKey(props.record)
              ? "Copied"
              : "Copy message"
          }
          onClick={() => {
            void copyRecordMessage(props.record);
          }}
        >
          <Icon
            icon={
              copiedMessageKey() === consoleRecordKey(props.record)
                ? "check"
                : "copy"
            }
            size="xs"
          />
        </TooltipIconButton>
      </div>
    </div>
  );

  createEffect((previousMeasureKey: string | undefined) => {
    const measureKey = `${wrapMessages()}:${visibleRecords().length}`;
    if (measureKey === previousMeasureKey) {
      return measureKey;
    }

    tableVirtualizer.measure();
    return measureKey;
  });

  createEffect(() => {
    if (
      windowComponent() !== allWindowsFilter &&
      !windowComponents().includes(windowComponent())
    ) {
      setWindowComponent(allWindowsFilter);
    }
  });

  createEffect(() => {
    if (!live()) {
      setConnectionState("paused");
      return;
    }

    let disposed = false;
    const eventSource = new EventSource(eventsPath);
    setConnectionState("connecting");

    const reconcileSnapshot = async (followTail = isFollowingTail()) => {
      const [snapshot, metadata] = await Promise.all([
        readSnapshot(),
        readWindowMetadata(),
      ]);
      if (!disposed) {
        applyWindowMetadata(metadata);
        mergeRecords(snapshot, { followTail });
      }
    };

    reconcileSnapshot(true)
      .then(() => undefined)
      .catch(() => {
        if (!disposed) {
          setConnectionState("error");
        }
      });

    const snapshotReconcileInterval = setInterval(() => {
      void reconcileSnapshot().catch(() => {
        if (!disposed) {
          setConnectionState("error");
        }
      });
    }, snapshotReconcileIntervalMs);

    eventSource.addEventListener("open", () => {
      if (!disposed) {
        setConnectionState("live");
      }
    });
    eventSource.addEventListener("error", () => {
      if (!disposed) {
        setConnectionState("reconnecting");
        void reconcileSnapshot().catch(() => {
          if (!disposed) {
            setConnectionState("error");
          }
        });
      }
    });
    eventSource.addEventListener("record", (event) => {
      if (disposed || !live()) {
        return;
      }

      try {
        const record = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as ObservabilityRecord;
        if (isObservabilityConsoleMessageData(record.data)) {
          const account = record.data.account;
          if (account !== undefined) {
            setWindowAccounts((current) => {
              const next = new Map(current);
              next.set(record.component, account);
              return next;
            });
          }
        }
        mergeRecords([record]);
        setConnectionState("live");
      } catch {
        if (!disposed) {
          setConnectionState("error");
        }
      }
    });

    onCleanup(() => {
      disposed = true;
      clearInterval(snapshotReconcileInterval);
      eventSource.close();
    });
  });

  onCleanup(() => {
    if (copiedMessageTimeout !== undefined) {
      clearTimeout(copiedMessageTimeout);
      copiedMessageTimeout = undefined;
    }
  });

  const toggleLevel = (level: ObservabilityLevel, checked: boolean): void => {
    setEnabledLevels((current) =>
      checked
        ? [...new Set([...current, level])]
        : current.filter((currentLevel) => currentLevel !== level),
    );
  };

  const visibleExport = (): string => exportConsoleRecords(visibleRecords());

  const copyVisibleRecords = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(visibleExport());
      setNotice("Copied");
    } catch {
      setNotice("Copy failed");
    }
  };

  const downloadVisibleRecords = (): void => {
    downloadText("lucent-console-records.ndjson", visibleExport());
    setNotice("Downloaded");
  };

  const clearLocalRecords = (): void => {
    setHiddenRecordKeys((current) => {
      const next = new Set(current);
      for (const record of records()) {
        next.add(consoleRecordKey(record));
      }
      return next;
    });
    setRecords([]);
    setNotice("Cleared");
  };

  return (
    <AppShell class="observability-viewer">
      <AppShell.Header>
        <AppShell.HeaderLeft>
          <AppShell.Title>Console Traces</AppShell.Title>
          <Badge variant={statusVariant(connectionState())}>
            {connectionState()}
          </Badge>
          <Show when={notice()}>
            <span class="observability-viewer__notice">{notice()}</span>
          </Show>
        </AppShell.HeaderLeft>
        <AppShell.HeaderRight>
          <TooltipIconButton
            aria-label={live() ? "Pause live stream" : "Resume live stream"}
            tooltip={live() ? "Pause" : "Resume"}
            onClick={() => {
              setLive((current) => !current);
              setNotice("");
            }}
          >
            <Icon icon={live() ? "pause" : "play"} size="sm" />
          </TooltipIconButton>
          <TooltipIconButton
            aria-label="Clear visible records"
            tooltip="Clear"
            onClick={clearLocalRecords}
          >
            <Icon icon="x" size="sm" />
          </TooltipIconButton>
          <TooltipIconButton
            aria-label="Copy visible records"
            tooltip="Copy"
            onClick={() => {
              void copyVisibleRecords();
            }}
          >
            <Icon icon="copy" size="sm" />
          </TooltipIconButton>
          <TooltipIconButton
            aria-label="Download visible records"
            tooltip="Download"
            onClick={downloadVisibleRecords}
          >
            <Icon icon="download" size="sm" />
          </TooltipIconButton>
        </AppShell.HeaderRight>
      </AppShell.Header>
      <AppShell.Body scroll={false} class="observability-viewer__body">
        <div class="observability-viewer__toolbar">
          <label class="observability-viewer__search">
            <Icon icon="search" size="sm" />
            <Input
              aria-label="Search console records"
              fullWidth
              placeholder="Search"
              value={search()}
              onInput={(event) => {
                setSearch(event.currentTarget.value);
              }}
            />
          </label>
          <select
            aria-label="Game window"
            class="observability-viewer__select"
            value={windowComponent()}
            onChange={(event) => {
              setWindowComponent(event.currentTarget.value);
            }}
          >
            <option value={allWindowsFilter}>All windows</option>
            <For each={windowComponents()}>
              {(component) => (
                <option value={component}>{windowLabel(component)}</option>
              )}
            </For>
          </select>
          <div class="observability-viewer__levels" aria-label="Levels">
            <Checkbox
              checked={wrapMessages()}
              onChange={(event) => {
                setWrapMessages(event.currentTarget.checked);
              }}
              size="sm"
            >
              Wrap
            </Checkbox>
            <For each={consoleLevelOptions}>
              {(level) => (
                <Checkbox
                  checked={enabledLevels().includes(level)}
                  onChange={(event) => {
                    toggleLevel(level, event.currentTarget.checked);
                  }}
                  size="sm"
                >
                  {levelLabel(level)}
                </Checkbox>
              )}
            </For>
          </div>
        </div>
        <div
          class="observability-viewer__table-shell"
          ref={(element) => {
            tableViewport = element;
          }}
        >
          <div
            aria-colcount={5}
            aria-rowcount={visibleRecords().length + 1}
            class="observability-viewer__table"
            data-wrap-messages={wrapMessages()}
            role="table"
          >
            <div class="observability-viewer__header" role="row">
              <div
                class="observability-viewer__header-cell"
                role="columnheader"
              >
                Time
              </div>
              <div
                class="observability-viewer__header-cell"
                role="columnheader"
              >
                Level
              </div>
              <div
                class="observability-viewer__header-cell"
                role="columnheader"
              >
                Window
              </div>
              <div
                class="observability-viewer__header-cell"
                role="columnheader"
              >
                Source
              </div>
              <div
                class="observability-viewer__header-cell"
                role="columnheader"
              >
                Message
              </div>
            </div>
            <Show
              when={visibleRecords().length > 0}
              fallback={
                <div class="observability-viewer__empty" role="row">
                  No console records
                </div>
              }
            >
              <div
                class="observability-viewer__virtual"
                style={{
                  height: `${tableVirtualizer.getTotalSize()}px`,
                }}
              >
                <For each={virtualRows()}>
                  {(row) => (
                    <ConsoleRecordRow item={row.item} record={row.record} />
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </AppShell.Body>
    </AppShell>
  );
}

const root = document.getElementById("root");
if (root) {
  render(() => <App />, root);
}
document.documentElement.dataset["ready"] = "true";
