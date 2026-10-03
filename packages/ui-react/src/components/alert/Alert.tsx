import type { ComponentProps, ReactNode } from "react";
import { Icon } from "../icon/Icon";
import { cn } from "../../lib/cn";
import styles from "./Alert.module.css";

export type AlertVariant =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export interface AlertProps extends ComponentProps<"div"> {
  readonly icon?: ReactNode;
  readonly variant?: AlertVariant;
}

const statusGlyphs = {
  danger: <Icon icon="circle_alert" size="md" />,
  info: <Icon icon="info" size="md" />,
  neutral: <Icon icon="info" size="md" />,
  success: <Icon icon="circle_check" size="md" />,
  warning: <Icon icon="triangle_alert" size="md" />,
} satisfies Record<AlertVariant, ReactNode>;

export function Alert({
  children,
  className,
  icon,
  variant = "neutral",
  ...props
}: AlertProps) {
  const glyph = icon === undefined ? statusGlyphs[variant] : icon;
  const hasIcon = glyph !== null && glyph !== false;
  return (
    <div
      {...props}
      className={cn(styles.root, className)}
      data-icon={hasIcon ? "" : undefined}
      data-variant={variant}
    >
      {hasIcon ? (
        <span aria-hidden className={styles.icon}>
          {glyph}
        </span>
      ) : null}
      {children}
    </div>
  );
}

export type AlertTitleProps = ComponentProps<"div">;

export function AlertTitle({ className, ...props }: AlertTitleProps) {
  return <div {...props} className={cn(styles.title, className)} />;
}

export type AlertDescriptionProps = ComponentProps<"div">;

export function AlertDescription({
  className,
  ...props
}: AlertDescriptionProps) {
  return <div {...props} className={cn(styles.description, className)} />;
}

export type AlertActionsProps = ComponentProps<"div">;

export function AlertActions({ className, ...props }: AlertActionsProps) {
  return <div {...props} className={cn(styles.actions, className)} />;
}
