import { useRender } from "@base-ui/react/use-render";
import { cn, type WithClassName } from "../../lib/cn";
import styles from "./Label.module.css";

export type LabelProps = WithClassName<useRender.ComponentProps<"label">>;

export function Label({ className, render, ...props }: LabelProps) {
  return useRender({
    defaultTagName: "label",
    props: { ...props, className: cn(styles.root, className) },
    render,
  });
}
