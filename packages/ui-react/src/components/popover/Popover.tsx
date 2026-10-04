import { Popover as BasePopover } from "@base-ui/react/popover";
import { cn, type WithClassName } from "../../lib/cn";
import popup from "../../styles/popup.module.css";
import styles from "./Popover.module.css";

export const Popover = BasePopover.Root;
export type PopoverProps = BasePopover.Root.Props;

export const PopoverTrigger = BasePopover.Trigger;
export type PopoverTriggerProps = BasePopover.Trigger.Props;

export const PopoverClose = BasePopover.Close;
export type PopoverCloseProps = BasePopover.Close.Props;

export interface PopoverContentProps
  extends
    WithClassName<BasePopover.Popup.Props>,
    Pick<
      BasePopover.Positioner.Props,
      | "align"
      | "alignOffset"
      | "anchor"
      | "collisionPadding"
      | "side"
      | "sideOffset"
    > {}

export function PopoverContent({
  align = "center",
  alignOffset = 0,
  anchor,
  className,
  collisionPadding = 8,
  side = "bottom",
  sideOffset = 4,
  ...props
}: PopoverContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className={popup.positioner}
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
      >
        <BasePopover.Popup
          {...props}
          className={cn(popup.popup, styles.popup, className)}
        />
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}

export type PopoverTitleProps = WithClassName<BasePopover.Title.Props>;

export function PopoverTitle({ className, ...props }: PopoverTitleProps) {
  return (
    <BasePopover.Title {...props} className={cn(styles.title, className)} />
  );
}

export type PopoverDescriptionProps =
  WithClassName<BasePopover.Description.Props>;

export function PopoverDescription({
  className,
  ...props
}: PopoverDescriptionProps) {
  return (
    <BasePopover.Description
      {...props}
      className={cn(styles.description, className)}
    />
  );
}
