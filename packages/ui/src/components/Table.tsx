import { splitProps, type JSX } from "solid-js";
import { cn } from "../lib/cn";

export type TableVariant = "card" | "default";

export interface TableProps extends JSX.HTMLAttributes<HTMLTableElement> {
  readonly class?: string;
  readonly variant?: TableVariant;
}

export interface TableHeaderProps extends JSX.HTMLAttributes<HTMLTableSectionElement> {
  readonly class?: string;
}

export interface TableBodyProps extends JSX.HTMLAttributes<HTMLTableSectionElement> {
  readonly class?: string;
}

export interface TableFooterProps extends JSX.HTMLAttributes<HTMLTableSectionElement> {
  readonly class?: string;
}

export interface TableRowProps extends JSX.HTMLAttributes<HTMLTableRowElement> {
  readonly class?: string;
}

export interface TableHeadProps extends JSX.ThHTMLAttributes<HTMLTableCellElement> {
  readonly class?: string;
}

export interface TableCellProps extends JSX.TdHTMLAttributes<HTMLTableCellElement> {
  readonly class?: string;
}

export interface TableCaptionProps extends JSX.CaptionHTMLAttributes<HTMLTableCaptionElement> {
  readonly class?: string;
}

export function Table(props: TableProps): JSX.Element {
  const [local, tableProps] = splitProps(props, [
    "children",
    "class",
    "variant",
  ]);
  const variant = () => local.variant ?? "default";

  return (
    <div
      class={cn("table-container", `table-container--${variant()}`)}
      data-slot="table-container"
      data-variant={variant()}
    >
      <table {...tableProps} class={cn("table", local.class)} data-slot="table">
        {local.children}
      </table>
    </div>
  );
}

export function TableHeader(props: TableHeaderProps): JSX.Element {
  const [local, tableHeaderProps] = splitProps(props, ["children", "class"]);
  return (
    <thead
      {...tableHeaderProps}
      class={cn("table__header", local.class)}
      data-slot="table-header"
    >
      {local.children}
    </thead>
  );
}

export function TableBody(props: TableBodyProps): JSX.Element {
  const [local, tableBodyProps] = splitProps(props, ["children", "class"]);
  return (
    <tbody
      {...tableBodyProps}
      class={cn("table__body", local.class)}
      data-slot="table-body"
    >
      {local.children}
    </tbody>
  );
}

export function TableFooter(props: TableFooterProps): JSX.Element {
  const [local, tableFooterProps] = splitProps(props, ["children", "class"]);
  return (
    <tfoot
      {...tableFooterProps}
      class={cn("table__footer", local.class)}
      data-slot="table-footer"
    >
      {local.children}
    </tfoot>
  );
}

export function TableRow(props: TableRowProps): JSX.Element {
  const [local, tableRowProps] = splitProps(props, ["children", "class"]);
  return (
    <tr
      {...tableRowProps}
      class={cn("table__row", local.class)}
      data-slot="table-row"
    >
      {local.children}
    </tr>
  );
}

export function TableHead(props: TableHeadProps): JSX.Element {
  const [local, tableHeadProps] = splitProps(props, ["children", "class"]);
  return (
    <th
      {...tableHeadProps}
      class={cn("table__head", local.class)}
      data-slot="table-head"
    >
      {local.children}
    </th>
  );
}

export function TableCell(props: TableCellProps): JSX.Element {
  const [local, tableCellProps] = splitProps(props, ["children", "class"]);
  return (
    <td
      {...tableCellProps}
      class={cn("table__cell", local.class)}
      data-slot="table-cell"
    >
      {local.children}
    </td>
  );
}

export function TableCaption(props: TableCaptionProps): JSX.Element {
  const [local, tableCaptionProps] = splitProps(props, ["children", "class"]);
  return (
    <caption
      {...tableCaptionProps}
      class={cn("table__caption", local.class)}
      data-slot="table-caption"
    >
      {local.children}
    </caption>
  );
}
