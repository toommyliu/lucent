import {
  createVirtualizer,
  defaultKeyExtractor,
  defaultRangeExtractor,
} from "@tanstack/solid-virtual";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type Accessor,
  type JSX,
} from "solid-js";

export interface ScriptQueueListApi {
  readonly focusIndex: (index: number) => void;
}

interface ScriptQueueListProps<T> {
  readonly active: boolean;
  readonly children: (item: T, index: Accessor<number>) => JSX.Element;
  readonly isAttentionItem?: (item: T) => boolean;
  readonly itemKey?: (item: T) => string;
  readonly items: readonly T[];
  readonly label: string;
  readonly ref?: (api: ScriptQueueListApi) => void;
}

/** Renders measured queue rows in an independently scrollable panel. */
export function ScriptQueueList<T>(
  props: ScriptQueueListProps<T>,
): JSX.Element {
  let list: HTMLOListElement | undefined;
  let focusFrame: number | undefined;
  let scrollFrame: number | undefined;
  let pendingFocusIndex: number | undefined;
  let scrollOffset = 0;
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [mounted, setMounted] = createSignal(false);
  const itemKey = createMemo(() => {
    const getKey = props.itemKey;
    if (getKey === undefined) return defaultKeyExtractor;
    const items = props.items;
    return (index: number) => {
      const item = items[index];
      return item === undefined ? index : getKey(item);
    };
  });
  const virtualizer = createVirtualizer<HTMLElement, HTMLLIElement>({
    get count() {
      return props.items.length;
    },
    get enabled() {
      return props.active && mounted();
    },
    estimateSize: () => 52,
    get getItemKey() {
      return itemKey();
    },
    getScrollElement: () => viewport() ?? null,
    measureElement: (element, entry) =>
      entry?.borderBoxSize[0]?.blockSize ??
      element.getBoundingClientRect().height,
    overscan: 6,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      const focusedRow = list?.ownerDocument.activeElement?.closest("li");
      if (
        focusedRow === null ||
        focusedRow === undefined ||
        focusedRow.parentElement !== list
      )
        return indexes;

      // Keep focus mounted when scrolling away, with neighbors for native Tab navigation.
      const focusedIndex = Number(focusedRow.getAttribute("data-index"));
      for (
        let index = focusedIndex - 1;
        index <= focusedIndex + 1;
        index += 1
      ) {
        if (index >= 0 && index < range.count && !indexes.includes(index)) {
          indexes.push(index);
        }
      }
      return indexes.toSorted((left, right) => left - right);
    },
  });

  onMount(() => {
    // Conditional panels can be created before their viewport is attached.
    // Start observing after insertion so the first measurement has a size.
    const frame = requestAnimationFrame(() => setMounted(true));
    onCleanup(() => cancelAnimationFrame(frame));
  });

  // A requested row takes priority over restoring scroll after a panel mounts or reopens.
  const scheduleScroll = (): void => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
    const savedOffset = scrollOffset;
    scrollFrame = requestAnimationFrame(() => {
      if (!props.active || !mounted()) return;
      const index = pendingFocusIndex;
      pendingFocusIndex = undefined;
      if (index === undefined) {
        virtualizer.scrollToOffset(savedOffset);
        return;
      }

      virtualizer.scrollToIndex(index, { align: "center" });
      focusFrame = requestAnimationFrame(() => {
        if (!props.active) return;
        list
          ?.querySelector<HTMLElement>(
            `li[data-index="${index}"] button:not(:disabled)`,
          )
          ?.focus({ preventScroll: true });
      });
    });
  };

  createEffect(
    on(
      () => props.active && mounted(),
      (active) => {
        if (active) scheduleScroll();
      },
    ),
  );

  createEffect(
    on([() => props.items, () => props.active && mounted()], () => {
      if (!props.active || !mounted() || list === undefined) return;
      // The Solid adapter clears measurements when options change. Unchanged
      // mounted rows won't receive another ResizeObserver notification.
      for (const element of list.querySelectorAll<HTMLLIElement>(
        "li[data-index]",
      )) {
        virtualizer.measureElement(element);
      }
    }),
  );

  props.ref?.({
    focusIndex: (index) => {
      pendingFocusIndex = index;
      scheduleScroll();
    },
  });
  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
  });

  const visibleRows = createMemo(
    () =>
      new Map(
        virtualizer.getVirtualItems().flatMap((row) => {
          const item = props.items[row.index];
          return item === undefined ? [] : [[item, row] as const];
        }),
      ),
  );
  const visibleItems = createMemo(() => [...visibleRows().keys()]);

  return (
    <div
      ref={setViewport}
      aria-label={props.label}
      class="game-scripts-dialog__queue-viewport"
      onScroll={(event) => {
        if (props.active) scrollOffset = event.currentTarget.scrollTop;
      }}
      role="group"
      style={{
        "--game-scripts-dialog-queue-position-width": `${Math.min(5, String(props.items.length).length)}ch`,
      }}
      tabIndex={0}
    >
      <ol
        ref={(element) => {
          list = element;
        }}
        aria-label={props.label}
        class="game-scripts-dialog__queue-list"
        role="list"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        <For each={visibleItems()}>
          {(item) => (
            <Show when={visibleRows().get(item)}>
              {(row) => {
                onCleanup(() => virtualizer.measureElement(null));

                return (
                  <li
                    ref={(rowElement) => {
                      createEffect(() => {
                        rowElement.setAttribute(
                          "data-index",
                          String(row().index),
                        );
                        virtualizer.measureElement(rowElement);
                      });
                    }}
                    aria-posinset={row().index + 1}
                    aria-setsize={props.items.length}
                    class="game-scripts-dialog__queue-row"
                    data-attention={
                      props.isAttentionItem?.(item) ? "" : undefined
                    }
                    role="listitem"
                    style={{
                      transform: `translateY(${row().start}px)`,
                    }}
                  >
                    <span
                      class="game-scripts-dialog__queue-position"
                      title={String(row().index + 1)}
                    >
                      {row().index + 1}
                    </span>
                    {props.children(item, () => row().index)}
                  </li>
                );
              }}
            </Show>
          )}
        </For>
      </ol>
    </div>
  );
}
