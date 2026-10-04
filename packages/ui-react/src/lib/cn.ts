export { clsx as cn } from "clsx";

export type WithClassName<Props> = Omit<Props, "className"> & {
  readonly className?: string | undefined;
};
