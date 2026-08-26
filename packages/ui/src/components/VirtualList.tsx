import { createVirtualizer, type Virtualizer } from "@tanstack/solid-virtual";
import { For, createMemo, type JSX } from "solid-js";
import { Input } from "./Input";

export interface VirtualListItem {
  readonly disabled?: boolean;
  readonly label: string;
  readonly searchText?: string | undefined;
  readonly value: string;
}

export interface VirtualListApi {
  readonly scrollToIndex: (index: number) => void;
  readonly scrollToStart: () => void;
}

export interface VirtualListProps<T extends VirtualListItem> {
  readonly children: (item: T, index: number) => JSX.Element;
  readonly class?: string;
  readonly getScrollElement: () => HTMLElement | undefined;
  readonly itemSize?: number | undefined;
  readonly items: readonly T[];
  readonly overscan?: number | undefined;
  readonly ref?: (api: VirtualListApi) => void;
}

export interface VirtualListSearchInputProps {
  readonly onInput: JSX.EventHandler<HTMLInputElement, InputEvent>;
  readonly ref?: (element: HTMLInputElement) => void;
  readonly value: string;
}

const DEFAULT_VIRTUAL_ITEM_SIZE = 28;
const DEFAULT_VIRTUAL_ITEM_SIZE_REM = 1.75;

function getDefaultVirtualItemSize(
  scrollElement: HTMLElement | undefined,
): number {
  const ownerDocument =
    scrollElement?.ownerDocument ??
    (typeof document === "undefined" ? undefined : document);
  if (ownerDocument === undefined) return DEFAULT_VIRTUAL_ITEM_SIZE;

  const view = ownerDocument?.defaultView;
  if (view === undefined || view === null) return DEFAULT_VIRTUAL_ITEM_SIZE;

  const rootFontSize = Number.parseFloat(
    view.getComputedStyle(ownerDocument.documentElement).fontSize,
  );
  return Number.isFinite(rootFontSize)
    ? rootFontSize * DEFAULT_VIRTUAL_ITEM_SIZE_REM
    : DEFAULT_VIRTUAL_ITEM_SIZE;
}

export function getVirtualListSearchText(item: VirtualListItem): string {
  return `${item.label} ${item.searchText ?? ""}`.toLocaleLowerCase();
}

export function filterVirtualListItems<T extends VirtualListItem>(
  items: readonly T[],
  query: string,
): readonly T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery === "") return items;

  const terms = normalizedQuery.split(/\s+/u);
  return items.filter((item) => {
    const searchText = getVirtualListSearchText(item);
    return terms.every((term) => searchText.includes(term));
  });
}

export function updateInlineSearchQuery(
  query: string,
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey">,
): string | undefined {
  const hasModifier = event.altKey || event.ctrlKey || event.metaKey;
  if (event.key === "Backspace" && !hasModifier) {
    return query === "" ? undefined : query.slice(0, -1);
  }

  if (event.key === " " && query === "") return undefined;

  if (event.key.length === 1 && !hasModifier) {
    return `${query}${event.key}`;
  }

  return undefined;
}

export function VirtualListSearchInput(
  props: VirtualListSearchInputProps,
): JSX.Element {
  return (
    <div class="virtual-list__search" data-slot="virtual-list-search">
      <Input
        ref={props.ref}
        aria-label="Search options"
        autocomplete="off"
        fullWidth
        onInput={props.onInput}
        onKeyDown={(event) => {
          if (
            event.key !== "ArrowDown" &&
            event.key !== "ArrowUp" &&
            event.key !== "Enter" &&
            event.key !== "Escape" &&
            event.key !== "Tab"
          ) {
            event.stopPropagation();
          }
        }}
        placeholder="Search options..."
        size="sm"
        spellcheck={false}
        type="text"
        value={props.value}
      />
    </div>
  );
}

function makeVirtualListApi<TScrollElement extends HTMLElement>(
  virtualizer: Virtualizer<TScrollElement, Element>,
  getItemSize: () => number,
): VirtualListApi {
  return {
    scrollToIndex(index) {
      const viewportSize = virtualizer.scrollRect?.height ?? 0;
      const visibleItemCount = Math.floor(viewportSize / getItemSize());
      const offsetInfo = virtualizer.getOffsetForIndex(index, "auto");
      if (offsetInfo === undefined || offsetInfo[1] === "auto") return;

      if (offsetInfo[1] === "start") {
        virtualizer.scrollToIndex(index, {
          align: "start",
          behavior: "auto",
        });
        return;
      }

      if (visibleItemCount < 1) {
        virtualizer.scrollToIndex(index, {
          align: "end",
          behavior: "auto",
        });
        return;
      }

      // Align the first fully visible row to the top. End alignment can leave
      // the first row clipped when the viewport is not an exact row multiple.
      const firstVisibleIndex = Math.max(0, index - visibleItemCount + 1);
      virtualizer.scrollToIndex(firstVisibleIndex, {
        align: "start",
        behavior: "auto",
      });
    },
    scrollToStart() {
      virtualizer.scrollToOffset(0, { behavior: "auto" });
    },
  };
}

export function VirtualList<T extends VirtualListItem>(
  props: VirtualListProps<T>,
): JSX.Element {
  const getItemSize = (): number =>
    props.itemSize ?? getDefaultVirtualItemSize(props.getScrollElement());
  const virtualizer = createVirtualizer<HTMLElement, Element>({
    estimateSize: getItemSize,
    get count() {
      return props.items.length;
    },
    getItemKey: (index) => props.items[index]?.value ?? index,
    getScrollElement: () => props.getScrollElement() ?? null,
    overscan: props.overscan ?? 6,
  });
  const api = makeVirtualListApi(virtualizer, getItemSize);
  props.ref?.(api);

  const virtualItems = createMemo(() => virtualizer.getVirtualItems());
  const paddingBefore = createMemo(
    () => virtualItems()[0]?.start ?? virtualizer.getTotalSize(),
  );
  const paddingAfter = createMemo(() => {
    const last = virtualItems().at(-1);
    return last === undefined ? 0 : virtualizer.getTotalSize() - last.end;
  });

  return (
    <div class={props.class} data-slot="virtual-list">
      <div
        aria-hidden="true"
        data-slot="virtual-list-spacer"
        style={{ height: `${paddingBefore()}px` }}
      />
      <For each={virtualItems()}>
        {(virtualItem) => {
          const item = () => props.items[virtualItem.index];
          return item() === undefined
            ? null
            : props.children(item()!, virtualItem.index);
        }}
      </For>
      <div
        aria-hidden="true"
        data-slot="virtual-list-spacer"
        style={{ height: `${paddingAfter()}px` }}
      />
    </div>
  );
}
