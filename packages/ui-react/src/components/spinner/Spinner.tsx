import { cn } from "../../lib/cn";
import { Icon, type IconProps } from "../icon/Icon";
import styles from "./Spinner.module.css";

export interface SpinnerProps extends Omit<
  IconProps,
  "children" | "icon" | "size"
> {
  readonly label?: string;
  readonly size?: number;
}

export function Spinner({
  className,
  label,
  size = 16,
  ...props
}: SpinnerProps) {
  return (
    <Icon
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      className={cn(styles.root, className)}
      icon="loader_circle"
      role={label === undefined ? undefined : "status"}
      size={size}
      {...props}
    />
  );
}
