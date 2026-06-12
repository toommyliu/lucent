import type { JSX } from "solid-js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type TooltipProps,
} from "./Tooltip";
import {
  IconButton,
  type IconButtonProps,
  type IconButtonSize,
} from "./IconButton";

export interface TooltipIconButtonProps {
  readonly "aria-label": string;
  readonly children: JSX.Element;
  readonly class?: string;
  readonly disabled?: boolean;
  readonly open?: TooltipProps["open"];
  readonly portal?: boolean;
  readonly positioning?: TooltipProps["positioning"];
  readonly size?: IconButtonSize;
  readonly tooltip: JSX.Element;
  readonly variant?: IconButtonProps["variant"];
  readonly onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
}

export function TooltipIconButton(props: TooltipIconButtonProps): JSX.Element {
  return (
    <Tooltip
      closeDelay={0}
      open={props.open}
      openDelay={200}
      positioning={{ placement: "top", ...props.positioning }}
    >
      <TooltipTrigger
        asChild={(triggerProps) => (
          <IconButton
            {...(triggerProps({
              "aria-label": props["aria-label"],
              children: props.children,
              class: props.class,
              disabled: props.disabled,
              onClick: props.onClick,
              size: props.size ?? "icon-sm",
              type: "button",
              variant: props.variant ?? "ghost",
            } as IconButtonProps) as IconButtonProps)}
          />
        )}
      />
      <TooltipContent
        {...(props.portal === undefined ? null : { portal: props.portal })}
      >
        {props.tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
