import { Button as BaseButton } from "@base-ui/react/button";
import { Children } from "react";
import { cn, type WithClassName } from "../../lib/cn";
import { Spinner } from "../spinner/Spinner";
import styles from "./Button.module.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "soft"
  | "ghost"
  | "danger"
  | "danger-soft";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends WithClassName<BaseButton.Props> {
  readonly loading?: boolean;
  readonly size?: ButtonSize;
  readonly square?: boolean;
  readonly variant?: ButtonVariant;
}

export function Button({
  children,
  className,
  disabled = false,
  focusableWhenDisabled = false,
  loading = false,
  size = "md",
  square = false,
  variant = "secondary",
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      {...props}
      aria-busy={loading || undefined}
      className={cn(styles.root, className)}
      data-loading={loading ? "" : undefined}
      data-size={size}
      data-square={square ? "" : undefined}
      data-variant={variant}
      disabled={disabled || loading}
      focusableWhenDisabled={focusableWhenDisabled || loading}
    >
      <span className={styles.label}>
        {Children.map(children, (child) =>
          typeof child === "string" || typeof child === "number" ? (
            <span>{child}</span>
          ) : (
            child
          ),
        )}
      </span>
      {loading ? (
        <span className={styles.spinner}>
          <Spinner size={size === "sm" ? 14 : 16} />
        </span>
      ) : null}
    </BaseButton>
  );
}
