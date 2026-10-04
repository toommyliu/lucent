import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";
import styles from "./Kbd.module.css";

export type KbdProps = ComponentProps<"kbd">;

export function Kbd({ className, ...props }: KbdProps) {
  return <kbd {...props} className={cn(styles.root, className)} />;
}

export type KbdGroupProps = ComponentProps<"kbd">;

export function KbdGroup({ className, ...props }: KbdGroupProps) {
  return <kbd {...props} className={cn(styles.group, className)} />;
}
