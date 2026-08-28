import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  splitProps,
  type JSX,
} from "solid-js";
import {
  VirtualList,
  VirtualListItemPositionContext,
  type VirtualListItem,
  type VirtualListProps,
} from "./VirtualList";

interface GroupedVirtualListProps<T extends VirtualListItem> extends Omit<
  VirtualListProps<T>,
  "stickyHeader" | "onFirstVisibleIndexChange"
> {
  /** Items with the same group must be contiguous. Headings are not selectable. */
  readonly groupBy?: ((item: T) => string) | undefined;
  /** Render the active group elsewhere instead of overlaying it on the list. */
  readonly onActiveGroupChange?:
    | ((group: string | undefined) => void)
    | undefined;
}

/** Keeps public scroll indexes and option positions independent of heading rows. */
export function GroupedVirtualList<T extends VirtualListItem>(
  props: GroupedVirtualListProps<T>,
): JSX.Element {
  const [local, rest] = splitProps(props, [
    "children",
    "groupBy",
    "items",
    "onActiveGroupChange",
    "ref",
    "scrollTargetIndex",
  ]);
  const [firstVisibleIndex, setFirstVisibleIndex] = createSignal(0);
  const rows = createMemo(() => {
    const result: (
      | {
          readonly kind: "heading";
          readonly label: string;
          readonly value: string;
        }
      | {
          readonly kind: "item";
          readonly item: T;
          readonly index: number;
          readonly label: string;
          readonly value: string;
        }
    )[] = [];
    let previousGroup: string | undefined;
    for (const [index, item] of local.items.entries()) {
      const group = local.groupBy?.(item);
      // The external header already labels the first group.
      if (
        group !== undefined &&
        group !== previousGroup &&
        (index > 0 || local.onActiveGroupChange === undefined)
      ) {
        result.push({
          kind: "heading",
          label: group,
          value: JSON.stringify(["heading", group, index]),
        });
      }
      result.push({
        kind: "item",
        item,
        index,
        label: item.label,
        value: JSON.stringify(["item", item.value]),
      });
      previousGroup = group;
    }
    return result;
  });
  const rowIndices = createMemo(() =>
    rows().flatMap((row, index) => (row.kind === "item" ? [index] : [])),
  );
  const renderGroupLabel = (label: string): JSX.Element => (
    <div
      class="virtual-list__group-label"
      title={label}
      style={{
        height:
          props.itemSize === undefined ? "1.75rem" : `${props.itemSize}px`,
      }}
    >
      {label}
    </div>
  );
  const groupAtIndex = (index: number): string | undefined => {
    const row = rows()[index];
    return row?.kind === "heading"
      ? row.label
      : row && local.groupBy?.(row.item);
  };
  const activeGroup = createMemo(() => groupAtIndex(firstVisibleIndex()));
  createEffect(() => local.onActiveGroupChange?.(activeGroup()));
  onCleanup(() => local.onActiveGroupChange?.(undefined));
  const renderStickyGroupLabel = (index: number): JSX.Element => {
    const label = groupAtIndex(index);
    return label === undefined ? undefined : renderGroupLabel(label);
  };

  return (
    <VirtualList
      {...rest}
      items={rows()}
      scrollTargetIndex={
        local.scrollTargetIndex === undefined
          ? undefined
          : rowIndices()[local.scrollTargetIndex]
      }
      onFirstVisibleIndexChange={
        local.onActiveGroupChange === undefined
          ? undefined
          : setFirstVisibleIndex
      }
      stickyHeader={
        local.groupBy !== undefined && local.onActiveGroupChange === undefined
          ? renderStickyGroupLabel
          : undefined
      }
      ref={(api) =>
        local.ref?.({
          scrollToIndex: (index) =>
            api.scrollToIndex(rowIndices()[index] ?? index),
          scrollToStart: api.scrollToStart,
        })
      }
    >
      {(row) =>
        row.kind === "heading" ? (
          renderGroupLabel(row.label)
        ) : (
          <VirtualListItemPositionContext.Provider
            value={{
              index: row.index,
              setSize: () => local.items.length,
            }}
          >
            {local.children(row.item, row.index)}
          </VirtualListItemPositionContext.Provider>
        )
      }
    </VirtualList>
  );
}
