import { Input as BaseInput } from "@base-ui/react/input";
import type { ComponentProps, MouseEvent } from "react";
import { cn, type WithClassName } from "../../lib/cn";
import control from "../../styles/control.module.css";
import styles from "./InputGroup.module.css";

export type InputGroupSize = "sm" | "md" | "lg";

export interface InputGroupProps extends ComponentProps<"div"> {
  readonly size?: InputGroupSize;
}

export function InputGroup({
  className,
  size = "md",
  ...props
}: InputGroupProps) {
  return (
    <div
      {...props}
      className={cn(control.control, styles.root, className)}
      data-size={size}
    />
  );
}

export type InputGroupInputProps = WithClassName<Omit<BaseInput.Props, "size">>;

export function InputGroupInput({ className, ...props }: InputGroupInputProps) {
  return <BaseInput {...props} className={cn(styles.input, className)} />;
}

export type InputGroupAddonProps = ComponentProps<"div">;

const interactiveSelector =
  "a, button, input, select, textarea, [role='button'], [tabindex]";

function focusGroupInput(event: MouseEvent<HTMLDivElement>) {
  const { target } = event;
  if (!(target instanceof Element) || target.closest(interactiveSelector)) {
    return;
  }
  const input =
    event.currentTarget.parentElement?.querySelector(":scope > input");
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  event.preventDefault();
  input.focus();
}

export function InputGroupAddon({
  className,
  onMouseDown,
  ...props
}: InputGroupAddonProps) {
  return (
    <div
      {...props}
      className={cn(styles.addon, className)}
      onMouseDown={(event) => {
        onMouseDown?.(event);
        if (!event.defaultPrevented) {
          focusGroupInput(event);
        }
      }}
    />
  );
}
