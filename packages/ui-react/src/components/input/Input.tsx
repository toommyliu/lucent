import { Input as BaseInput } from "@base-ui/react/input";
import { cn, type WithClassName } from "../../lib/cn";
import control from "../../styles/control.module.css";
import styles from "./Input.module.css";

export type InputSize = "sm" | "md" | "lg";

export interface InputProps extends WithClassName<
  Omit<BaseInput.Props, "size">
> {
  readonly size?: InputSize;
}

export function Input({ className, size = "md", ...props }: InputProps) {
  return (
    <BaseInput
      {...props}
      className={cn(control.control, styles.root, className)}
      data-size={size}
    />
  );
}
