/* @refresh reload */
import "./style.css";
import { createHotkey } from "@tanstack/solid-hotkeys";
import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertAction,
  AlertDescription,
  Button,
  Icon,
  IconButton,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Kbd,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Spinner,
  TooltipIconButton,
} from "@lucent/ui";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import {
  LoaderGrabberGrabTypes,
  LoaderGrabberLoadTypes,
  isLoaderGrabberGrabType,
  isLoaderGrabberLoadType,
  loaderGrabberLoadRequiresId,
  normalizeLoaderGrabberGrabRequest,
  normalizeLoaderGrabberLoadRequest,
  type GrabbedData,
  type LoaderGrabberGrabType,
  type LoaderGrabberLoadType,
} from "../../../shared/loader-grabber";
import { selectDesktopBridge } from "../../../shared/desktopBridge";
import { buildGrabbedDataTree, filterTreeRoots, type TreeItem } from "./tree";
import { downloadJson } from "../../lib/download";
import { splitTextMatches } from "../../lib/text";

type LoaderGrabberSource = LoaderGrabberGrabType | LoaderGrabberLoadType;

const loaderGrabber = selectDesktopBridge(
  window.desktop,
  "loader-grabber",
).loaderGrabber;

interface SourceOption {
  readonly canGrab: boolean;
  readonly canLoad: boolean;
  readonly label: string;
  readonly value: LoaderGrabberSource;
}

const TREE_ROW_HEIGHT = 34;
const DEFAULT_LIST_PANE_PERCENT = 34;
const DETAIL_PANE_MIN_WIDTH = 240;
const LIST_PANE_MIN_WIDTH = 160;
const PANE_RESIZE_STEP = 16;
const COMPACT_INSPECTOR_MEDIA_QUERY = "(max-width: 620px)";

const loadTypeSet = new Set<string>(LoaderGrabberLoadTypes);
const grabTypeSet = new Set<string>(LoaderGrabberGrabTypes);

const sourceLabels: Record<LoaderGrabberSource, string> = {
  "armor-customizer": "Armor customizer",
  bank: "Bank",
  "cell-monsters": "Cell monsters",
  "hair-shop": "Hair shop",
  inventory: "Inventory",
  "map-monsters": "Map monsters",
  quest: "Quests",
  shop: "Shop",
  "temp-inventory": "Temp inventory",
};

const sourceValues: readonly LoaderGrabberSource[] = [
  "shop",
  "quest",
  "armor-customizer",
  "hair-shop",
  "inventory",
  "temp-inventory",
  "bank",
  "cell-monsters",
  "map-monsters",
];

const sourceOptions: readonly SourceOption[] = sourceValues.map((value) => ({
  canGrab: grabTypeSet.has(value),
  canLoad: loadTypeSet.has(value),
  label: sourceLabels[value],
  value,
}));

const sourceOptionFor = (value: LoaderGrabberSource): SourceOption =>
  sourceOptions.find((option) => option.value === value) ?? {
    canGrab: false,
    canLoad: false,
    label: sourceLabels[value],
    value,
  };

const operationErrorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error && cause.message !== "" ? cause.message : fallback;

const preventPointerFocus: JSX.EventHandler<HTMLElement, PointerEvent> = (
  event,
) => {
  if (event.pointerType !== "keyboard") {
    event.preventDefault();
  }
};

function SourceSelect(props: {
  readonly disabled?: boolean;
  readonly id: string;
  readonly value: LoaderGrabberSource;
  readonly onChange: (value: LoaderGrabberSource) => void;
}): JSX.Element {
  return (
    <div class="loader-grabber-source">
      <Label for={props.id}>Source</Label>
      <Select
        class="loader-grabber-select"
        ids={{ trigger: props.id }}
        items={sourceOptions}
        value={[props.value]}
        onValueChange={(details) => {
          const value = details.value[0];
          if (
            isLoaderGrabberLoadType(value) ||
            isLoaderGrabberGrabType(value)
          ) {
            props.onChange(value);
          }
        }}
      >
        <SelectTrigger disabled={props.disabled} size="default">
          <span class="select__value">
            {sourceOptionFor(props.value).label}
          </span>
        </SelectTrigger>
        <SelectContent>
          <For each={sourceOptions}>
            {(option) => (
              <SelectItem label={option.label} value={option.value}>
                {option.label}
              </SelectItem>
            )}
          </For>
        </SelectContent>
      </Select>
    </div>
  );
}

function LoaderGrabberSection(props: {
  readonly action?: JSX.Element;
  readonly children: JSX.Element;
  readonly class: string;
  readonly label?: string;
  readonly title?: JSX.Element;
  readonly titleAccessory?: JSX.Element;
}): JSX.Element {
  return (
    <section aria-label={props.label} class={`section-panel ${props.class}`}>
      <div class="section-panel__body">
        <div class="section-panel__content">
          <Show when={props.title || props.titleAccessory || props.action}>
            <header class="section-panel__header">
              <div class="section-panel__heading">
                <Show when={props.title}>
                  {(title) => <h2 class="section-panel__title">{title()}</h2>}
                </Show>
                <Show when={props.titleAccessory}>
                  {(titleAccessory) => (
                    <div class="section-panel__title-accessory">
                      {titleAccessory()}
                    </div>
                  )}
                </Show>
              </div>
              <Show when={props.action}>
                {(action) => (
                  <div class="section-panel__actions">{action()}</div>
                )}
              </Show>
            </header>
          </Show>
          {props.children}
        </div>
      </div>
    </section>
  );
}

export function App(): JSX.Element {
  let searchInput: HTMLInputElement | undefined;
  let inspector: HTMLDivElement | undefined;
  let listPane: HTMLElement | undefined;
  let listViewport: HTMLDivElement | undefined;
  let copiedTimer: number | undefined;
  let cleanupPaneResize: (() => void) | undefined;

  const [source, setSource] = createSignal<LoaderGrabberSource>("shop");
  const [sourceId, setSourceId] = createSignal("");
  const [grabbedType, setGrabbedType] =
    createSignal<LoaderGrabberGrabType | null>(null);
  const [grabbedData, setGrabbedData] = createSignal<GrabbedData | null>(null);
  const [selectedRootId, setSelectedRootId] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [grabbing, setGrabbing] = createSignal(false);
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [copiedKey, setCopiedKey] = createSignal<string | null>(null);
  const [listPanePercent, setListPanePercent] = createSignal(
    DEFAULT_LIST_PANE_PERCENT,
  );
  const [resizingPanes, setResizingPanes] = createSignal(false);
  const compactInspectorMedia = window.matchMedia(
    COMPACT_INSPECTOR_MEDIA_QUERY,
  );
  const [compactInspector, setCompactInspector] = createSignal(
    compactInspectorMedia.matches,
  );

  onMount(() => {
    const handleCompactInspectorChange = (event: MediaQueryListEvent): void => {
      cleanupPaneResize?.();
      setCompactInspector(event.matches);
    };

    compactInspectorMedia.addEventListener(
      "change",
      handleCompactInspectorChange,
    );
    onCleanup(() => {
      compactInspectorMedia.removeEventListener(
        "change",
        handleCompactInspectorChange,
      );
    });
  });

  createHotkey(
    "/",
    (event) => {
      if (event.repeat) {
        return;
      }

      searchInput?.focus();
      searchInput?.select();
    },
    {
      conflictBehavior: "replace",
      eventType: "keydown",
      ignoreInputs: true,
    },
  );

  const selectedSource = createMemo(() => sourceOptionFor(source()));
  const busy = createMemo(() => loading() || grabbing());
  const selectedLoadRequiresId = createMemo(() => {
    const currentSource = source();
    return (
      isLoaderGrabberLoadType(currentSource) &&
      loaderGrabberLoadRequiresId(currentSource)
    );
  });
  const treeData = createMemo(() => {
    const type = grabbedType();
    const data = grabbedData();
    return type && data ? buildGrabbedDataTree(type, data) : [];
  });

  const visibleRoots = createMemo(() => filterTreeRoots(treeData(), search()));
  const selectedRoot = createMemo(() => {
    const nodeId = selectedRootId();
    return nodeId === null
      ? undefined
      : treeData()[Number.parseInt(nodeId, 10)];
  });

  const listVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    estimateSize: () => TREE_ROW_HEIGHT,
    get count() {
      return visibleRoots().length;
    },
    getItemKey: (index) => visibleRoots()[index]?.nodeId ?? index,
    getScrollElement: () => listViewport ?? null,
    overscan: 12,
  });

  const resultCountLabel = createMemo(() => {
    const roots = treeData().length;
    if (search().trim() !== "") {
      return `${visibleRoots().length} of ${roots}`;
    }

    return `${roots}`;
  });
  const grabbedSourceLabel = createMemo(() => {
    const type = grabbedType();
    return type ? sourceLabels[type] : "";
  });

  const canExport = createMemo(
    () => grabbedData() !== null && treeData().length > 0,
  );

  createEffect(() => {
    const roots = visibleRoots();
    const selected = selectedRootId();
    if (!roots.some((root) => root.nodeId === selected)) {
      setSelectedRootId(roots[0]?.nodeId ?? null);
    }
  });

  const setOperationError = (message: string, cause: unknown): void => {
    console.error(message, cause);
    setNotice("");
    setError(operationErrorMessage(cause, message));
  };

  const markCopied = (nodeId: string): void => {
    if (copiedTimer !== undefined) {
      window.clearTimeout(copiedTimer);
    }

    setCopiedKey(nodeId);
    copiedTimer = window.setTimeout(() => {
      setCopiedKey((current) => (current === nodeId ? null : current));
      copiedTimer = undefined;
    }, 900);
  };

  const copyText = async (nodeId: string, value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setError("");
      markCopied(nodeId);
    } catch (cause) {
      setOperationError("Copy failed", cause);
    }
  };

  const chooseSource = (value: LoaderGrabberSource): void => {
    setSource(value);
    setSourceId("");
  };

  const handleLoad = async (): Promise<boolean> => {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const request = normalizeLoaderGrabberLoadRequest({
        id: sourceId(),
        type: source(),
      });
      await loaderGrabber.load(request);
      return true;
    } catch (cause) {
      setOperationError("Load failed", cause);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleGrab = async (): Promise<void> => {
    setGrabbing(true);
    setError("");
    setNotice("");

    try {
      const request = normalizeLoaderGrabberGrabRequest({
        type: source(),
      });
      const data = await loaderGrabber.grab(request);
      setGrabbedType(request.type);
      setGrabbedData(data);
      setSelectedRootId(null);
      setSearch("");
      if (listViewport) {
        listViewport.scrollTop = 0;
      }
      if (!data) {
        setNotice("The selected source did not return any data.");
      }
    } catch (cause) {
      setOperationError("Grab failed", cause);
    } finally {
      setGrabbing(false);
    }
  };

  const startLoad = (): void => {
    if (busy() || !selectedSource().canLoad) {
      return;
    }

    void handleLoad();
  };

  const startGrab = (): void => {
    if (busy() || !selectedSource().canGrab) {
      return;
    }

    void handleGrab();
  };

  const clearResults = (): void => {
    setGrabbedData(null);
    setGrabbedType(null);
    setSelectedRootId(null);
    setSearch("");
    setCopiedKey(null);
    setNotice("");
  };

  const exportResults = (): void => {
    const data = grabbedData();
    const type = grabbedType();
    if (!data || !type || !canExport()) {
      return;
    }

    downloadJson(`${type}.json`, data);
  };

  const resizeListPane = (
    desiredWidth: number,
    splitterWidth: number,
  ): void => {
    const containerWidth = inspector?.getBoundingClientRect().width ?? 0;
    if (containerWidth <= 0) {
      return;
    }

    const availableWidth = Math.max(0, containerWidth - splitterWidth);
    const maximumWidth = Math.max(0, availableWidth - DETAIL_PANE_MIN_WIDTH);
    const minimumWidth = Math.min(LIST_PANE_MIN_WIDTH, maximumWidth);
    const width = Math.min(Math.max(desiredWidth, minimumWidth), maximumWidth);
    setListPanePercent((width / containerWidth) * 100);
  };

  const startPaneResize: JSX.EventHandler<HTMLElement, PointerEvent> = (
    event,
  ) => {
    if (event.button !== 0 || inspector === undefined) {
      return;
    }

    event.preventDefault();
    cleanupPaneResize?.();
    const splitterWidth = event.currentTarget.getBoundingClientRect().width;
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingPanes(true);

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const containerLeft = inspector?.getBoundingClientRect().left;
      if (containerLeft !== undefined) {
        resizeListPane(moveEvent.clientX - containerLeft, splitterWidth);
      }
    };
    const handlePointerUp = (): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      setResizingPanes(false);
      cleanupPaneResize = undefined;
    };

    cleanupPaneResize = handlePointerUp;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
  };

  const handlePaneResizeKeyDown: JSX.EventHandler<
    HTMLElement,
    KeyboardEvent
  > = (event) => {
    if (
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
      listPane === undefined
    ) {
      return;
    }

    event.preventDefault();
    const splitterWidth = event.currentTarget.getBoundingClientRect().width;
    const currentWidth = listPane.getBoundingClientRect().width;
    const containerWidth = inspector?.getBoundingClientRect().width ?? 0;
    const step = event.shiftKey ? PANE_RESIZE_STEP * 3 : PANE_RESIZE_STEP;

    if (event.key === "Home") {
      resizeListPane(0, splitterWidth);
    } else if (event.key === "End") {
      resizeListPane(containerWidth, splitterWidth);
    } else {
      resizeListPane(
        currentWidth + (event.key === "ArrowLeft" ? -step : step),
        splitterWidth,
      );
    }
  };

  const renderHighlightedText = (value: string): JSX.Element => {
    const query = search().trim();
    if (query === "") {
      return value;
    }

    return (
      <For each={splitTextMatches(value, query)}>
        {(segment) =>
          segment.match ? (
            <mark class="loader-grabber-match">{segment.text}</mark>
          ) : (
            segment.text
          )
        }
      </For>
    );
  };

  const DetailField = (props: {
    readonly copyKey: string;
    readonly item: TreeItem;
  }): JSX.Element => {
    const value = () =>
      props.item.value === undefined || props.item.value === ""
        ? undefined
        : props.item.value;
    const copied = () => copiedKey() === props.copyKey;

    return (
      <div class="loader-grabber-detail-field">
        <div class="loader-grabber-detail-field__name">
          {renderHighlightedText(props.item.name)}
        </div>
        <div
          class="loader-grabber-detail-field__value"
          classList={{
            "loader-grabber-detail-field__value--copied": copied(),
          }}
        >
          <Show
            when={value()}
            fallback={<span class="loader-grabber-detail-empty">—</span>}
          >
            {(fieldValue) => (
              <button
                aria-label={
                  copied()
                    ? `Copied ${props.item.name} value`
                    : `Copy ${props.item.name} value`
                }
                class="loader-grabber-detail-copy"
                onPointerDown={preventPointerFocus}
                onClick={() => void copyText(props.copyKey, fieldValue())}
                type="button"
              >
                <span class="loader-grabber-detail-copy__text">
                  {renderHighlightedText(fieldValue())}
                </span>
                <Icon
                  aria-hidden="true"
                  class="loader-grabber-detail-copy__icon"
                  icon={copied() ? "check" : "copy"}
                />
              </button>
            )}
          </Show>
        </div>
      </div>
    );
  };

  const DetailGroup = (props: {
    readonly depth?: number;
    readonly item: TreeItem;
    readonly path: string;
  }): JSX.Element => {
    const children = () => props.item.children ?? [];
    const depth = () => props.depth ?? 0;

    return (
      <Accordion
        class={`loader-grabber-detail-group${
          depth() > 0 ? " loader-grabber-detail-group--nested" : ""
        }`}
        collapsible
        defaultValue={[props.path]}
      >
        <AccordionItem value={props.path}>
          <AccordionTrigger class="loader-grabber-detail-group__header">
            <h3>{renderHighlightedText(props.item.name)}</h3>
          </AccordionTrigger>
          <AccordionContent class="loader-grabber-detail-group__body">
            <For each={children()}>
              {(child, index) => (
                <Show
                  when={child.children && child.children.length > 0}
                  fallback={
                    <DetailField
                      copyKey={`${props.path}.${index()}`}
                      item={child}
                    />
                  }
                >
                  <DetailGroup
                    depth={depth() + 1}
                    item={child}
                    path={`${props.path}.${index()}`}
                  />
                </Show>
              )}
            </For>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    );
  };

  const RootListRow = (props: {
    readonly item: TreeItem;
    readonly nodeId: string;
  }): JSX.Element => {
    const selected = () => selectedRootId() === props.nodeId;

    return (
      <button
        aria-selected={selected()}
        class="loader-grabber-list-row"
        classList={{
          "loader-grabber-list-row--selected": selected(),
        }}
        onClick={() => setSelectedRootId(props.nodeId)}
        role="option"
        type="button"
      >
        <span class="loader-grabber-list-row__name">
          {renderHighlightedText(props.item.name)}
        </span>
      </button>
    );
  };

  const SelectedRootDetail = (props: {
    readonly item: TreeItem;
    readonly nodeId: string;
  }): JSX.Element => {
    const children = () => props.item.children ?? [];

    return (
      <div class="loader-grabber-detail-content">
        <For each={children()}>
          {(child, index) => (
            <Show
              when={child.children && child.children.length > 0}
              fallback={
                <DetailField
                  copyKey={`${props.nodeId}.${index()}`}
                  item={child}
                />
              }
            >
              <DetailGroup item={child} path={`${props.nodeId}.${index()}`} />
            </Show>
          )}
        </For>
      </div>
    );
  };

  onCleanup(() => {
    cleanupPaneResize?.();
    if (copiedTimer !== undefined) {
      window.clearTimeout(copiedTimer);
    }
  });

  return (
    <div class="standalone-window loader-grabber-window">
      <div class="standalone-window__content-frame">
        <main
          class="standalone-window__content loader-grabber-body"
          aria-label="Loader grabber controls"
        >
          <div class="loader-grabber-shell">
            <Show when={error() || notice()}>
              <Alert
                class="loader-grabber-alert"
                variant={error() !== "" ? "error" : "info"}
              >
                <AlertDescription>
                  <Icon
                    aria-hidden="true"
                    class="loader-grabber-alert__icon"
                    icon={error() !== "" ? "circle_alert" : "info"}
                  />
                  <span>{error() || notice()}</span>
                </AlertDescription>
                <AlertAction>
                  <IconButton
                    aria-label={
                      error() !== "" ? "Dismiss error" : "Dismiss notice"
                    }
                    onClick={() => {
                      setError("");
                      setNotice("");
                    }}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <Icon icon="x" class="button__icon" />
                  </IconButton>
                </AlertAction>
              </Alert>
            </Show>

            <div class="loader-grabber-workspace">
              <LoaderGrabberSection
                class="loader-grabber-panel loader-grabber-command"
                label="Source"
              >
                <form
                  class="loader-grabber-command-form"
                  classList={{
                    "loader-grabber-command-form--with-id":
                      selectedLoadRequiresId(),
                  }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    startLoad();
                  }}
                >
                  <SourceSelect
                    id="loader-grabber-source"
                    value={source()}
                    onChange={chooseSource}
                  />

                  <Show when={selectedLoadRequiresId()}>
                    <div class="loader-grabber-source-id">
                      <Label for="loader-grabber-source-id">ID</Label>
                      <Input
                        autocomplete="off"
                        fullWidth
                        id="loader-grabber-source-id"
                        inputmode="numeric"
                        min={1}
                        onInput={(event) =>
                          setSourceId(event.currentTarget.value)
                        }
                        placeholder="e.g. 42"
                        required
                        type="number"
                        value={sourceId()}
                      />
                    </div>
                  </Show>

                  <div class="loader-grabber-actions">
                    <Button
                      disabled={busy() || !selectedSource().canLoad}
                      classList={{
                        "loader-grabber-action--active": loading(),
                      }}
                      loading={loading()}
                      size="default"
                      type="submit"
                      variant="outline"
                    >
                      {selectedLoadRequiresId() ? "Load by ID" : "Load"}
                    </Button>
                    <Button
                      disabled={busy() || !selectedSource().canGrab}
                      classList={{
                        "loader-grabber-action--active": grabbing(),
                      }}
                      loading={grabbing()}
                      onClick={startGrab}
                      size="default"
                      type="button"
                    >
                      Grab current
                    </Button>
                  </div>
                </form>
              </LoaderGrabberSection>

              <LoaderGrabberSection
                class="loader-grabber-panel loader-grabber-results"
                label="Results inspector"
                titleAccessory={
                  <Show when={grabbedData()}>
                    <span class="loader-grabber-result-summary">
                      <span class="loader-grabber-result-summary__source">
                        {grabbedSourceLabel()}
                      </span>
                      <span
                        class="loader-grabber-result-summary__dot"
                        aria-hidden="true"
                      >
                        ·
                      </span>
                      <span class="loader-grabber-result-summary__count">
                        {resultCountLabel()} results
                      </span>
                    </span>
                  </Show>
                }
                action={
                  <Show when={grabbedData() !== null}>
                    <div class="loader-grabber-result-tools">
                      <InputGroup class="loader-grabber-search" size="sm">
                        <InputGroupAddon>
                          <Icon icon="search" aria-hidden="true" />
                        </InputGroupAddon>
                        <InputGroupInput
                          ref={(element) => {
                            searchInput = element;
                          }}
                          aria-label="Search results and values"
                          onInput={(event) =>
                            setSearch(event.currentTarget.value)
                          }
                          placeholder="Search results and values..."
                          type="search"
                          value={search()}
                        />
                        <InputGroupAddon
                          align="inline-end"
                          class="loader-grabber-search__shortcut"
                        >
                          <Kbd>/</Kbd>
                        </InputGroupAddon>
                      </InputGroup>
                      <TooltipIconButton
                        aria-label="Export grabbed data"
                        disabled={!canExport()}
                        onClick={exportResults}
                        size="icon-sm"
                        tooltip="Export JSON"
                      >
                        <Icon icon="download" class="button__icon" />
                      </TooltipIconButton>
                      <TooltipIconButton
                        aria-label="Clear grabbed data"
                        class="loader-grabber-clear"
                        onClick={clearResults}
                        size="icon-sm"
                        tooltip="Clear results"
                      >
                        <Icon icon="trash_2" class="button__icon" />
                      </TooltipIconButton>
                    </div>
                  </Show>
                }
              >
                <div
                  aria-busy={grabbing()}
                  class="loader-grabber-inspector"
                  classList={{
                    "loader-grabber-inspector--compact": compactInspector(),
                    "loader-grabber-inspector--empty": grabbedData() === null,
                    "loader-grabber-inspector--resizing": resizingPanes(),
                  }}
                  ref={(element) => {
                    inspector = element;
                  }}
                  style={`--loader-grabber-list-pane-width: ${listPanePercent()}%`}
                >
                  <Show when={grabbedData() === null}>
                    <div
                      aria-live="polite"
                      class="loader-grabber-empty loader-grabber-empty--inspector"
                      classList={{
                        "loader-grabber-empty--busy": grabbing(),
                      }}
                    >
                      <Show
                        when={grabbing()}
                        fallback={
                          <>
                            <Icon
                              aria-hidden="true"
                              class="loader-grabber-empty__icon"
                              icon="inbox"
                            />
                            <strong>No grabbed data yet</strong>
                            <span>
                              Choose a source above, switch to Grab, and run it.
                            </span>
                          </>
                        }
                      >
                        <Spinner size="lg" />
                        <strong>Reading from the game</strong>
                        <span>This usually takes a moment.</span>
                      </Show>
                    </div>
                  </Show>
                  <aside
                    class="loader-grabber-list-pane"
                    ref={(element) => {
                      listPane = element;
                    }}
                  >
                    <div
                      aria-label={`${grabbedSourceLabel() || "Grabbed"} results`}
                      class="loader-grabber-list-viewport"
                      ref={(element) => {
                        listViewport = element;
                      }}
                      role="listbox"
                    >
                      <Show
                        when={visibleRoots().length > 0}
                        fallback={
                          <div class="loader-grabber-list-empty">
                            {search().trim() !== ""
                              ? "No matches"
                              : "No results"}
                          </div>
                        }
                      >
                        <div
                          class="loader-grabber-list-virtual"
                          style={{
                            height: `${listVirtualizer.getTotalSize()}px`,
                          }}
                        >
                          <For each={listVirtualizer.getVirtualItems()}>
                            {(virtualRow) => {
                              const root = () =>
                                visibleRoots()[virtualRow.index];

                              return (
                                <Show when={root()}>
                                  {(visibleRoot) => (
                                    <div
                                      class="loader-grabber-list-virtual__item"
                                      role="presentation"
                                      style={{
                                        height: `${virtualRow.size}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                      }}
                                    >
                                      <RootListRow
                                        item={visibleRoot().item}
                                        nodeId={visibleRoot().nodeId}
                                      />
                                    </div>
                                  )}
                                </Show>
                              );
                            }}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </aside>

                  <Show when={!compactInspector()}>
                    <div
                      aria-label="Resize result list"
                      aria-orientation="vertical"
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={Math.round(listPanePercent())}
                      class="loader-grabber-pane-resizer"
                      onKeyDown={handlePaneResizeKeyDown}
                      onPointerDown={startPaneResize}
                      role="separator"
                      tabIndex={0}
                    />
                  </Show>

                  <section
                    aria-label="Selected result details"
                    class="loader-grabber-detail-pane"
                  >
                    <Show
                      when={selectedRoot()}
                      fallback={
                        <div
                          class="loader-grabber-empty"
                          classList={{
                            "loader-grabber-empty--busy": grabbing(),
                          }}
                        >
                          <Show
                            when={grabbing()}
                            fallback={
                              <>
                                <Icon
                                  aria-hidden="true"
                                  class="loader-grabber-empty__icon"
                                  icon="inbox"
                                />
                                <strong>
                                  {search().trim() !== ""
                                    ? "No matching results"
                                    : "Nothing to inspect"}
                                </strong>
                                <span>
                                  {search().trim() !== ""
                                    ? "Try a different name, field, or value."
                                    : "The selected source did not return any inspectable data."}
                                </span>
                              </>
                            }
                          >
                            <Spinner size="lg" />
                            <strong>Reading from the game</strong>
                            <span>This usually takes a moment.</span>
                          </Show>
                        </div>
                      }
                    >
                      {(root) => (
                        <SelectedRootDetail
                          item={root()}
                          nodeId={selectedRootId() ?? ""}
                        />
                      )}
                    </Show>
                  </section>
                </div>
              </LoaderGrabberSection>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
