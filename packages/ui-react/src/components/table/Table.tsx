import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";
import styles from "./Table.module.css";

export interface TableProps extends ComponentProps<"table"> {
  readonly stickyHeader?: boolean;
}

export function Table({
  className,
  stickyHeader = false,
  ...props
}: TableProps) {
  return (
    <table
      {...props}
      className={cn(styles.root, className)}
      data-sticky-header={stickyHeader ? "" : undefined}
    />
  );
}

export type TableHeaderProps = ComponentProps<"thead">;

export function TableHeader(props: TableHeaderProps) {
  return <thead {...props} />;
}

export type TableBodyProps = ComponentProps<"tbody">;

export function TableBody({ className, ...props }: TableBodyProps) {
  return <tbody {...props} className={cn(styles.body, className)} />;
}

export type TableFooterProps = ComponentProps<"tfoot">;

export function TableFooter({ className, ...props }: TableFooterProps) {
  return <tfoot {...props} className={cn(styles.footer, className)} />;
}

export interface TableRowProps extends ComponentProps<"tr"> {
  readonly selected?: boolean;
}

export function TableRow({
  className,
  selected = false,
  ...props
}: TableRowProps) {
  return (
    <tr
      {...props}
      className={cn(styles.row, className)}
      data-selected={selected ? "" : undefined}
    />
  );
}

export interface TableHeadProps extends ComponentProps<"th"> {
  readonly numeric?: boolean;
}

export function TableHead({
  className,
  numeric = false,
  ...props
}: TableHeadProps) {
  return (
    <th
      {...props}
      className={cn(styles.head, className)}
      data-numeric={numeric ? "" : undefined}
    />
  );
}

export interface TableCellProps extends ComponentProps<"td"> {
  readonly numeric?: boolean;
}

export function TableCell({
  className,
  numeric = false,
  ...props
}: TableCellProps) {
  return (
    <td
      {...props}
      className={cn(styles.cell, className)}
      data-numeric={numeric ? "" : undefined}
    />
  );
}

export type TableCaptionProps = ComponentProps<"caption">;

export function TableCaption({ className, ...props }: TableCaptionProps) {
  return <caption {...props} className={cn(styles.caption, className)} />;
}
