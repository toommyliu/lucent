import {
  Tooltip as TooltipPrimitive,
  useTooltipContext,
} from "@ark-ui/solid/tooltip";
import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
  splitProps,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "../lib/cn";
import { useDialogFloatingZIndex, useDialogPortalMount } from "./DialogLayer";

// Tolerate fractional layout pixels while requiring an effectively visible trigger.
const TOOLTIP_TRIGGER_VISIBILITY_THRESHOLD = 0.99;

export type TooltipProps = Parameters<typeof TooltipPrimitive.Root>[0];

export function Tooltip(props: TooltipProps): JSX.Element {
  const [local, rest] = splitProps(props, ["positioning"]);
  return (
    <TooltipPrimitive.Root
      positioning={{ gutter: 4, hideWhenDetached: true, ...local.positioning }}
      {...rest}
    />
  );
}

export type TooltipTriggerProps = Parameters<
  typeof TooltipPrimitive.Trigger
>[0];

export function TooltipTrigger(props: TooltipTriggerProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class", "ref"]);
  const tooltip = useTooltipContext();
  const [triggerElement, setTriggerElement] = createSignal<Element>();

  createEffect(() => {
    const element = triggerElement();
    const api = tooltip();
    if (!api.open || element === undefined) {
      return;
    }

    // A tooltip root can own multiple triggers; only its active trigger owns visibility.
    const activeTriggerId = api.getTriggerProps(
      api.triggerValue === null ? undefined : { value: api.triggerValue },
    ).id;
    if (element.id !== activeTriggerId) {
      return;
    }

    const IntersectionObserverConstructor =
      element.ownerDocument.defaultView?.IntersectionObserver;
    if (IntersectionObserverConstructor === undefined) {
      return;
    }

    const observer = new IntersectionObserverConstructor(
      ([entry]) => {
        const visible =
          entry?.isIntersecting === true &&
          entry.intersectionRatio >= TOOLTIP_TRIGGER_VISIBILITY_THRESHOLD;
        if (!visible) {
          api.setOpen(false);
        }
      },
      { threshold: [0, TOOLTIP_TRIGGER_VISIBILITY_THRESHOLD, 1] },
    );
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });

  return (
    <TooltipPrimitive.Trigger
      {...rest}
      class={cn(local.class)}
      data-slot="tooltip-trigger"
      ref={(element) => {
        setTriggerElement(element);
        if (typeof local.ref === "function") {
          local.ref(element);
        }
      }}
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
