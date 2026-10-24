import { useRender } from "@base-ui/react/use-render";
import { cn } from "../../lib/cn";
import styles from "./Badge.module.css";

export type BadgeVariant =
  | "neutral"
  | "outline"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info";

export type BadgeSize = "sm" | "md";

export interface BadgeProps extends useRender.ComponentProps<"span"> {
  readonly dot?: boolean;
  readonly size?: BadgeSize;
  readonly variant?: BadgeVariant;
}

export function Badge({
  children,
  className,
  dot = false,
  render,
  size = "md",
  variant = "neutral",
  ...props
}: BadgeProps) {
  return useRender({
    defaultTagName: "span",
    props: {
      ...props,
      children: (
        <>
          {dot ? <span aria-hidden className={styles.dot} /> : null}
          {children}
        </>
      ),
      className: cn(styles.root, className),
      "data-size": size,
      "data-variant": variant,
    },
    render,
  });
}
