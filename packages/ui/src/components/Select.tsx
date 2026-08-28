import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import {
  createListCollection,
  Select as SelectPrimitive,
  type CollectionItem,
  useSelectContext,
} from "@ark-ui/solid/select";
import {
  Show,
  children,
  createComputed,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  splitProps,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "../lib/cn";
import { useDialogFloatingZIndex, useDialogPortalMount } from "./DialogLayer";
import { createPositioningReady, getPositionerStyle } from "./Positioning";
import { VisuallyHidden } from "./VisuallyHidden";
import { GroupedVirtualList } from "./GroupedVirtualList";
import {
  VirtualListSearchInput,
  filterVirtualListItems,
  updateInlineSearchQuery,
  type VirtualListApi,
  type VirtualListItem,
  type VirtualListScrollDirection,
  useVirtualListItemPosition,
} from "./VirtualList";

export interface SelectOption extends CollectionItem {
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: string;
}

interface SelectContextValue {
  readonly registerItem: (item: SelectOption) => void;
  readonly setItemsOverride: (
    items: readonly SelectOption[] | undefined,
  ) => void;
  readonly setScrollToIndex: (
    handler: SelectScrollToIndexHandler | undefined,
  ) => void;
  readonly unregisterItem: (value: string) => void;
}

const SelectItemsContext = createContext<SelectContextValue>();
const SelectPositionedContext = createContext<Accessor<boolean>>();

function useSelectPositioned(): Accessor<boolean> {
  const positioned = useContext(SelectPositionedContext);
  if (positioned === undefined) {
    throw new Error("SelectContent must be rendered within Select");
  }
  return positioned;
}

export interface SelectProps extends Omit<
  Parameters<typeof SelectPrimitive.Root<SelectOption>>[0],
  "collection"
> {
  readonly items?: ReadonlyArray<SelectOption>;
}

type SelectScrollToIndexHandler = NonNullable<SelectProps["scrollToIndexFn"]>;

const defaultSelectPositioning: NonNullable<SelectProps["positioning"]> = {
  fitViewport: true,
  placement: "bottom-start",
  sameWidth: true,
};

export function Select(props: SelectProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "children",
    "class",
    "items",
    "positioning",
    "scrollToIndexFn",
  ]);
  const [registeredItems, setRegisteredItems] = createSignal<SelectOption[]>([
    ...(local.items ?? []),
  ]);
  const [itemsOverride, setItemsOverride] = createSignal<
    readonly SelectOption[] | undefined
  >();
  const [scrollToIndex, setStoredScrollToIndex] = createSignal<
    SelectScrollToIndexHandler | undefined
  >();
  const items = () => local.items ?? registeredItems();
  const collection = createMemo(() =>
    createListCollection<SelectOption>({
      items: itemsOverride() ?? items(),
    }),
  );
  const context: SelectContextValue = {
    registerItem(item) {
      setRegisteredItems((items) => {
        const next = items.filter(
          (candidate) => candidate.value !== item.value,
        );
        return [...next, item];
      });
    },
    setItemsOverride,
    setScrollToIndex(handler) {
      // Solid treats a bare function passed to a setter as an updater.
      setStoredScrollToIndex(() => handler);
    },
    unregisterItem(value) {
      setRegisteredItems((items) =>
        items.filter((candidate) => candidate.value !== value),
      );
    },
  };
  const handleScrollToIndex: SelectScrollToIndexHandler = (details) => {
    const handler = scrollToIndex();
    if (handler !== undefined) {
      handler(details);
      return;
    }
    local.scrollToIndexFn?.(details);
  };
  const { positioned, positioning } = createPositioningReady(() => ({
    ...defaultSelectPositioning,
    ...local.positioning,
  }));

  return (
    <SelectPositionedContext.Provider value={positioned}>
      <SelectItemsContext.Provider value={context}>
        <SelectPrimitive.Root
          {...rest}
          class={cn("select", local.class)}
          collection={collection()}
          data-slot="select"
          positioning={positioning()}
          scrollToIndexFn={
            scrollToIndex() === undefined && local.scrollToIndexFn === undefined
              ? undefined
              : handleScrollToIndex
          }
        >
          {local.children}
        </SelectPrimitive.Root>
      </SelectItemsContext.Provider>
    </SelectPositionedContext.Provider>
  );
}

export interface SelectButtonProps extends Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  "class" | "size"
> {
  readonly class?: string;
  readonly size?: "sm" | "default" | "lg";
}

export function SelectButton(props: SelectButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class", "size"]);
  const size = () => local.size ?? "default";
  return (
    <button
      {...rest}
      class={cn("select__trigger", `select__trigger--${size()}`, local.class)}
      data-slot="select-button"
      type={rest.type ?? "button"}
    >
      <span class="select__value">{local.children}</span>
      <Icon icon="chevrons_up_down" class="select__icon" />
    </button>
  );
}

export interface SelectTriggerProps extends Omit<
  Parameters<typeof SelectPrimitive.Trigger>[0],
  "class"
> {
  readonly class?: string;
  readonly size?: "sm" | "default" | "lg";
}

export function SelectTrigger(props: SelectTriggerProps): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class", "size"]);
  const size = () => local.size ?? "default";
  return (
    <SelectPrimitive.Trigger
      {...rest}
      class={cn("select__trigger", `select__trigger--${size()}`, local.class)}
      data-slot="select-trigger"
    >
      {local.children}
      <Icon icon="chevrons_up_down" class="select__icon" />
    </SelectPrimitive.Trigger>
  );
}

export interface SelectValueProps extends Omit<
  Parameters<typeof SelectPrimitive.ValueText>[0],
  "children"
> {
  readonly placeholder?: string;
}

export function SelectValue(props: SelectValueProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class", "placeholder"]);
  return (
    <SelectPrimitive.Context>
      {(context) => {
        const label = () => {
          const selected = context().selectedItems?.[0] as
            | SelectOption
            | undefined;
          return selected?.label ?? context().valueAsString;
        };
        return (
          <SelectPrimitive.ValueText
            {...rest}
            class={cn("select__value", local.class)}
            data-placeholder={!label() ? "" : undefined}
            data-slot="select-value"
          >
            {label() || local.placeholder}
          </SelectPrimitive.ValueText>
        );
      }}
    </SelectPrimitive.Context>
  );
}

export interface SelectContentProps extends Omit<
  Parameters<typeof SelectPrimitive.Content>[0],
  "class"
> {
  readonly class?: string;
  readonly portalMount?: Node | undefined;
}

export interface VirtualizedSelectContentProps<
  T extends VirtualListItem = SelectOption,
> extends Omit<SelectContentProps, "children"> {
  readonly children: (item: T, index: number) => JSX.Element;
  readonly emptyText?: string;
  /** Items with the same group must be contiguous. Headings are not selectable. */
  readonly groupBy?: ((item: T) => string) | undefined;
  /** Fixed content beside the active group. Set Select's composite={false} for controls. */
  readonly header?: JSX.Element;
  readonly itemSize?: number;
  readonly items: readonly T[];
  readonly overscan?: number;
  readonly searchable?: boolean;
  /** Adds a floating jump control. Set Select's composite={false} for controls. */
  readonly scrollToSelected?: boolean;
}

function SelectContentFrame(props: {
  readonly children: JSX.Element;
  readonly class?: string | undefined;
  readonly contentProps: Omit<SelectContentProps, "children" | "class">;
  readonly onKeyDownCapture?: ((event: KeyboardEvent) => void) | undefined;
  readonly portalMount?: Node | undefined;
}): JSX.Element {
  const [contentLocal, contentRest] = splitProps(props.contentProps, ["ref"]);
  const dialogPortalMount = useDialogPortalMount();
  const dialogFloatingZIndex = useDialogFloatingZIndex();
  const portalMount = () => props.portalMount ?? dialogPortalMount();
  const positioned = useSelectPositioned();
  const [contentElement, setContentElement] = createSignal<HTMLDivElement>();
  const positionerStyle = () =>
    getPositionerStyle(positioned(), dialogFloatingZIndex);
  createEffect(() => {
    const element = contentElement();
    const onKeyDownCapture = props.onKeyDownCapture;
    const view = element?.ownerDocument.defaultView;
    if (
      element === undefined ||
      onKeyDownCapture === undefined ||
      view === undefined ||
      view === null
    ) {
      return;
    }

    // Ark listens for Escape on document capture and handles listbox keys on
    // the content. Window capture lets the virtual list run before both.
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (!(target instanceof view.Node) || !element.contains(target)) return;
      onKeyDownCapture(event);
    };
    view.addEventListener("keydown", handleKeyDown, { capture: true });
    onCleanup(() =>
      view.removeEventListener("keydown", handleKeyDown, { capture: true }),
    );
  });
  const content = () => (
    <SelectPrimitive.Positioner
      class="select__positioner"
      data-slot="select-positioner"
      style={positionerStyle()}
    >
      <SelectPrimitive.Content
        {...contentRest}
        class={cn("select__content", props.class)}
        data-slot="select-content"
        ref={(element) => {
          if (typeof contentLocal.ref === "function") contentLocal.ref(element);
          setContentElement(element);
        }}
      >
        {props.children}
      </SelectPrimitive.Content>
    </SelectPrimitive.Positioner>
  );

  return (
    <Show when={portalMount()} keyed fallback={<Portal>{content()}</Portal>}>
      {(mount) => <Portal mount={mount}>{content()}</Portal>}
    </Show>
  );
}

export function SelectContent(props: SelectContentProps): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class", "portalMount"]);
  return (
    <SelectContentFrame
      class={local.class}
      contentProps={rest}
      portalMount={local.portalMount}
    >
      <SelectPrimitive.List class="select__list" data-slot="select-list">
        {local.children}
      </SelectPrimitive.List>
    </SelectContentFrame>
  );
}

export function VirtualizedSelectContent<T extends VirtualListItem>(
  props: VirtualizedSelectContentProps<T>,
): JSX.Element {
  const [local, rest] = splitProps(props, [
    "children",
    "class",
    "emptyText",
    "groupBy",
    "header",
    "itemSize",
    "items",
    "overscan",
    "portalMount",
    "searchable",
    "scrollToSelected",
  ]);
  const context = useContext(SelectItemsContext);
  if (context === undefined) {
    throw new Error("VirtualizedSelectContent must be rendered within Select");
  }
  const select = useSelectContext();
  const header = children(() => local.header);
  const [query, setQuery] = createSignal("");
  const [activeGroup, setActiveGroup] = createSignal<string>();
  const [scrollDirection, setScrollDirection] =
    createSignal<VirtualListScrollDirection>();
  let listElement: HTMLDivElement | undefined;
  let headerElement: HTMLDivElement | undefined;
  let searchInputElement: HTMLInputElement | undefined;
  let virtualList: VirtualListApi | undefined;
  let searchOriginValue: string | null = null;
  const filteredItems = createMemo(() =>
    local.searchable === true
      ? filterVirtualListItems(local.items, query())
      : local.items,
  );
  const selectedValue = createMemo(() => select().value[0]);
  const scrollTargetIndex = createMemo(() =>
    local.scrollToSelected
      ? filteredItems().findIndex((item) => item.value === selectedValue())
      : undefined,
  );
  const scrollToValue = (value: string | undefined | null): void => {
    if (value == null) return;
    const index = filteredItems().findIndex((item) => item.value === value);
    if (index >= 0) virtualList?.scrollToIndex(index);
  };
  const setSearchQuery = (nextQuery: string): void => {
    const currentValue = select().highlightedValue ?? select().value[0] ?? null;
    if (query() === "" && nextQuery !== "") {
      searchOriginValue = currentValue;
    }

    setQuery(nextQuery);
    virtualList?.scrollToStart();
    if (nextQuery !== "") {
      const firstItem = filterVirtualListItems(local.items, nextQuery).find(
        (item) => item.disabled !== true,
      );
      if (firstItem === undefined) {
        select().clearHighlightValue();
      } else {
        select().setHighlightValue(firstItem.value);
      }
      return;
    }

    const restoredValue = currentValue ?? searchOriginValue;
    searchOriginValue = null;
    queueMicrotask(() => {
      if (restoredValue !== null) {
        select().setHighlightValue(restoredValue);
      }
      const focusTarget =
        header() === undefined
          ? listElement?.closest<HTMLElement>('[data-slot="select-content"]')
          : listElement;
      focusTarget?.focus({ preventScroll: true });
      scrollToValue(restoredValue);
    });
  };

  createComputed(() => {
    if (!select().open && query() !== "") {
      setQuery("");
      searchOriginValue = null;
    }
  });
  createEffect(
    on(filteredItems, (items) => {
      context.setItemsOverride(items);
      const current = select();
      if (
        !current.open ||
        current.highlightedValue === null ||
        items.some((item) => item.value === current.highlightedValue)
      ) {
        return;
      }

      // Grouping can replace option values while the popup stays open.
      const next =
        items.find(
          (item) => item.value === current.value[0] && !item.disabled,
        ) ?? items.find((item) => !item.disabled);
      if (next === undefined) current.clearHighlightValue();
      else current.setHighlightValue(next.value);
    }),
  );
  context.setScrollToIndex((details) => {
    if (details.index >= 0) virtualList?.scrollToIndex(details.index);
  });
  onCleanup(() => {
    context.setItemsOverride(undefined);
    context.setScrollToIndex(undefined);
  });

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (local.searchable !== true) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (query() === "") {
        select().setOpen(false);
        return;
      }

      setSearchQuery("");
      return;
    }

    if (event.target === searchInputElement) return;
    if (event.target instanceof Node && headerElement?.contains(event.target)) {
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest("[data-scroll-to-selected]")
    )
      return;

    const nextQuery = updateInlineSearchQuery(query(), event);
    if (nextQuery === undefined) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    setSearchQuery(nextQuery);
    if (nextQuery !== "") {
      queueMicrotask(() => searchInputElement?.focus({ preventScroll: true }));
    }
  };

  return (
    <SelectContentFrame
      class={cn("select__content--virtualized", local.class)}
      contentProps={rest}
      onKeyDownCapture={handleKeyDown}
      portalMount={local.portalMount}
    >
      <Show when={header() !== undefined}>
        <div
          class="virtual-list__header select__header"
          data-slot="select-header"
          ref={(element) => {
            headerElement = element;
          }}
          onKeyDown={(event) => {
            // Let controls handle their own keys before Ark's list navigation.
            if (event.key !== "Escape") event.stopPropagation();
          }}
        >
          <Show when={activeGroup()}>
            {(group) => (
              <span class="virtual-list__active-group" title={group()}>
                {group()}
              </span>
            )}
          </Show>
          {header()}
        </div>
      </Show>
      <Show when={local.searchable === true && query() !== ""}>
        <VirtualListSearchInput
          ref={(element) => {
            searchInputElement = element;
          }}
          onInput={(event) => setSearchQuery(event.currentTarget.value)}
          value={query()}
        />
      </Show>
      <VisuallyHidden role="status" aria-live="polite">
        {query() === ""
          ? ""
          : `${filteredItems().length} ${filteredItems().length === 1 ? "result" : "results"}`}
      </VisuallyHidden>
      <div
        class="virtual-list__viewport"
        style={{
          "--virtual-list-scroll-top":
            header() !== undefined || local.groupBy === undefined
              ? undefined
              : local.itemSize === undefined
                ? "2rem"
                : `${local.itemSize + 4}px`,
        }}
      >
        <Show when={scrollDirection()}>
          {(direction) => (
            <IconButton
              aria-label="Scroll to selected"
              class="virtual-list__scroll-button"
              data-direction={direction()}
              data-scroll-to-selected
              size="icon-sm"
              title="Scroll to selected"
              variant="outline"
              onKeyDown={(event) => {
                if (event.key !== "Escape") event.stopPropagation();
              }}
              onClick={() => {
                const index = scrollTargetIndex();
                if (index === undefined || index < 0) return;
                listElement?.focus({ preventScroll: true });
                virtualList?.scrollToIndex(index);
                const item = filteredItems()[index];
                if (item !== undefined) select().setHighlightValue(item.value);
              }}
            >
              <Icon
                icon={direction() === "up" ? "arrow_up" : "arrow_down"}
                size="sm"
              />
            </IconButton>
          )}
        </Show>
        <SelectPrimitive.List
          class="select__list select__list--virtualized"
          data-autofocus={header() === undefined ? undefined : ""}
          data-slot="select-list"
          ref={(element) => {
            listElement = element;
          }}
        >
          <Show
            when={filteredItems().length > 0}
            fallback={
              <div class="select__empty">
                {local.emptyText ?? "No matching options"}
              </div>
            }
          >
            <GroupedVirtualList
              class="virtual-list__items"
              getScrollElement={() => listElement}
              itemSize={local.itemSize}
              items={filteredItems()}
              groupBy={local.groupBy}
              scrollTargetIndex={scrollTargetIndex()}
              onScrollTargetDirectionChange={setScrollDirection}
              onActiveGroupChange={
                header() === undefined ? undefined : setActiveGroup
              }
              overscan={local.overscan}
              ref={(api) => {
                virtualList = api;
                const highlightedValue =
                  select().highlightedValue ?? select().value[0];
                const highlightedIndex = filteredItems().findIndex(
                  (item) => item.value === highlightedValue,
                );
                if (highlightedIndex >= 0) api.scrollToIndex(highlightedIndex);
              }}
            >
              {local.children}
            </GroupedVirtualList>
          </Show>
        </SelectPrimitive.List>
      </div>
    </SelectContentFrame>
  );
}

export interface SelectItemProps extends Omit<
  Parameters<typeof SelectPrimitive.Item>[0],
  "class" | "item"
> {
  readonly class?: string;
  readonly disabled?: boolean;
  readonly item?: SelectOption;
  readonly label?: string;
  readonly value: string;
}

export function SelectItem(props: SelectItemProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "aria-posinset",
    "aria-setsize",
    "children",
    "class",
    "disabled",
    "item",
    "label",
    "value",
  ]);
  const context = useContext(SelectItemsContext);
  const virtualPosition = useVirtualListItemPosition();
  const childLabel = (): string | undefined => {
    const child = local.children;
    if (typeof child === "string" || typeof child === "number") {
      return String(child);
    }

    if (
      Array.isArray(child) &&
      child.length > 0 &&
      child.every(
        (part) => typeof part === "string" || typeof part === "number",
      )
    ) {
      return child.join("");
    }

    return undefined;
  };
  const item = createMemo<SelectOption>(() => ({
    label: local.item?.label ?? local.label ?? childLabel() ?? local.value,
    value: local.item?.value ?? local.value,
    ...(local.disabled === undefined ? {} : { disabled: local.disabled }),
  }));

  createEffect(() => {
    const registeredItem = item();

    context?.registerItem(registeredItem);
    onCleanup(() => context?.unregisterItem(registeredItem.value));
  });

  return (
    <SelectPrimitive.Item
      {...rest}
      aria-posinset={
        local["aria-posinset"] ??
        (virtualPosition === undefined ? undefined : virtualPosition.index + 1)
      }
      aria-setsize={local["aria-setsize"] ?? virtualPosition?.setSize()}
      class={cn("select__item", local.class)}
      data-slot="select-item"
      item={item()}
    >
      <SelectPrimitive.ItemIndicator class="select__item-indicator">
        <Icon icon="check" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText class="select__item-text">
        {local.children ?? item().label}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export type SelectGroupProps = Parameters<typeof SelectPrimitive.ItemGroup>[0];

export function SelectGroup(props: SelectGroupProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <SelectPrimitive.ItemGroup
      {...rest}
      class={cn("select__group", local.class)}
      data-slot="select-group"
    />
  );
}

export type SelectGroupLabelProps = Parameters<
  typeof SelectPrimitive.ItemGroupLabel
>[0];

export function SelectGroupLabel(props: SelectGroupLabelProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <SelectPrimitive.ItemGroupLabel
      {...rest}
      class={cn("select__group-label", local.class)}
      data-slot="select-group-label"
    />
  );
}

export type SelectLabelProps = Parameters<typeof SelectPrimitive.Label>[0];

export function SelectLabel(props: SelectLabelProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <SelectPrimitive.Label
      {...rest}
      class={cn("select__label", local.class)}
      data-slot="select-label"
    />
  );
}

export interface SelectSeparatorProps extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "class"
> {
  readonly class?: string;
}

export function SelectSeparator(props: SelectSeparatorProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      {...rest}
      class={cn("select__separator", local.class)}
      data-slot="select-separator"
      role="separator"
    />
  );
}
