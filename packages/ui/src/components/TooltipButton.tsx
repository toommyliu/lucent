import { splitProps, type JSX } from "solid-js";
import { Button, type ButtonProps } from "./Button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type TooltipContentProps,
  type TooltipProps,
} from "./Tooltip";

export type TooltipButtonProps = TooltipProps;

export function TooltipButton(props: TooltipButtonProps): JSX.Element {
  return <Tooltip {...props} />;
}

export type TooltipButtonTriggerProps = ButtonProps & {
  readonly triggerOnFocus?: boolean;
};

export function TooltipButtonTrigger(
  props: TooltipButtonTriggerProps,
): JSX.Element {
  const [local, rest] = splitProps(props, ["triggerOnFocus"]);
  return (
    <TooltipTrigger
      asChild={(triggerProps) => {
        const mergedProps = triggerProps(
          rest as JSX.ButtonHTMLAttributes<HTMLButtonElement>,
        );
        return (
          <Button
            {...(mergedProps as ButtonProps)}
            {...(local.triggerOnFocus === false ? { onFocus: undefined } : {})}
          />
        );
      }}
    />
  );
}

export type TooltipButtonContentProps = TooltipContentProps;

export function TooltipButtonContent(
  props: TooltipButtonContentProps,
): JSX.Element {
  return <TooltipContent {...props} />;
}
