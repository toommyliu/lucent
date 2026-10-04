import { Select as BaseSelect } from "@base-ui/react/select";
import { cn, type WithClassName } from "../../lib/cn";
import { Icon } from "../icon/Icon";
import control from "../../styles/control.module.css";
import popup from "../../styles/popup.module.css";
import styles from "./Select.module.css";

export type SelectProps<
  Value,
  Multiple extends boolean | undefined = false,
> = BaseSelect.Root.Props<Value, Multiple>;

export function Select<Value, Multiple extends boolean | undefined = false>({
  onOpenChange,
  readOnly = false,
  ...props
}: SelectProps<Value, Multiple>) {
  return (
    <BaseSelect.Root
      {...props}
      onOpenChange={(open, eventDetails) => {
        if (readOnly && open) {
          eventDetails.cancel();
          return;
        }
        onOpenChange?.(open, eventDetails);
      }}
      readOnly={readOnly}
    />
  );
}

export type SelectSize = "sm" | "md" | "lg";

export interface SelectTriggerProps extends WithClassName<BaseSelect.Trigger.Props> {
  readonly size?: SelectSize;
}

export function SelectTrigger({
  children,
  className,
  size = "md",
  ...props
}: SelectTriggerProps) {
  return (
    <BaseSelect.Trigger
      {...props}
      className={cn(control.control, styles.trigger, className)}
      data-size={size}
    >
      {children}
      <BaseSelect.Icon className={styles.icon}>
        <Icon icon="chevrons_up_down" size="md" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

export type SelectValueProps = WithClassName<BaseSelect.Value.Props>;

export function SelectValue({ className, ...props }: SelectValueProps) {
  return (
    <BaseSelect.Value {...props} className={cn(styles.value, className)} />
  );
}

type PositionerOptions = Pick<
  BaseSelect.Positioner.Props,
  | "align"
  | "alignItemWithTrigger"
  | "alignOffset"
  | "collisionPadding"
  | "side"
  | "sideOffset"
>;

export interface SelectContentProps
  extends WithClassName<BaseSelect.Popup.Props>, PositionerOptions {}

export function SelectContent({
  align = "start",
  alignItemWithTrigger = true,
  alignOffset = 0,
  children,
  className,
  collisionPadding = 8,
  side = "bottom",
  sideOffset = 4,
  ...props
}: SelectContentProps) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        align={align}
        alignItemWithTrigger={alignItemWithTrigger}
        alignOffset={alignOffset}
        className={popup.positioner}
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
      >
        <BaseSelect.Popup
          {...props}
          className={cn(popup.popup, styles.popup, className)}
        >
          <BaseSelect.ScrollUpArrow className={styles.scrollArrow}>
            <Icon icon="chevron_up" size="md" />
          </BaseSelect.ScrollUpArrow>
          <BaseSelect.List className={styles.list}>{children}</BaseSelect.List>
          <BaseSelect.ScrollDownArrow className={styles.scrollArrow}>
            <Icon icon="chevron_down" size="md" />
          </BaseSelect.ScrollDownArrow>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

export type SelectItemProps = WithClassName<BaseSelect.Item.Props>;

export function SelectItem({ children, className, ...props }: SelectItemProps) {
  return (
    <BaseSelect.Item
      {...props}
      className={cn(popup.item, popup.indicatorItem, className)}
    >
      <BaseSelect.ItemIndicator className={popup.indicator}>
        <Icon icon="check" size="md" />
      </BaseSelect.ItemIndicator>
      <BaseSelect.ItemText className={styles.itemText}>
        {children}
      </BaseSelect.ItemText>
    </BaseSelect.Item>
  );
}

export const SelectGroup = BaseSelect.Group;
export type SelectGroupProps = BaseSelect.Group.Props;

export type SelectGroupLabelProps = WithClassName<BaseSelect.GroupLabel.Props>;

export function SelectGroupLabel({
  className,
  ...props
}: SelectGroupLabelProps) {
  return (
    <BaseSelect.GroupLabel
      {...props}
      className={cn(popup.groupLabel, className)}
    />
  );
}

export type SelectSeparatorProps = WithClassName<BaseSelect.Separator.Props>;

export function SelectSeparator({ className, ...props }: SelectSeparatorProps) {
  return (
    <BaseSelect.Separator
      {...props}
      className={cn(popup.separator, className)}
    />
  );
}
