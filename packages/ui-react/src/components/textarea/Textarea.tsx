import { Input as BaseInput } from "@base-ui/react/input";
import { mergeProps } from "@base-ui/react/merge-props";
import type { ComponentProps, CSSProperties } from "react";
import { cn } from "../../lib/cn";
import control from "../../styles/control.module.css";
import styles from "./Textarea.module.css";

export type TextareaSize = "sm" | "md" | "lg";

export interface TextareaProps extends Omit<
  ComponentProps<"textarea">,
  "rows"
> {
  readonly autoResize?: boolean;
  readonly maxRows?: number;
  readonly minRows?: number;
  readonly onValueChange?: BaseInput.Props["onValueChange"];
  readonly size?: TextareaSize;
}

type RowVariables = Record<
  "--textarea-max-rows" | "--textarea-min-rows",
  number | undefined
>;

export function Textarea({
  autoResize = false,
  className,
  defaultValue,
  disabled,
  id,
  maxRows,
  minRows = 3,
  name,
  onValueChange,
  ref,
  size = "md",
  style,
  value,
  ...props
}: TextareaProps) {
  const rowVariables: CSSProperties & RowVariables = {
    "--textarea-max-rows": maxRows,
    "--textarea-min-rows": minRows,
  };
  return (
    <BaseInput
      className={cn(control.control, styles.root, className)}
      data-auto-resize={autoResize ? "" : undefined}
      data-size={size}
      defaultValue={defaultValue}
      disabled={disabled}
      id={id}
      name={name}
      onValueChange={onValueChange}
      ref={ref}
      render={(controlProps) => (
        <textarea
          {...mergeProps<"textarea">(controlProps, props)}
          rows={minRows}
        />
      )}
      style={{ ...rowVariables, ...style }}
      value={value}
    />
  );
}
