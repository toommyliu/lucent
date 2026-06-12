import { Icon } from "./Icon";
import { Menu as MenuPrimitive } from "@ark-ui/solid/menu";
import { splitProps, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "../lib/cn";

export type ContextMenuProps = Parameters<typeof MenuPrimitive.Root>[0];

export function ContextMenu(props: ContextMenuProps): JSX.Element {
  const [local, rest] = splitProps(props, ["positioning"]);
  return (
    <MenuPrimitive.Root
      positioning={local.positioning ?? { gutter: 4 }}
      {...rest}
    />
  );
}

export type ContextMenuTriggerProps = Parameters<
  typeof MenuPrimitive.ContextTrigger
>[0];

export function ContextMenuTrigger(
  props: ContextMenuTriggerProps,
): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <MenuPrimitive.ContextTrigger
      {...rest}
      class={cn(local.class)}
      data-slot="context-menu-trigger"
    />
  );
}

export interface ContextMenuContentProps extends Omit<
  Parameters<typeof MenuPrimitive.Content>[0],
  "class"
> {
  readonly class?: string;
  readonly portal?: boolean;
}

export function ContextMenuContent(
  props: ContextMenuContentProps,
): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class", "portal"]);
  const content = () => (
    <MenuPrimitive.Positioner
      class="context-menu__positioner menu__positioner"
      data-slot="context-menu-positioner"
    >
      <MenuPrimitive.Content
        {...rest}
        class={cn("context-menu__content", "menu__content", local.class)}
        data-slot="context-menu-content"
      >
        <div
          class="context-menu__viewport menu__viewport"
          data-slot="context-menu-viewport"
        >
          {local.children}
        </div>
      </MenuPrimitive.Content>
    </MenuPrimitive.Positioner>
  );

  return local.portal === false ? content() : <Portal>{content()}</Portal>;
}

export type ContextMenuPortalProps = Parameters<typeof Portal>[0];

export function ContextMenuPortal(props: ContextMenuPortalProps): JSX.Element {
  return <Portal {...props} />;
}

export interface ContextMenuItemProps extends Omit<
  Parameters<typeof MenuPrimitive.Item>[0],
  "class"
> {
  readonly class?: string;
  readonly inset?: boolean;
  readonly variant?: "default" | "destructive";
}

export function ContextMenuItem(props: ContextMenuItemProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "class",
    "inset",
    "onClick",
    "onSelect",
    "value",
    "variant",
  ]);
  let handledPrimitiveSelect = false;
  return (
    <MenuPrimitive.Item
      {...rest}
      onClick={(event) => {
        if (typeof local.onClick === "function") {
          (local.onClick as JSX.EventHandler<HTMLDivElement, MouseEvent>)(
            event,
          );
        }
        if (!handledPrimitiveSelect) local.onSelect?.();
      }}
      onSelect={() => {
        handledPrimitiveSelect = true;
        queueMicrotask(() => {
          handledPrimitiveSelect = false;
        });
        local.onSelect?.();
      }}
      value={local.value}
      class={cn(
        "context-menu__item",
        "menu__item",
        local.inset && "menu__item--inset",
        local.class,
      )}
      data-inset={local.inset ? "" : undefined}
      data-slot="context-menu-item"
      data-value={local.value}
      data-variant={local.variant ?? "default"}
    />
  );
}

export interface ContextMenuLabelProps extends Omit<
  Parameters<typeof MenuPrimitive.ItemGroupLabel>[0],
  "class"
> {
  readonly class?: string;
  readonly inset?: boolean;
}

export function ContextMenuLabel(props: ContextMenuLabelProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class", "inset"]);
  return (
    <MenuPrimitive.ItemGroupLabel
      {...rest}
      class={cn(
        "context-menu__label",
        "menu__label",
        local.inset && "menu__label--inset",
        local.class,
      )}
      data-inset={local.inset ? "" : undefined}
      data-slot="context-menu-label"
    />
  );
}

export type ContextMenuGroupProps = Parameters<
  typeof MenuPrimitive.ItemGroup
>[0];

export function ContextMenuGroup(props: ContextMenuGroupProps): JSX.Element {
  return <MenuPrimitive.ItemGroup data-slot="context-menu-group" {...props} />;
}

export type ContextMenuSeparatorProps = Parameters<
  typeof MenuPrimitive.Separator
>[0];

export function ContextMenuSeparator(
  props: ContextMenuSeparatorProps,
): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <MenuPrimitive.Separator
      {...rest}
      class={cn("context-menu__separator", "menu__separator", local.class)}
      data-slot="context-menu-separator"
    />
  );
}

export type ContextMenuShortcutProps = Omit<
  JSX.HTMLAttributes<HTMLElement>,
  "class"
> & {
  readonly class?: string;
};

export function ContextMenuShortcut(
  props: ContextMenuShortcutProps,
): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <kbd
      {...rest}
      class={cn("context-menu__shortcut", "menu__shortcut", local.class)}
      data-slot="context-menu-shortcut"
    />
  );
}

export interface ContextMenuCheckboxItemProps extends Omit<
  Parameters<typeof MenuPrimitive.CheckboxItem>[0],
  "class"
> {
  readonly class?: string;
  readonly variant?: "default" | "switch";
}

export function ContextMenuCheckboxItem(
  props: ContextMenuCheckboxItemProps,
): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class", "variant"]);
  return (
    <MenuPrimitive.CheckboxItem
      {...rest}
      class={cn(
        "context-menu__item",
        "menu__item",
        "menu__option-item",
        local.variant === "switch" && "context-menu__switch-item",
        local.class,
      )}
      data-slot="context-menu-checkbox-item"
      data-variant={local.variant ?? "default"}
    >
      {local.children}
      <MenuPrimitive.ItemIndicator class="menu__item-indicator">
        <Icon icon="check" />
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.CheckboxItem>
  );
}

export type ContextMenuRadioGroupProps = Parameters<
  typeof MenuPrimitive.RadioItemGroup
>[0];

export function ContextMenuRadioGroup(
  props: ContextMenuRadioGroupProps,
): JSX.Element {
  return (
    <MenuPrimitive.RadioItemGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  );
}

export interface ContextMenuRadioItemProps extends Omit<
  Parameters<typeof MenuPrimitive.RadioItem>[0],
  "class"
> {
  readonly class?: string;
}

export function ContextMenuRadioItem(
  props: ContextMenuRadioItemProps,
): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class"]);
  return (
    <MenuPrimitive.RadioItem
      {...rest}
      class={cn(
        "context-menu__item",
        "menu__item",
        "menu__option-item",
        local.class,
      )}
      data-slot="context-menu-radio-item"
    >
      {local.children}
      <MenuPrimitive.ItemIndicator class="menu__item-indicator">
        <div class="menu__radio-dot" />
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}

export type ContextMenuSubProps = ContextMenuProps;

export function ContextMenuSub(props: ContextMenuSubProps): JSX.Element {
  return <ContextMenu {...props} />;
}

export interface ContextMenuSubTriggerProps extends Omit<
  Parameters<typeof MenuPrimitive.TriggerItem>[0],
  "class"
> {
  readonly class?: string;
  readonly inset?: boolean;
}

export function ContextMenuSubTrigger(
  props: ContextMenuSubTriggerProps,
): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class", "inset"]);
  return (
    <MenuPrimitive.TriggerItem
      {...rest}
      class={cn(
        "context-menu__item",
        "context-menu__sub-trigger",
        "menu__item",
        "menu__sub-trigger",
        local.inset && "menu__item--inset",
        local.class,
      )}
      data-inset={local.inset ? "" : undefined}
      data-slot="context-menu-sub-trigger"
    >
      {local.children}
      <Icon icon="chevron_right" class="menu__sub-icon" />
    </MenuPrimitive.TriggerItem>
  );
}

export type ContextMenuSubContentProps = ContextMenuContentProps;

export function ContextMenuSubContent(
  props: ContextMenuSubContentProps,
): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <ContextMenuContent
      {...rest}
      class={cn("context-menu__sub-content", "menu__sub-content", local.class)}
    />
  );
}
