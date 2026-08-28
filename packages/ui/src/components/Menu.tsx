import { Icon } from "./Icon";
import { Menu as MenuPrimitive, useMenuContext } from "@ark-ui/solid/menu";
import {
  children,
  createComputed,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  Show,
  splitProps,
  type Accessor,
  type JSX,
  useContext,
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

export type MenuProps = Parameters<typeof MenuPrimitive.Root>[0];

const MenuPositionedContext = createContext<Accessor<boolean>>();

interface MenuVirtualGroupRegistration {
  readonly getElement: () => HTMLElement | undefined;
  readonly handleKeyDown: (event: KeyboardEvent) => void;
  readonly isHighlighted: () => boolean;
  readonly isSearchActive: () => boolean;
  readonly ownsEventTarget: (target: EventTarget | null) => boolean;
}

interface MenuVirtualContextValue {
  readonly dispatchKeyDown: (event: KeyboardEvent) => void;
  readonly registerGroup: (
    registration: MenuVirtualGroupRegistration,
  ) => VoidFunction;
}

const MenuVirtualContext = createContext<MenuVirtualContextValue>();

function orderVirtualMenuGroups(
  registrations: ReadonlySet<MenuVirtualGroupRegistration>,
): MenuVirtualGroupRegistration[] {
  return [...registrations]
    .filter((registration) => registration.getElement() !== undefined)
    .toSorted((left, right) => {
      const leftElement = left.getElement();
      const rightElement = right.getElement();
      if (leftElement === undefined || rightElement === undefined) return 0;

      const node = leftElement.ownerDocument.defaultView?.Node;
      if (
        node === undefined ||
        leftElement.ownerDocument !== rightElement.ownerDocument
      ) {
        return 0;
      }

      const position = leftElement.compareDocumentPosition(rightElement);
      if ((position & node.DOCUMENT_POSITION_FOLLOWING) !== 0) return -1;
      if ((position & node.DOCUMENT_POSITION_PRECEDING) !== 0) return 1;
      return 0;
    });
}

function dispatchVirtualMenuKeyDown(
  registrations: ReadonlySet<MenuVirtualGroupRegistration>,
  event: KeyboardEvent,
): void {
  const groups = orderVirtualMenuGroups(registrations);
  const targetGroup = groups.find((group) =>
    group.ownsEventTarget(event.target),
  );
  if (targetGroup !== undefined) {
    targetGroup.handleKeyDown(event);
    return;
  }

  const searchGroup = groups.find((group) => group.isSearchActive());
  const group =
    searchGroup ??
    (event.key === "Home"
      ? groups[0]
      : event.key === "End"
        ? groups.at(-1)
        : groups.find((candidate) => candidate.isHighlighted()));
  group?.handleKeyDown(event);
}

function useMenuPositioned(): Accessor<boolean> {
  const positioned = useContext(MenuPositionedContext);
  if (positioned === undefined) {
    throw new Error("MenuContent must be rendered within Menu");
  }
  return positioned;
}

export function Menu(props: MenuProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "children",
    "onEscapeKeyDown",
    "positioning",
  ]);
  const virtualGroups = new Set<MenuVirtualGroupRegistration>();
  const virtualContext: MenuVirtualContextValue = {
    dispatchKeyDown(event) {
      dispatchVirtualMenuKeyDown(virtualGroups, event);
    },
    registerGroup(registration) {
      virtualGroups.add(registration);
      return () => virtualGroups.delete(registration);
    },
  };
  const { positioned, positioning } = createPositioningReady(
    () => local.positioning ?? { gutter: 4 },
  );
  const handleEscapeKeyDown = (event: KeyboardEvent): void => {
    local.onEscapeKeyDown?.(event);
    if (!event.defaultPrevented) virtualContext.dispatchKeyDown(event);
  };

  return (
    <MenuPositionedContext.Provider value={positioned}>
      <MenuVirtualContext.Provider value={virtualContext}>
        <MenuPrimitive.Root
          onEscapeKeyDown={handleEscapeKeyDown}
          positioning={positioning()}
          {...rest}
        >
          {local.children}
        </MenuPrimitive.Root>
      </MenuVirtualContext.Provider>
    </MenuPositionedContext.Provider>
  );
}

export type MenuTriggerProps = Parameters<typeof MenuPrimitive.Trigger>[0];

export function MenuTrigger(props: MenuTriggerProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <MenuPrimitive.Trigger
      {...rest}
      class={cn(local.class)}
      data-slot="menu-trigger"
    />
  );
}

export interface MenuContentProps extends Omit<
  Parameters<typeof MenuPrimitive.Content>[0],
  "class"
> {
  readonly class?: string;
  readonly onKeyDownCapture?: JSX.EventHandler<HTMLDivElement, KeyboardEvent>;
  readonly portal?: boolean;
}

export function MenuContent(props: MenuContentProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "children",
    "class",
    "portal",
    "ref",
  ]);
  const virtualContext = useContext(MenuVirtualContext);
  const dialogPortalMount = useDialogPortalMount();
  const dialogFloatingZIndex = useDialogFloatingZIndex();
  const positioned = useMenuPositioned();
  const [contentElement, setContentElement] = createSignal<HTMLDivElement>();
  const positionerStyle = () =>
    getPositionerStyle(positioned(), dialogFloatingZIndex);
  createEffect(() => {
    const element = contentElement();
    if (element === undefined) return;

    // Ark keeps focus on the content, so virtual navigation must run before
    // its DOM-based handler sees only the currently mounted rows.
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!event.defaultPrevented) virtualContext?.dispatchKeyDown(event);
    };
    element.addEventListener("keydown", handleKeyDown, { capture: true });
    onCleanup(() =>
      element.removeEventListener("keydown", handleKeyDown, { capture: true }),
    );
  });
  const content = () => (
    <MenuPrimitive.Positioner
      class="menu__positioner"
      data-slot="menu-positioner"
      style={positionerStyle()}
    >
      <MenuPrimitive.Content
        {...rest}
        class={cn("menu__content", local.class)}
        data-slot="menu-content"
        ref={(element) => {
          if (typeof local.ref === "function") local.ref(element);
          setContentElement(element);
        }}
      >
        <div class="menu__viewport" data-slot="menu-viewport">
          {local.children}
        </div>
      </MenuPrimitive.Content>
    </MenuPrimitive.Positioner>
  );

  if (local.portal === false) return content();

  return (
    <Show
      when={dialogPortalMount()}
      keyed
      fallback={<Portal>{content()}</Portal>}
    >
      {(mount) => <Portal mount={mount}>{content()}</Portal>}
    </Show>
  );
}

export interface MenuItemProps extends Omit<
  Parameters<typeof MenuPrimitive.Item>[0],
  "class"
> {
  readonly class?: string;
  readonly inset?: boolean;
  readonly variant?: "default" | "destructive";
}

export function MenuItem(props: MenuItemProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class", "inset", "variant"]);
  return (
    <MenuPrimitive.Item
      {...rest}
      class={cn("menu__item", local.inset && "menu__item--inset", local.class)}
      data-inset={local.inset ? "" : undefined}
      data-slot="menu-item"
      data-value={props.value}
      data-variant={local.variant ?? "default"}
    />
  );
}

export interface MenuLabelProps extends Omit<
  Parameters<typeof MenuPrimitive.ItemGroupLabel>[0],
  "class"
> {
  readonly class?: string;
  readonly inset?: boolean;
}

export function MenuLabel(props: MenuLabelProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class", "inset"]);
  return (
    <MenuPrimitive.ItemGroupLabel
      {...rest}
      class={cn(
        "menu__label",
        local.inset && "menu__label--inset",
        local.class,
      )}
      data-inset={local.inset ? "" : undefined}
      data-slot="menu-label"
    />
  );
}

export type MenuGroupProps = Parameters<typeof MenuPrimitive.ItemGroup>[0];

export function MenuGroup(props: MenuGroupProps): JSX.Element {
  return <MenuPrimitive.ItemGroup data-slot="menu-group" {...props} />;
}

export type MenuSeparatorProps = Parameters<typeof MenuPrimitive.Separator>[0];

export function MenuSeparator(props: MenuSeparatorProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <MenuPrimitive.Separator
      {...rest}
      class={cn("menu__separator", local.class)}
      data-slot="menu-separator"
    />
  );
}

export type MenuShortcutProps = Omit<
  JSX.HTMLAttributes<HTMLElement>,
  "class"
> & {
  readonly class?: string;
};

export function MenuShortcut(props: MenuShortcutProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <kbd
      {...rest}
      class={cn("menu__shortcut", local.class)}
      data-slot="menu-shortcut"
    />
  );
}

export interface MenuCheckboxItemProps extends Omit<
  Parameters<typeof MenuPrimitive.CheckboxItem>[0],
  "class"
> {
  readonly class?: string;
}

export function MenuCheckboxItem(props: MenuCheckboxItemProps): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class"]);
  return (
    <MenuPrimitive.CheckboxItem
      {...rest}
      class={cn("menu__item", "menu__option-item", local.class)}
      data-slot="menu-checkbox-item"
    >
      {local.children}
      <MenuPrimitive.ItemIndicator class="menu__item-indicator">
        <Icon icon="check" />
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.CheckboxItem>
  );
}

export type MenuRadioGroupProps = Parameters<
  typeof MenuPrimitive.RadioItemGroup
>[0];

export interface VirtualizedMenuRadioGroupProps<
  T extends VirtualListItem,
> extends Omit<MenuRadioGroupProps, "children"> {
  readonly children: (item: T, index: number) => JSX.Element;
  readonly emptyText?: string;
  /** Items with the same group must be contiguous. Headings are not selectable. */
  readonly groupBy?: ((item: T) => string) | undefined;
  /** Fixed menu controls beside the active group label. */
  readonly header?: JSX.Element;
  readonly itemSize?: number;
  readonly items: readonly T[];
  readonly overscan?: number;
  readonly searchable?: boolean;
  readonly scrollToSelected?: boolean;
}

function firstEnabledIndex<T extends VirtualListItem>(
  items: readonly T[],
): number {
  return items.findIndex((item) => item.disabled !== true);
}

function lastEnabledIndex<T extends VirtualListItem>(
  items: readonly T[],
): number {
  return items.findLastIndex((item) => item.disabled !== true);
}

function typeaheadMatchIndex<T extends VirtualListItem>(
  items: readonly T[],
  currentValue: string | null,
  query: string,
): number {
  const currentIndex = items.findIndex((item) => item.value === currentValue);
  const startIndex = Math.max(currentIndex, 0);
  const normalizedQuery = query.toLocaleLowerCase();

  for (let offset = 0; offset < items.length; offset += 1) {
    const index = (startIndex + offset) % items.length;
    const item = items[index];
    if (
      item === undefined ||
      item.disabled === true ||
      (query.length === 1 && index === currentIndex)
    ) {
      continue;
    }
    if (item.label.trim().toLocaleLowerCase().startsWith(normalizedQuery)) {
      return index;
    }
  }

  return -1;
}

export function MenuRadioGroup(props: MenuRadioGroupProps): JSX.Element {
  return (
    <MenuPrimitive.RadioItemGroup data-slot="menu-radio-group" {...props} />
  );
}

export function VirtualizedMenuRadioGroup<T extends VirtualListItem>(
  props: VirtualizedMenuRadioGroupProps<T>,
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
    "searchable",
    "scrollToSelected",
  ]);
  const context = useContext(MenuVirtualContext);
  if (context === undefined) {
    throw new Error("VirtualizedMenuRadioGroup must be rendered within Menu");
  }
  const menu = useMenuContext();
  const header = children(() => local.header);
  const [activeGroup, setActiveGroup] = createSignal<string>();
  const [query, setQuery] = createSignal("");
  const [scrollDirection, setScrollDirection] =
    createSignal<VirtualListScrollDirection>();
  const scrollButtonValue = `${createUniqueId()}-scroll-to-selected`;
  // Zag clears its highlight on pointer leave; keyboard navigation should
  // continue from that row instead of restarting at the beginning.
  let lastHighlightedValue: string | null = null;
  let alignedScrollFrame: number | undefined;
  let groupElement: HTMLDivElement | undefined;
  let searchInputElement: HTMLInputElement | undefined;
  let typeaheadQuery = "";
  let typeaheadResetTimer: ReturnType<typeof setTimeout> | undefined;
  let virtualList: VirtualListApi | undefined;
  const filteredItems = createMemo(() =>
    local.searchable === true
      ? filterVirtualListItems(local.items, query())
      : local.items,
  );
  const scrollTargetIndex = createMemo(() =>
    local.scrollToSelected
      ? filteredItems().findIndex((item) => item.value === props.value)
      : undefined,
  );
  const scrollToValue = (value: string | null): void => {
    if (value === null) return;
    const index = filteredItems().findIndex((item) => item.value === value);
    if (index >= 0) virtualList?.scrollToIndex(index);
  };
  const scheduleAlignedScroll = (index: number, value: string): void => {
    const view = groupElement?.ownerDocument.defaultView;
    if (view === undefined || view === null) return;

    if (alignedScrollFrame !== undefined) {
      view.cancelAnimationFrame(alignedScrollFrame);
    }
    alignedScrollFrame = view.requestAnimationFrame(() => {
      alignedScrollFrame = undefined;
      if (menu().open && menu().highlightedValue === value) {
        virtualList?.scrollToIndex(index);
      }
    });
  };

  const highlightItem = (index: number): void => {
    const item = filteredItems()[index];
    if (item === undefined) return;

    lastHighlightedValue = item.value;
    // Mount the virtual row before Zag resolves its active descendant.
    virtualList?.scrollToIndex(index);
    menu().setHighlightedValue(item.value);
    // Zag responds to the active-descendant change with scrollIntoView.
    // Reapply the row-aligned offset after its DOM observer has run.
    scheduleAlignedScroll(index, item.value);
  };
  const highlightFirstMenuItem = (): void => {
    if (menu().highlightedValue !== null) return;

    const content = groupElement?.closest<HTMLElement>(
      '[data-slot="menu-content"]',
    );
    const firstItem = content?.querySelector<HTMLElement>(
      '[role^="menuitem"][data-value]:not([data-disabled])',
    );
    const value = firstItem?.dataset["value"];
    if (
      firstItem != null &&
      value !== undefined &&
      (groupElement === undefined || !groupElement.contains(firstItem))
    ) {
      menu().setHighlightedValue(value);
      return;
    }

    const index = firstEnabledIndex(filteredItems());
    if (index >= 0) highlightItem(index);
  };
  const getEnabledMenuItemOutsideGroup = (
    position: "before" | "after",
  ): HTMLElement | undefined => {
    const group = groupElement;
    const content = group?.closest<HTMLElement>('[data-slot="menu-content"]');
    const node = content?.ownerDocument.defaultView?.Node;
    if (content == null || group === undefined || node == null) {
      return undefined;
    }

    const positionFlag =
      position === "before"
        ? node.DOCUMENT_POSITION_PRECEDING
        : node.DOCUMENT_POSITION_FOLLOWING;
    const items = [
      ...content.querySelectorAll<HTMLElement>(
        '[role^="menuitem"]:not([data-disabled])',
      ),
    ].filter(
      (item) =>
        !group.contains(item) &&
        (group.compareDocumentPosition(item) & positionFlag) !== 0,
    );
    return position === "before" ? items[0] : items.at(-1);
  };
  const moveHighlight = (direction: -1 | 1): boolean => {
    const items = filteredItems();
    if (items.length === 0) return false;

    const currentValue = menu().highlightedValue ?? lastHighlightedValue;
    const currentIndex = items.findIndex((item) => item.value === currentValue);
    if (currentIndex < 0) return false;

    let nextIndex = currentIndex;
    do {
      nextIndex += direction;
    } while (
      nextIndex >= 0 &&
      nextIndex < items.length &&
      items[nextIndex]?.disabled === true
    );

    if (nextIndex < 0 || nextIndex >= items.length) return false;
    highlightItem(nextIndex);
    return true;
  };
  const setSearchQuery = (nextQuery: string): void => {
    setQuery(nextQuery);
    virtualList?.scrollToStart();
    const nextItems = filterVirtualListItems(local.items, nextQuery);
    const firstIndex = firstEnabledIndex(nextItems);
    if (firstIndex >= 0) highlightItem(firstIndex);
    if (nextQuery === "") {
      queueMicrotask(() => {
        groupElement
          ?.closest<HTMLElement>('[data-slot="menu-content"]')
          ?.focus({ preventScroll: true });
      });
    }
  };
  const handleTypeahead = (event: KeyboardEvent): boolean => {
    if (
      event.key.length !== 1 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.key === " " && typeaheadQuery === "")
    ) {
      return false;
    }

    const search = `${typeaheadQuery}${event.key}`;
    const isRepeated =
      search.length > 1 &&
      Array.from(search).every((character) => character === search[0]);
    const query = isRepeated ? search.slice(0, 1) : search;
    typeaheadQuery = search;
    if (typeaheadResetTimer !== undefined) {
      clearTimeout(typeaheadResetTimer);
    }
    typeaheadResetTimer = setTimeout(() => {
      typeaheadQuery = "";
      typeaheadResetTimer = undefined;
    }, 350);

    const currentValue = menu().highlightedValue ?? lastHighlightedValue;
    const index = typeaheadMatchIndex(filteredItems(), currentValue, query);
    if (index >= 0) highlightItem(index);
    return true;
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (menu().highlightedValue === scrollButtonValue && event.key !== "Escape")
      return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const handled = moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      if (!handled) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      if (event.target === searchInputElement) return;

      const outsidePosition = event.key === "Home" ? "before" : "after";
      const outsideItem =
        query() === ""
          ? getEnabledMenuItemOutsideGroup(outsidePosition)
          : undefined;
      const outsideValue = outsideItem?.dataset["value"];
      if (outsideValue !== undefined) {
        event.preventDefault();
        event.stopImmediatePropagation();
        lastHighlightedValue = null;
        menu().setHighlightedValue(outsideValue);
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      const items = filteredItems();
      const index =
        event.key === "Home"
          ? firstEnabledIndex(items)
          : lastEnabledIndex(items);
      if (index >= 0) highlightItem(index);
      return;
    }

    if (local.searchable !== true) {
      if (!handleTypeahead(event)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (query() === "") {
        menu().setOpen(false);
        return;
      }

      const highlightedValue = menu().highlightedValue;
      setQuery("");
      queueMicrotask(() => {
        groupElement
          ?.closest<HTMLElement>('[data-slot="menu-content"]')
          ?.focus({ preventScroll: true });
        scrollToValue(highlightedValue);
      });
      return;
    }

    if (event.target === searchInputElement) return;

    const nextQuery = updateInlineSearchQuery(query(), event);
    if (nextQuery === undefined) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    setSearchQuery(nextQuery);
    if (nextQuery !== "") {
      queueMicrotask(() => searchInputElement?.focus({ preventScroll: true }));
    }
  };

  const unregisterGroup = context.registerGroup({
    getElement: () => groupElement,
    handleKeyDown,
    isHighlighted: () => {
      const highlightedValue = menu().highlightedValue ?? lastHighlightedValue;
      return (
        highlightedValue !== null &&
        local.items.some((item) => item.value === highlightedValue)
      );
    },
    isSearchActive: () => query() !== "",
    ownsEventTarget: (target) => {
      if (target === searchInputElement) return true;

      const group = groupElement;
      const node = group?.ownerDocument.defaultView?.Node;
      return (
        group !== undefined &&
        node !== undefined &&
        target instanceof node &&
        group.contains(target)
      );
    },
  });
  let wasOpen = false;
  createComputed(() => {
    const highlightedValue = menu().highlightedValue;
    if (highlightedValue === null) return;

    lastHighlightedValue = local.items.some(
      (item) => item.value === highlightedValue,
    )
      ? highlightedValue
      : null;
  });
  createComputed(() => {
    const open = menu().open;
    if (open && !wasOpen) {
      queueMicrotask(() => {
        if (menu().open) highlightFirstMenuItem();
      });
    }
    if (!open) {
      lastHighlightedValue = null;
      typeaheadQuery = "";
      if (typeaheadResetTimer !== undefined) {
        clearTimeout(typeaheadResetTimer);
        typeaheadResetTimer = undefined;
      }
      if (query() !== "") setQuery("");
    }
    wasOpen = open;
  });
  onCleanup(() => {
    unregisterGroup();
    if (typeaheadResetTimer !== undefined) {
      clearTimeout(typeaheadResetTimer);
    }
    if (alignedScrollFrame !== undefined) {
      groupElement?.ownerDocument.defaultView?.cancelAnimationFrame(
        alignedScrollFrame,
      );
    }
  });

  return (
    <>
      <Show when={header() !== undefined}>
        <div class="virtual-list__header" data-slot="menu-virtual-header">
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
            <MenuItem
              aria-label="Scroll to selected"
              class="virtual-list__scroll-button"
              closeOnSelect={false}
              data-direction={direction()}
              title="Scroll to selected"
              value={scrollButtonValue}
              onSelect={() => {
                const index = scrollTargetIndex();
                if (index === undefined || index < 0) return;
                virtualList?.scrollToIndex(index);
                const item = filteredItems()[index];
                if (item === undefined || item.disabled)
                  menu().setHighlightedValue("");
                else menu().setHighlightedValue(item.value);
              }}
            >
              <Icon
                icon={direction() === "up" ? "arrow_up" : "arrow_down"}
                size="sm"
              />
            </MenuItem>
          )}
        </Show>
        <MenuPrimitive.RadioItemGroup
          {...rest}
          class={cn("menu__virtual-group", local.class)}
          data-slot="menu-radio-group"
          ref={(element) => {
            groupElement = element;
          }}
        >
          <Show
            when={filteredItems().length > 0}
            fallback={
              <div class="menu__empty">
                {local.emptyText ?? "No matching options"}
              </div>
            }
          >
            <GroupedVirtualList
              class="virtual-list__items"
              getScrollElement={() => groupElement}
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
              }}
            >
              {local.children}
            </GroupedVirtualList>
          </Show>
        </MenuPrimitive.RadioItemGroup>
      </div>
    </>
  );
}

export interface MenuRadioItemProps extends Omit<
  Parameters<typeof MenuPrimitive.RadioItem>[0],
  "class"
> {
  readonly class?: string;
}

export function MenuRadioItem(props: MenuRadioItemProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "aria-posinset",
    "aria-setsize",
    "children",
    "class",
  ]);
  const virtualPosition = useVirtualListItemPosition();
  return (
    <MenuPrimitive.RadioItem
      {...rest}
      aria-posinset={
        local["aria-posinset"] ??
        (virtualPosition === undefined ? undefined : virtualPosition.index + 1)
      }
      aria-setsize={local["aria-setsize"] ?? virtualPosition?.setSize()}
      class={cn("menu__item", "menu__option-item", local.class)}
      data-slot="menu-radio-item"
    >
      {local.children}
      <MenuPrimitive.ItemIndicator class="menu__item-indicator">
        <Icon icon="check" />
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}

export type MenuSubProps = MenuProps;

export function MenuSub(props: MenuSubProps): JSX.Element {
  return <Menu {...props} />;
}

export interface MenuSubTriggerProps extends Omit<
  Parameters<typeof MenuPrimitive.TriggerItem>[0],
  "class"
> {
  readonly class?: string;
  readonly inset?: boolean;
}

export function MenuSubTrigger(props: MenuSubTriggerProps): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class", "inset"]);
  return (
    <MenuPrimitive.TriggerItem
      {...rest}
      class={cn(
        "menu__item",
        "menu__sub-trigger",
        local.inset && "menu__item--inset",
        local.class,
      )}
      data-inset={local.inset ? "" : undefined}
      data-slot="menu-sub-trigger"
    >
      {local.children}
      <Icon icon="chevron_right" class="menu__sub-icon" />
    </MenuPrimitive.TriggerItem>
  );
}

export type MenuSubContentProps = MenuContentProps;

export function MenuSubContent(props: MenuSubContentProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return <MenuContent {...rest} class={cn("menu__sub-content", local.class)} />;
}
