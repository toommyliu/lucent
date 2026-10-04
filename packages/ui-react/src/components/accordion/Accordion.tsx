import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { Icon } from "../icon/Icon";
import { cn, type WithClassName } from "../../lib/cn";
import styles from "./Accordion.module.css";

export const Accordion = BaseAccordion.Root;
export type AccordionProps = BaseAccordion.Root.Props;

export type AccordionItemProps = WithClassName<BaseAccordion.Item.Props>;

export function AccordionItem({ className, ...props }: AccordionItemProps) {
  return (
    <BaseAccordion.Item {...props} className={cn(styles.item, className)} />
  );
}

export type AccordionTriggerProps = WithClassName<BaseAccordion.Trigger.Props>;

export function AccordionTrigger({
  children,
  className,
  ...props
}: AccordionTriggerProps) {
  return (
    <BaseAccordion.Header className={styles.header}>
      <BaseAccordion.Trigger
        {...props}
        className={cn(styles.trigger, className)}
      >
        {children}
        <Icon icon="chevron_down" size="md" className={styles.chevron} />
      </BaseAccordion.Trigger>
    </BaseAccordion.Header>
  );
}

export type AccordionPanelProps = WithClassName<BaseAccordion.Panel.Props>;

export function AccordionPanel({
  children,
  className,
  ...props
}: AccordionPanelProps) {
  return (
    <BaseAccordion.Panel {...props} className={cn(styles.panel, className)}>
      <div className={styles.content}>{children}</div>
    </BaseAccordion.Panel>
  );
}
