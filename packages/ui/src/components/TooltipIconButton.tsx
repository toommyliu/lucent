import { mergeProps, splitProps, type JSX } from "solid-js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type TooltipProps,
} from "./Tooltip";
import { IconButton, type IconButtonProps } from "./IconButton";

export interface TooltipIconButtonProps extends Omit<IconButtonProps, "title"> {
  readonly open?: TooltipProps["open"];
  readonly portal?: boolean;
  readonly positioning?: TooltipProps["positioning"];
  readonly tooltip: JSX.Element;
}

export function TooltipIconButton(props: TooltipIconButtonProps): JSX.Element {
  const [local, buttonProps] = splitProps(props, [
    "open",
    "portal",
    "positioning",
    "tooltip",
  ]);
  const resolvedButtonProps = mergeProps(
    {
      size: "icon-sm" as const,
      type: "button" as const,
      variant: "ghost" as const,
    },
    buttonProps,
  );

  return (
    <Tooltip
      closeDelay={0}
      open={local.open}
      openDelay={200}
      positioning={{ placement: "top", ...local.positioning }}
    >
      <TooltipTrigger
        asChild={(triggerProps) => (
          <IconButton
            {...(triggerProps(
              resolvedButtonProps as IconButtonProps,
            ) as IconButtonProps)}
            data-tooltip-icon-button=""
          />
        )}
      />
      <TooltipContent
        {...(local.portal === undefined ? null : { portal: local.portal })}
      >
        {local.tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
