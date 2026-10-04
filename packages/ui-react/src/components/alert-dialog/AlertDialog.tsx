import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { cn, type WithClassName } from "../../lib/cn";
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogBodyProps,
  type DialogDescriptionProps,
  type DialogFooterProps,
  type DialogHeaderProps,
  type DialogSize,
  type DialogTitleProps,
} from "../dialog/Dialog";
import styles from "../dialog/Dialog.module.css";

export const AlertDialog = BaseAlertDialog.Root;
export type AlertDialogProps = BaseAlertDialog.Root.Props;

export const AlertDialogTrigger = BaseAlertDialog.Trigger;
export type AlertDialogTriggerProps = BaseAlertDialog.Trigger.Props;

export const AlertDialogClose = BaseAlertDialog.Close;
export type AlertDialogCloseProps = BaseAlertDialog.Close.Props;

export type AlertDialogSize = DialogSize;

export interface AlertDialogContentProps extends WithClassName<BaseAlertDialog.Popup.Props> {
  readonly size?: AlertDialogSize;
}

export function AlertDialogContent({
  className,
  size = "sm",
  ...props
}: AlertDialogContentProps) {
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop className={styles.backdrop} />
      <BaseAlertDialog.Viewport className={styles.viewport}>
        <BaseAlertDialog.Popup
          {...props}
          className={cn(styles.popup, className)}
          data-size={size}
        />
      </BaseAlertDialog.Viewport>
    </BaseAlertDialog.Portal>
  );
}

export const AlertDialogHeader = DialogHeader;
export type AlertDialogHeaderProps = DialogHeaderProps;

export const AlertDialogTitle = DialogTitle;
export type AlertDialogTitleProps = DialogTitleProps;

export const AlertDialogDescription = DialogDescription;
export type AlertDialogDescriptionProps = DialogDescriptionProps;

export const AlertDialogBody = DialogBody;
export type AlertDialogBodyProps = DialogBodyProps;

export const AlertDialogFooter = DialogFooter;
export type AlertDialogFooterProps = DialogFooterProps;
