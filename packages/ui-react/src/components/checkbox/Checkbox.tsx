import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Icon } from "../icon/Icon";
import { cn, type WithClassName } from "../../lib/cn";
import styles from "./Checkbox.module.css";

export type CheckboxProps = WithClassName<
  Omit<BaseCheckbox.Root.Props, "children">
>;

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <BaseCheckbox.Root {...props} className={cn(styles.root, className)}>
      <BaseCheckbox.Indicator
        className={styles.indicator}
        render={(indicatorProps, state) => (
          <span {...indicatorProps}>
            {state.indeterminate ? (
              <Icon icon="minus" size="md" />
            ) : (
              <Icon icon="check" size="md" />
            )}
          </span>
        )}
      />
    </BaseCheckbox.Root>
  );
}
