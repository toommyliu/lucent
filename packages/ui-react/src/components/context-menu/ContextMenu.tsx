import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { cn, type WithClassName } from "../../lib/cn";
import popup from "../../styles/popup.module.css";
import menu from "../menu/Menu.module.css";

export const ContextMenu = BaseContextMenu.Root;
export type ContextMenuProps = BaseContextMenu.Root.Props;

export const ContextMenuTrigger = BaseContextMenu.Trigger;
export type ContextMenuTriggerProps = BaseContextMenu.Trigger.Props;

export interface ContextMenuContentProps
  extends
    WithClassName<BaseContextMenu.Popup.Props>,
    Pick<
      BaseContextMenu.Positioner.Props,
      "align" | "alignOffset" | "collisionPadding" | "side" | "sideOffset"
    > {}

export function ContextMenuContent({
  align,
  alignOffset,
  className,
  collisionPadding = 8,
  side,
  sideOffset,
  ...props
}: ContextMenuContentProps) {
  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner
        align={align}
        alignOffset={alignOffset}
        className={popup.positioner}
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
      >
        <BaseContextMenu.Popup
          {...props}
          className={cn(popup.popup, menu.popup, className)}
        />
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  );
}

export {
  MenuCheckboxItem as ContextMenuCheckboxItem,
  MenuContent as ContextMenuSubmenuContent,
  MenuGroup as ContextMenuGroup,
  MenuGroupLabel as ContextMenuGroupLabel,
  MenuItem as ContextMenuItem,
  MenuLinkItem as ContextMenuLinkItem,
  MenuRadioGroup as ContextMenuRadioGroup,
  MenuRadioItem as ContextMenuRadioItem,
  MenuSeparator as ContextMenuSeparator,
  MenuShortcut as ContextMenuShortcut,
  MenuSubmenu as ContextMenuSubmenu,
  MenuSubmenuTrigger as ContextMenuSubmenuTrigger,
  type MenuCheckboxItemProps as ContextMenuCheckboxItemProps,
  type MenuContentProps as ContextMenuSubmenuContentProps,
  type MenuGroupLabelProps as ContextMenuGroupLabelProps,
  type MenuGroupProps as ContextMenuGroupProps,
  type MenuItemProps as ContextMenuItemProps,
  type MenuItemVariant as ContextMenuItemVariant,
  type MenuLinkItemProps as ContextMenuLinkItemProps,
  type MenuRadioGroupProps as ContextMenuRadioGroupProps,
  type MenuRadioItemProps as ContextMenuRadioItemProps,
  type MenuSeparatorProps as ContextMenuSeparatorProps,
  type MenuShortcutProps as ContextMenuShortcutProps,
  type MenuSubmenuProps as ContextMenuSubmenuProps,
  type MenuSubmenuTriggerProps as ContextMenuSubmenuTriggerProps,
} from "../menu/Menu";
