import type { JSX } from "solid-js";
import { Icon } from "./Icon";
import {
  TooltipIconButton,
  type TooltipIconButtonProps,
} from "./TooltipIconButton";

export type HelpTooltipProps = Pick<
  TooltipIconButtonProps,
  "aria-label" | "positioning" | "tooltip"
>;

export function HelpTooltip(props: HelpTooltipProps): JSX.Element {
  return (
    <TooltipIconButton {...props}>
      <Icon aria-hidden="true" icon="info" class="button__icon" />
    </TooltipIconButton>
  );
}
