import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { cn, type WithClassName } from "../../lib/cn";
import { Icon } from "../icon/Icon";
import control from "../../styles/control.module.css";
import popup from "../../styles/popup.module.css";
import styles from "./Combobox.module.css";

export type ComboboxProps<
  Value,
  Multiple extends boolean | undefined = false,
  Item = Value,
> = BaseCombobox.Root.Props<Value, Multiple, Item>;

export function Combobox<
  Value,
  Multiple extends boolean | undefined = false,
  Item = Value,
>({
  onOpenChange,
  readOnly = false,
  ...props
}: ComboboxProps<Value, Multiple, Item>) {
  return (
    <BaseCombobox.Root
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

export const ComboboxValue = BaseCombobox.Value;
export type ComboboxValueProps = BaseCombobox.Value.Props;

export type ComboboxSize = "sm" | "md" | "lg";

export interface ComboboxInputGroupProps extends WithClassName<BaseCombobox.InputGroup.Props> {
  readonly size?: ComboboxSize;
}

export function ComboboxInputGroup({
  className,
  size = "md",
  ...props
}: ComboboxInputGroupProps) {
  return (
    <BaseCombobox.InputGroup
      {...props}
      className={cn(control.control, styles.inputGroup, className)}
      data-size={size}
    />
  );
}

export type ComboboxInputProps = WithClassName<BaseCombobox.Input.Props>;

export function ComboboxInput({ className, ...props }: ComboboxInputProps) {
  return (
    <BaseCombobox.Input {...props} className={cn(styles.input, className)} />
  );
}

export interface ComboboxTriggerProps extends WithClassName<BaseCombobox.Trigger.Props> {
  readonly "aria-label": string;
}

export function ComboboxTrigger({
  children,
  className,
  ...props
}: ComboboxTriggerProps) {
  return (
    <BaseCombobox.Trigger
      {...props}
      className={cn(styles.action, styles.trigger, className)}
    >
      {children ?? <Icon icon="chevrons_up_down" size="md" />}
    </BaseCombobox.Trigger>
  );
}

export interface ComboboxClearProps extends WithClassName<BaseCombobox.Clear.Props> {
  readonly "aria-label": string;
}

export function ComboboxClear({
  children,
  className,
  ...props
}: ComboboxClearProps) {
  return (
    <BaseCombobox.Clear
      {...props}
      className={cn(styles.action, styles.clear, className)}
    >
      {children ?? <Icon icon="x" size="md" />}
    </BaseCombobox.Clear>
  );
}

export type ComboboxChipsProps = WithClassName<BaseCombobox.Chips.Props>;

export function ComboboxChips({ className, ...props }: ComboboxChipsProps) {
  return (
    <BaseCombobox.Chips {...props} className={cn(styles.chips, className)} />
  );
}

export interface ComboboxChipProps extends WithClassName<BaseCombobox.Chip.Props> {
  readonly removeLabel: string;
}

export function ComboboxChip({
  children,
  className,
  removeLabel,
  ...props
}: ComboboxChipProps) {
  return (
    <BaseCombobox.Chip {...props} className={cn(styles.chip, className)}>
      {children}
      <BaseCombobox.ChipRemove
        aria-label={removeLabel}
        className={styles.chipRemove}
      >
        <Icon icon="x" size="md" />
      </BaseCombobox.ChipRemove>
    </BaseCombobox.Chip>
  );
}

type PositionerOptions = Pick<
  BaseCombobox.Positioner.Props,
  "align" | "alignOffset" | "collisionPadding" | "side" | "sideOffset"
>;

export interface ComboboxContentProps
  extends WithClassName<BaseCombobox.Popup.Props>, PositionerOptions {}

export function ComboboxContent({
  align = "start",
  alignOffset = 0,
  className,
  collisionPadding = 8,
  side = "bottom",
  sideOffset = 4,
  ...props
}: ComboboxContentProps) {
  return (
    <BaseCombobox.Portal>
      <BaseCombobox.Positioner
        align={align}
        alignOffset={alignOffset}
        className={popup.positioner}
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
      >
        <BaseCombobox.Popup
          {...props}
          className={cn(popup.popup, styles.popup, className)}
        />
      </BaseCombobox.Positioner>
    </BaseCombobox.Portal>
  );
}

export const ComboboxList = BaseCombobox.List;
export type ComboboxListProps = BaseCombobox.List.Props;

export const ComboboxCollection = BaseCombobox.Collection;
export type ComboboxCollectionProps = BaseCombobox.Collection.Props;

export type ComboboxItemProps = WithClassName<BaseCombobox.Item.Props>;

export function ComboboxItem({
  children,
  className,
  ...props
}: ComboboxItemProps) {
  return (
    <BaseCombobox.Item
      {...props}
      className={cn(popup.item, popup.indicatorItem, className)}
    >
      <BaseCombobox.ItemIndicator className={popup.indicator}>
        <Icon icon="check" size="md" />
      </BaseCombobox.ItemIndicator>
      {children}
    </BaseCombobox.Item>
  );
}

export type ComboboxEmptyProps = WithClassName<BaseCombobox.Empty.Props>;

export function ComboboxEmpty({ className, ...props }: ComboboxEmptyProps) {
  return (
    <BaseCombobox.Empty {...props} className={cn(styles.empty, className)} />
  );
}

export const ComboboxGroup = BaseCombobox.Group;
export type ComboboxGroupProps = BaseCombobox.Group.Props;

export type ComboboxGroupLabelProps =
  WithClassName<BaseCombobox.GroupLabel.Props>;

export function ComboboxGroupLabel({
  className,
  ...props
}: ComboboxGroupLabelProps) {
  return (
    <BaseCombobox.GroupLabel
      {...props}
      className={cn(popup.groupLabel, className)}
    />
  );
}

export type ComboboxSeparatorProps =
  WithClassName<BaseCombobox.Separator.Props>;

export function ComboboxSeparator({
  className,
  ...props
}: ComboboxSeparatorProps) {
  return (
    <BaseCombobox.Separator
      {...props}
      className={cn(popup.separator, styles.separator, className)}
    />
  );
}
