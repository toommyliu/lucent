import type { ReactNode } from "react";
import { Button, type ButtonProps } from "../button/Button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type TooltipContentProps,
} from "../tooltip/Tooltip";

export interface IconButtonProps extends Omit<
  ButtonProps,
  "aria-label" | "children" | "square"
> {
  readonly children: ReactNode;
  readonly label: string;
  readonly tooltip?: boolean;
  readonly tooltipSide?: TooltipContentProps["side"];
}

export function IconButton({
  label,
  tooltip = true,
  tooltipSide = "top",
  variant = "ghost",
  ...props
}: IconButtonProps) {
  const button = (
    <Button {...props} aria-label={label} square variant={variant} />
  );
  if (!tooltip) {
    return button;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  );
}
