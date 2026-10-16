import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn, type WithClassName } from "../../lib/cn";
import styles from "./Switch.module.css";

export type SwitchSize = "sm" | "md";

export interface SwitchProps extends WithClassName<
  Omit<BaseSwitch.Root.Props, "children">
> {
  readonly size?: SwitchSize;
}

export function Switch({ className, size = "md", ...props }: SwitchProps) {
  return (
    <BaseSwitch.Root
      {...props}
      className={cn(styles.root, className)}
      data-size={size}
    >
      <BaseSwitch.Thumb className={styles.thumb} />
    </BaseSwitch.Root>
  );
}
