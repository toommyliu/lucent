import {
  Toast as BaseToast,
  type ToastManagerUpdateOptions,
} from "@base-ui/react/toast";
import type { MouseEvent, ReactNode } from "react";
import { Icon } from "../icon/Icon";
import { Button } from "../button/Button";
import { Spinner } from "../spinner/Spinner";
import styles from "./Toast.module.css";

const manager = BaseToast.createToastManager();

export type ToastType = "success" | "error" | "warning" | "info" | "loading";

export type ToastPlacement =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface ToastAction {
  readonly label: ReactNode;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

export interface ToastContent {
  readonly action?: ToastAction;
  readonly description?: ReactNode;
  readonly timeout?: number;
  readonly title: ReactNode;
}

export interface ToastOptions extends Omit<ToastContent, "title"> {
  readonly id?: string;
  readonly onClose?: () => void;
  readonly priority?: "low" | "high";
}

export interface ToastPromiseMessages<Value> {
  readonly error:
    | string
    | ToastContent
    | ((error: unknown) => string | ToastContent);
  readonly loading: string | ToastContent;
  readonly success:
    | string
    | ToastContent
    | ((value: Value) => string | ToastContent);
}

function toUpdate(
  content: string | ToastContent,
): ToastManagerUpdateOptions<object> {
  if (typeof content === "string") {
    return { actionProps: undefined, description: undefined, title: content };
  }
  return {
    actionProps:
      content.action === undefined
        ? undefined
        : { children: content.action.label, onClick: content.action.onClick },
    description: content.description,
    timeout: content.timeout,
    title: content.title,
  };
}

function show(
  type: ToastType | undefined,
  title: ReactNode,
  { id, onClose, priority, ...content }: ToastOptions = {},
): string {
  return manager.add({
    ...toUpdate({ ...content, title }),
    id,
    onClose,
    priority: priority ?? (type === "error" ? "high" : "low"),
    type,
  });
}

export function toast(title: ReactNode, options?: ToastOptions): string {
  return show(undefined, title, options);
}

toast.success = (title: ReactNode, options?: ToastOptions): string =>
  show("success", title, options);

toast.error = (title: ReactNode, options?: ToastOptions): string =>
  show("error", title, options);

toast.warning = (title: ReactNode, options?: ToastOptions): string =>
  show("warning", title, options);

toast.info = (title: ReactNode, options?: ToastOptions): string =>
  show("info", title, options);

toast.loading = (title: ReactNode, options?: ToastOptions): string =>
  show("loading", title, options);

toast.promise = <Value,>(
  promise: Promise<Value>,
  messages: ToastPromiseMessages<Value>,
): Promise<Value> =>
  manager.promise(promise, {
    error: (error: unknown) =>
      toUpdate(
        typeof messages.error === "function"
          ? messages.error(error)
          : messages.error,
      ),
    loading: toUpdate(messages.loading),
    success: (value: Value) =>
      toUpdate(
        typeof messages.success === "function"
          ? messages.success(value)
          : messages.success,
      ),
  });

toast.dismiss = (id?: string): void => {
  manager.close(id);
};

type SwipeDirection = "up" | "down" | "left" | "right";

function swipeDirections(placement: ToastPlacement): SwipeDirection[] {
  const vertical = placement.startsWith("top") ? "up" : "down";
  if (placement.endsWith("left")) {
    return ["left", vertical];
  }
  if (placement.endsWith("right")) {
    return ["right", vertical];
  }
  return [vertical];
}

function toastGlyph(type: string | undefined): ReactNode {
  switch (type) {
    case "success":
      return <Icon icon="circle_check" size="md" />;
    case "error":
      return <Icon icon="circle_alert" size="md" />;
    case "warning":
      return <Icon icon="triangle_alert" size="md" />;
    case "info":
      return <Icon icon="info" size="md" />;
    case "loading":
      return <Spinner />;
    default:
      return null;
  }
}

interface ToastItemProps {
  readonly swipeDirection: SwipeDirection[];
  readonly toast: BaseToast.Root.ToastObject;
}

function ToastItem({ swipeDirection, toast: item }: ToastItemProps) {
  const glyph = toastGlyph(item.type);
  return (
    <BaseToast.Root
      className={styles.root}
      swipeDirection={swipeDirection}
      toast={item}
    >
      <BaseToast.Content className={styles.content}>
        {glyph === null ? null : <span className={styles.icon}>{glyph}</span>}
        <div className={styles.text}>
          <BaseToast.Title className={styles.title} />
          <BaseToast.Description className={styles.description} />
        </div>
        <BaseToast.Action
          className={styles.action}
          onClick={() => {
            manager.close(item.id);
          }}
          render={<Button size="sm" />}
        />
        <BaseToast.Close
          aria-label="Dismiss"
          className={styles.close}
          render={<Button size="sm" square variant="ghost" />}
        >
          <Icon icon="x" size="md" />
        </BaseToast.Close>
      </BaseToast.Content>
    </BaseToast.Root>
  );
}

function ToastList({
  swipeDirection,
}: {
  readonly swipeDirection: SwipeDirection[];
}) {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((item) => (
    <ToastItem key={item.id} swipeDirection={swipeDirection} toast={item} />
  ));
}

export interface ToasterProps extends Pick<
  BaseToast.Provider.Props,
  "limit" | "timeout"
> {
  readonly placement?: ToastPlacement;
}

export function Toaster({
  placement = "bottom-right",
  ...props
}: ToasterProps) {
  return (
    <BaseToast.Provider {...props} toastManager={manager}>
      <BaseToast.Portal>
        <BaseToast.Viewport
          className={styles.viewport}
          data-placement={placement}
        >
          <ToastList swipeDirection={swipeDirections(placement)} />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}
