import { splitProps } from "solid-js";
import { cn } from "../lib/cn";
import { Button, type ButtonProps } from "./Button";

export interface PillButtonProps extends Omit<ButtonProps, "class"> {
  readonly class?: string;
  readonly pressed?: boolean;
}

export function PillButton(props: PillButtonProps) {
  const [local, rest] = splitProps(props, ["children", "class", "pressed"]);

  return (
    <Button
      {...rest}
      aria-pressed={
        local.pressed === undefined
          ? undefined
          : local.pressed
            ? "true"
            : "false"
      }
      class={cn(
        "pill-button",
        local.pressed && "pill-button--pressed",
        local.class,
      )}
      data-pressed={local.pressed ? "" : undefined}
    >
      {local.children}
    </Button>
  );
}
