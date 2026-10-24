import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";
import { Icon } from "../icon/Icon";
import { cn, type WithClassName } from "../../lib/cn";
import { Button } from "../button/Button";
import styles from "./Dialog.module.css";

export const Dialog = BaseDialog.Root;
export type DialogProps = BaseDialog.Root.Props;

export const DialogTrigger = BaseDialog.Trigger;
export type DialogTriggerProps = BaseDialog.Trigger.Props;

export const DialogClose = BaseDialog.Close;
export type DialogCloseProps = BaseDialog.Close.Props;

export type DialogSize = "sm" | "md" | "lg";

export interface DialogContentProps extends WithClassName<BaseDialog.Popup.Props> {
  readonly closeLabel?: string;
  readonly showCloseButton?: boolean;
  readonly size?: DialogSize;
}

export function DialogContent({
  children,
  className,
  closeLabel = "Close",
  showCloseButton = true,
  size = "md",
  ...props
}: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={styles.backdrop} />
      <BaseDialog.Viewport className={styles.viewport}>
        <BaseDialog.Popup
          {...props}
          className={cn(styles.popup, className)}
          data-size={size}
        >
          {children}
          {showCloseButton ? (
            <BaseDialog.Close
              render={
                <Button
                  aria-label={closeLabel}
                  className={styles.close}
                  size="sm"
                  square
                  variant="ghost"
                />
              }
            >
              <Icon icon="x" size="md" />
            </BaseDialog.Close>
          ) : null}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  );
}

export type DialogHeaderProps = ComponentProps<"div">;

export function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return <div {...props} className={cn(styles.header, className)} />;
}

export type DialogTitleProps = WithClassName<BaseDialog.Title.Props>;

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <BaseDialog.Title {...props} className={cn(styles.title, className)} />
  );
}

export type DialogDescriptionProps =
  WithClassName<BaseDialog.Description.Props>;

export function DialogDescription({
  className,
  ...props
}: DialogDescriptionProps) {
  return (
    <BaseDialog.Description
      {...props}
      className={cn(styles.description, className)}
    />
  );
}

export type DialogBodyProps = ComponentProps<"div">;

export function DialogBody({ className, ...props }: DialogBodyProps) {
  return <div {...props} className={cn(styles.body, className)} />;
}

export type DialogFooterProps = ComponentProps<"div">;

export function DialogFooter({ className, ...props }: DialogFooterProps) {
  return <div {...props} className={cn(styles.footer, className)} />;
}
