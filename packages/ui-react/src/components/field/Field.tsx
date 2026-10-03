import { Field as BaseField } from "@base-ui/react/field";
import { cn, type WithClassName } from "../../lib/cn";
import label from "../label/Label.module.css";
import styles from "./Field.module.css";

export type FieldProps = WithClassName<BaseField.Root.Props>;

export function Field({ className, ...props }: FieldProps) {
  return <BaseField.Root {...props} className={cn(styles.root, className)} />;
}

export type FieldLabelProps = WithClassName<BaseField.Label.Props>;

export function FieldLabel({ className, ...props }: FieldLabelProps) {
  return <BaseField.Label {...props} className={cn(label.root, className)} />;
}

export type FieldDescriptionProps = WithClassName<BaseField.Description.Props>;

export function FieldDescription({
  className,
  ...props
}: FieldDescriptionProps) {
  return (
    <BaseField.Description
      {...props}
      className={cn(styles.description, className)}
    />
  );
}

export type FieldErrorProps = WithClassName<BaseField.Error.Props>;

export function FieldError({ className, ...props }: FieldErrorProps) {
  return <BaseField.Error {...props} className={cn(styles.error, className)} />;
}

export const FieldValidity = BaseField.Validity;
export type FieldValidityProps = BaseField.Validity.Props;
