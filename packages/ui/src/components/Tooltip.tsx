import { Tooltip as TooltipPrimitive } from "@ark-ui/solid/tooltip";
import { Show, splitProps, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "../lib/cn";
import { useDialogFloatingZIndex, useDialogPortalMount } from "./DialogLayer";

export type TooltipProps = Parameters<typeof TooltipPrimitive.Root>[0];

export function Tooltip(props: TooltipProps): JSX.Element {
  const [local, rest] = splitProps(props, ["positioning"]);
  return (
    <TooltipPrimitive.Root
      positioning={{ gutter: 4, ...local.positioning }}
      {...rest}
    />
  );
}

export type TooltipTriggerProps = Parameters<
  typeof TooltipPrimitive.Trigger
>[0];

export function TooltipTrigger(props: TooltipTriggerProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <TooltipPrimitive.Trigger
      {...rest}
      class={cn(local.class)}
      data-slot="tooltip-trigger"
    />
  );
}

export interface TooltipContentProps extends Omit<
  Parameters<typeof TooltipPrimitive.Content>[0],
  "class"
> {
  readonly class?: string;
  readonly portal?: boolean;
}

export function TooltipContent(props: TooltipContentProps): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class", "portal"]);
  const dialogPortalMount = useDialogPortalMount();
  const dialogFloatingZIndex = useDialogFloatingZIndex();
  const positionerStyle = (): JSX.CSSProperties | undefined =>
    dialogFloatingZIndex === undefined
      ? undefined
      : { "z-index": dialogFloatingZIndex };
  const content = () => (
    <TooltipPrimitive.Positioner
      class="tooltip__positioner"
      data-slot="tooltip-positioner"
      style={positionerStyle()}
    >
      <TooltipPrimitive.Content
        {...rest}
        class={cn("tooltip__content", local.class)}
        data-slot="tooltip-content"
      >
        {local.children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Positioner>
  );

  if (local.portal === false) return content();

  return (
    <Show
      when={dialogPortalMount()}
      keyed
      fallback={<Portal>{content()}</Portal>}
    >
      {(mount) => <Portal mount={mount}>{content()}</Portal>}
    </Show>
  );
}

export { TooltipPrimitive };
