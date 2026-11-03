import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";
import styles from "./ListGroup.module.css";

export type ListGroupProps = ComponentProps<"div">;

export function ListGroup({ className, ...props }: ListGroupProps) {
  return <div {...props} className={cn(styles.root, className)} />;
}

export type ListGroupItemProps = ComponentProps<"div">;

export function ListGroupItem({ className, ...props }: ListGroupItemProps) {
  return <div {...props} className={cn(styles.item, className)} />;
}
