import { Separator as BaseSeparator } from "@base-ui/react/separator";
import { cn, type WithClassName } from "../../lib/cn";
import styles from "./Separator.module.css";

export type SeparatorProps = WithClassName<BaseSeparator.Props>;

export function Separator({ className, ...props }: SeparatorProps) {
  return <BaseSeparator {...props} className={cn(styles.root, className)} />;
}
