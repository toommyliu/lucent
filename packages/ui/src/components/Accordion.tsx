import { Accordion as AccordionPrimitive } from "@ark-ui/solid/accordion";
import { splitProps, type JSX } from "solid-js";
import { Icon } from "./Icon";
import { cn } from "../lib/cn";

export type AccordionProps = Parameters<typeof AccordionPrimitive.Root>[0];

export function Accordion(props: AccordionProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <AccordionPrimitive.Root
      {...rest}
      class={cn("accordion", local.class)}
      data-slot="accordion"
    />
  );
}

export interface AccordionItemProps extends Omit<
  Parameters<typeof AccordionPrimitive.Item>[0],
  "class"
> {
  readonly class?: string;
}

export function AccordionItem(props: AccordionItemProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <AccordionPrimitive.Item
      {...rest}
      class={cn("accordion__item", local.class)}
      data-slot="accordion-item"
    />
  );
}

export interface AccordionTriggerProps extends Omit<
  Parameters<typeof AccordionPrimitive.ItemTrigger>[0],
  "class"
> {
  readonly class?: string;
}

export function AccordionTrigger(props: AccordionTriggerProps): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class"]);
  return (
    <AccordionPrimitive.ItemTrigger
      {...rest}
      class={cn("accordion__trigger", local.class)}
      data-slot="accordion-trigger"
    >
      <span class="accordion__trigger-content">{local.children}</span>
      <AccordionPrimitive.ItemIndicator class="accordion__indicator">
        <Icon icon="chevron_down" />
      </AccordionPrimitive.ItemIndicator>
    </AccordionPrimitive.ItemTrigger>
  );
}

export interface AccordionContentProps extends Omit<
  Parameters<typeof AccordionPrimitive.ItemContent>[0],
  "class"
> {
  readonly class?: string;
}

export function AccordionContent(props: AccordionContentProps): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class"]);
  return (
    <AccordionPrimitive.ItemContent
      {...rest}
      class={cn("accordion__content", local.class)}
      data-slot="accordion-content"
    >
      <div class="accordion__content-inner" data-slot="accordion-content-inner">
        {local.children}
      </div>
    </AccordionPrimitive.ItemContent>
  );
}
