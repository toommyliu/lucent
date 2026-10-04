import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";
import styles from "./Card.module.css";

export type CardProps = ComponentProps<"div">;

export function Card({ className, ...props }: CardProps) {
  return <div {...props} className={cn(styles.root, className)} />;
}

export type CardHeaderProps = ComponentProps<"div">;

export function CardHeader({ className, ...props }: CardHeaderProps) {
  return <div {...props} className={cn(styles.header, className)} />;
}

export type CardTitleProps = useRender.ComponentProps<"div">;

export function CardTitle({ className, render, ...props }: CardTitleProps) {
  return useRender({
    defaultTagName: "div",
    props: { ...props, className: cn(styles.title, className) },
    render,
  });
}

export type CardDescriptionProps = ComponentProps<"div">;

export function CardDescription({ className, ...props }: CardDescriptionProps) {
  return <div {...props} className={cn(styles.description, className)} />;
}

export type CardActionProps = ComponentProps<"div">;

export function CardAction({ className, ...props }: CardActionProps) {
  return <div {...props} className={cn(styles.action, className)} />;
}

export type CardContentProps = ComponentProps<"div">;

export function CardContent({ className, ...props }: CardContentProps) {
  return <div {...props} className={cn(styles.content, className)} />;
}

export type CardFooterProps = ComponentProps<"div">;

export function CardFooter({ className, ...props }: CardFooterProps) {
  return <div {...props} className={cn(styles.footer, className)} />;
}
