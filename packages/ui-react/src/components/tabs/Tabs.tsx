import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { cn, type WithClassName } from "../../lib/cn";
import styles from "./Tabs.module.css";

export type TabsProps = WithClassName<BaseTabs.Root.Props>;

export function Tabs({ className, ...props }: TabsProps) {
  return <BaseTabs.Root {...props} className={cn(styles.root, className)} />;
}

export type TabsVariant = "segmented" | "underline";

export interface TabsListProps extends WithClassName<BaseTabs.List.Props> {
  readonly variant?: TabsVariant;
}

export function TabsList({
  children,
  className,
  variant = "segmented",
  ...props
}: TabsListProps) {
  return (
    <BaseTabs.List
      {...props}
      className={cn(styles.list, className)}
      data-variant={variant}
    >
      {children}
      <BaseTabs.Indicator className={styles.indicator} />
    </BaseTabs.List>
  );
}

export type TabsTabProps = WithClassName<BaseTabs.Tab.Props>;

export function TabsTab({ className, ...props }: TabsTabProps) {
  return <BaseTabs.Tab {...props} className={cn(styles.tab, className)} />;
}

export type TabsPanelProps = WithClassName<BaseTabs.Panel.Props>;

export function TabsPanel({ className, ...props }: TabsPanelProps) {
  return <BaseTabs.Panel {...props} className={cn(styles.panel, className)} />;
}
