import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";
import styles from "./Empty.module.css";

export type EmptyProps = ComponentProps<"div">;

export function Empty({ className, ...props }: EmptyProps) {
  return <div {...props} className={cn(styles.root, className)} />;
}

export type EmptyMediaVariant = "icon" | "plain";

export interface EmptyMediaProps extends ComponentProps<"div"> {
  readonly variant?: EmptyMediaVariant;
}

export function EmptyMedia({
  children,
  className,
  variant = "icon",
  ...props
}: EmptyMediaProps) {
  return (
    <div
      aria-hidden
      {...props}
      className={cn(styles.media, className)}
      data-variant={variant}
    >
      {variant === "icon" ? (
        <>
          <span className={styles.panel} data-side="start" />
          <span className={styles.panel} data-side="end" />
          <span className={styles.tile}>{children}</span>
        </>
      ) : (
        children
      )}
    </div>
  );
}

export type EmptyTitleProps = useRender.ComponentProps<"div">;

export function EmptyTitle({ className, render, ...props }: EmptyTitleProps) {
  return useRender({
    defaultTagName: "div",
    props: { ...props, className: cn(styles.title, className) },
    render,
  });
}

export type EmptyDescriptionProps = ComponentProps<"p">;

export function EmptyDescription({
  className,
  ...props
}: EmptyDescriptionProps) {
  return <p {...props} className={cn(styles.description, className)} />;
}

export type EmptyActionsProps = ComponentProps<"div">;

export function EmptyActions({ className, ...props }: EmptyActionsProps) {
  return <div {...props} className={cn(styles.actions, className)} />;
}
