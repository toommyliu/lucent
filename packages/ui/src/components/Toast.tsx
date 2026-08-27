import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  splitProps,
  type JSX,
} from "solid-js";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";

const DEFAULT_DURATION = 5000;
const DEFAULT_TOAST_HEIGHT = 64;
const EXIT_CLEANUP_DELAY = 170;
const MAX_TOASTS = 4;
const TOAST_GAP = 12;

export type ToastVariant =
  | "default"
  | "error"
  | "info"
  | "loading"
  | "success"
  | "warning";

export type ToastPlacement =
  | "bottom-center"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "top-left"
  | "top-right";

export interface ToastAction {
  readonly label: string;
  readonly onClick: VoidFunction;
}

interface ToastContentOptions {
  readonly action?: ToastAction | undefined;
  readonly class?: string | undefined;
  readonly closable?: boolean | undefined;
  readonly description?: JSX.Element | undefined;
  readonly icon?: JSX.Element | null | undefined;
  readonly title?: JSX.Element | undefined;
  readonly variant?: ToastVariant | undefined;
}

export interface ToastProps
  extends
    Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "class" | "title">,
    ToastContentOptions {
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly open?: boolean | undefined;
}

export interface ToastOptions extends ToastContentOptions {
  /** Milliseconds before dismissal. `null` keeps the toast open. */
  readonly duration?: number | null | undefined;
  readonly id?: string | undefined;
}

export type ToastPromiseState<Value> =
  | string
  | Omit<ToastOptions, "id">
  | ((value: Value) => string | Omit<ToastOptions, "id">);

/** Messages shown while a promise is pending and after it settles. */
export interface ToastPromiseOptions<Value> {
  readonly error: ToastPromiseState<unknown>;
  readonly loading: string | Omit<ToastOptions, "variant">;
  readonly success: ToastPromiseState<Value>;
}

interface ProgrammaticToast {
  readonly action: ToastAction | undefined;
  readonly class: string | undefined;
  readonly closable: boolean;
  readonly description: JSX.Element;
  readonly duration: number | null;
  readonly exiting: boolean;
  readonly icon: JSX.Element | null | undefined;
  readonly id: string;
  readonly title: JSX.Element;
  readonly variant: ToastVariant;
}

export interface ToastApi {
  readonly create: (options: ToastOptions) => string;
  readonly dismiss: (id?: string) => void;
  readonly error: (options: Omit<ToastOptions, "variant">) => string;
  readonly info: (options: Omit<ToastOptions, "variant">) => string;
  readonly loading: (options: Omit<ToastOptions, "variant">) => string;
  readonly promise: <Value>(
    promise: PromiseLike<Value>,
    options: ToastPromiseOptions<Value>,
  ) => Promise<Value>;
  readonly success: (options: Omit<ToastOptions, "variant">) => string;
  readonly update: (id: string, options: Omit<ToastOptions, "id">) => void;
  readonly warning: (options: Omit<ToastOptions, "variant">) => string;
}

export interface ToasterProps extends Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  "class"
> {
  readonly class?: string | undefined;
  readonly placement?: ToastPlacement | undefined;
}

const [programmaticToasts, setProgrammaticToasts] = createSignal<
  readonly ProgrammaticToast[]
>([]);
let nextToastId = 1;

function defaultDuration(
  variant: ToastVariant,
  action: ToastAction | undefined,
): number | null {
  return variant === "error" || variant === "loading" || action !== undefined
    ? null
    : DEFAULT_DURATION;
}

function createToast(options: ToastOptions): string {
  const id = options.id ?? `toast-${nextToastId++}`;

  setProgrammaticToasts((current) => {
    const existing = current.find((item) => item.id === id);
    const variant = options.variant ?? existing?.variant ?? "default";
    const action = options.action ?? existing?.action;
    const duration =
      options.duration === undefined
        ? existing === undefined
          ? defaultDuration(variant, action)
          : existing.duration
        : options.duration;
    const toastItem: ProgrammaticToast = {
      action,
      class: options.class ?? existing?.class,
      closable: options.closable ?? existing?.closable ?? duration === null,
      description: options.description ?? existing?.description,
      duration,
      exiting: false,
      icon: options.icon === undefined ? existing?.icon : options.icon,
      id,
      title: options.title ?? existing?.title,
      variant,
    };

    return [toastItem, ...current.filter((item) => item.id !== id)].slice(
      0,
      MAX_TOASTS,
    );
  });

  return id;
}

function dismissToast(id?: string): void {
  setProgrammaticToasts((current) =>
    current.map((item) =>
      id === undefined || item.id === id ? { ...item, exiting: true } : item,
    ),
  );
}

function removeToast(id: string): void {
  setProgrammaticToasts((current) => current.filter((item) => item.id !== id));
}

function createVariantToast(
  variant: ToastVariant,
  options: Omit<ToastOptions, "variant">,
): string {
  return createToast({ ...options, variant });
}

function resolvePromiseState<Value>(
  state: ToastPromiseState<Value>,
  value: Value,
): Omit<ToastOptions, "id"> {
  const resolved = typeof state === "function" ? state(value) : state;
  return typeof resolved === "string" ? { description: resolved } : resolved;
}

function settlePromiseToast(
  id: string,
  options: Omit<ToastOptions, "id">,
  fallbackVariant: ToastVariant,
): void {
  setProgrammaticToasts((current) =>
    current.map((item) => {
      if (item.id !== id) return item;

      const variant = options.variant ?? fallbackVariant;
      const action = Object.hasOwn(options, "action")
        ? options.action
        : item.action;
      const duration =
        options.duration === undefined
          ? defaultDuration(variant, action)
          : options.duration;

      return {
        action,
        class: Object.hasOwn(options, "class") ? options.class : item.class,
        closable: options.closable ?? duration === null,
        description: Object.hasOwn(options, "description")
          ? options.description
          : item.description,
        duration,
        exiting: false,
        icon: Object.hasOwn(options, "icon") ? options.icon : item.icon,
        id,
        title: Object.hasOwn(options, "title") ? options.title : item.title,
        variant,
      };
    }),
  );
}

function createPromiseToast<Value>(
  promiseValue: PromiseLike<Value>,
  options: ToastPromiseOptions<Value>,
): Promise<Value> {
  const loadingOptions =
    typeof options.loading === "string"
      ? { description: options.loading }
      : options.loading;
  const id = createToast({
    ...loadingOptions,
    duration: null,
    variant: "loading",
  });

  return Promise.resolve(promiseValue)
    .then((value) => {
      settlePromiseToast(
        id,
        resolvePromiseState(options.success, value),
        "success",
      );
      return value;
    })
    .catch((cause: unknown) => {
      settlePromiseToast(
        id,
        resolvePromiseState(options.error, cause),
        "error",
      );
      throw cause;
    });
}

export const toast: ToastApi = {
  create: createToast,
  dismiss: dismissToast,
  error: (options) => createVariantToast("error", options),
  info: (options) => createVariantToast("info", options),
  loading: (options) => createVariantToast("loading", options),
  promise: createPromiseToast,
  success: (options) => createVariantToast("success", options),
  update: (id, options) => {
    createToast({ ...options, id });
  },
  warning: (options) => createVariantToast("warning", options),
};

function DefaultToastIcon(props: {
  readonly icon?: JSX.Element | null;
  readonly variant: ToastVariant;
}): JSX.Element {
  const icon = (): JSX.Element | null => {
    if (props.icon !== undefined) return props.icon;
    if (props.variant === "success") {
      return <Icon aria-hidden="true" icon="circle_check" />;
    }
    if (props.variant === "error") {
      return <Icon aria-hidden="true" icon="circle_alert" />;
    }
    if (props.variant === "info") {
      return <Icon aria-hidden="true" icon="info" />;
    }
    if (props.variant === "warning") {
      return <Icon aria-hidden="true" icon="triangle_alert" />;
    }
    if (props.variant === "loading") {
      return <Spinner aria-hidden="true" size="md" />;
    }
    return null;
  };

  return (
    <Show when={icon()}>
      {(toastIcon) => <div class="toast__icon">{toastIcon()}</div>}
    </Show>
  );
}

export function Toast(props: ToastProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "action",
    "class",
    "closable",
    "description",
    "icon",
    "onOpenChange",
    "open",
    "title",
    "variant",
  ]);
  const variant = () => local.variant ?? "default";
  const close = (): void => local.onOpenChange?.(false);

  return (
    <Show when={local.open ?? true}>
      <div
        {...rest}
        aria-atomic="true"
        aria-live={variant() === "error" ? "assertive" : "polite"}
        class={cn("toast toast--standalone", local.class)}
        data-slot="toast"
        data-type={variant()}
        role={variant() === "error" ? "alert" : "status"}
      >
        <div class="toast__content">
          <div class="toast__message">
            <DefaultToastIcon icon={local.icon} variant={variant()} />
            <div class="toast__body">
              <Show when={local.title}>
                {(title) => <div class="toast__title">{title()}</div>}
              </Show>
              <Show when={local.description}>
                {(description) => (
                  <div class="toast__description">{description()}</div>
                )}
              </Show>
            </div>
          </div>
          <Show when={local.action}>
            {(action) => (
              <button
                class="button button--default button--xs toast__action"
                onClick={() => {
                  action().onClick();
                  close();
                }}
                type="button"
              >
                <span class="button__content">{action().label}</span>
              </button>
            )}
          </Show>
          <Show when={local.closable}>
            <button
              aria-label="Dismiss notification"
              class="toast__close"
              onClick={close}
              type="button"
            >
              <Icon aria-hidden="true" icon="x" size="xs" />
            </button>
          </Show>
        </div>
      </div>
    </Show>
  );
}

interface ProgrammaticToastItemProps {
  readonly frontmostHeight: number;
  readonly id: string;
  readonly index: number;
  readonly offset: number;
  readonly onHeightChange: (id: string, height?: number) => void;
  readonly ownHeight: number;
}

function ProgrammaticToastItem(props: ProgrammaticToastItemProps): JSX.Element {
  let itemElement: HTMLDivElement | undefined;
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const item = createMemo(() =>
    programmaticToasts().find((candidate) => candidate.id === props.id),
  );

  createEffect(() => {
    const currentItem = item();

    if (dismissTimer !== undefined) {
      clearTimeout(dismissTimer);
      dismissTimer = undefined;
    }
    if (exitTimer !== undefined) {
      clearTimeout(exitTimer);
      exitTimer = undefined;
    }

    if (currentItem?.exiting === true) {
      exitTimer = setTimeout(() => removeToast(props.id), EXIT_CLEANUP_DELAY);
      return;
    }

    if (currentItem?.duration === undefined || currentItem.duration === null) {
      return;
    }

    dismissTimer = setTimeout(
      () => dismissToast(props.id),
      currentItem.duration,
    );
  });

  onMount(() => {
    const contentElement =
      itemElement?.querySelector<HTMLElement>(".toast__content") ?? undefined;
    const toastElement =
      contentElement?.closest<HTMLElement>(".toast") ?? undefined;
    const measure = (): void => {
      if (contentElement === undefined || toastElement === undefined) return;
      const styles = window.getComputedStyle(toastElement);
      const borderHeight =
        Number.parseFloat(styles.borderTopWidth) +
        Number.parseFloat(styles.borderBottomWidth);
      props.onHeightChange(
        props.id,
        Math.ceil(contentElement.offsetHeight + borderHeight),
      );
    };

    measure();
    if (contentElement !== undefined && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(contentElement);
    }
  });

  onCleanup(() => {
    if (dismissTimer !== undefined) clearTimeout(dismissTimer);
    if (exitTimer !== undefined) clearTimeout(exitTimer);
    resizeObserver?.disconnect();
    props.onHeightChange(props.id);
  });

  return (
    <div
      class="toaster__item"
      data-behind={props.index > 0 ? "" : undefined}
      data-exiting={item()?.exiting === true ? "" : undefined}
      ref={(element) => {
        itemElement = element;
      }}
      style={
        {
          "--toast-frontmost-height": `${props.frontmostHeight}px`,
          "--toast-height": `${props.ownHeight}px`,
          "--toast-index": props.index,
          "--toast-offset-y": `${props.offset}px`,
        } as JSX.CSSProperties
      }
    >
      <Show when={item()}>
        {(currentItem) => (
          <Toast
            action={currentItem().action}
            class={currentItem().class}
            closable={currentItem().closable}
            description={currentItem().description}
            icon={currentItem().icon}
            onOpenChange={() => dismissToast(props.id)}
            onTransitionEnd={(event) => {
              if (event.propertyName === "opacity" && currentItem().exiting) {
                removeToast(props.id);
              }
            }}
            title={currentItem().title}
            variant={currentItem().variant}
          />
        )}
      </Show>
    </div>
  );
}

/** Mount once near the app root to display programmatic toasts. */
export function Toaster(props: ToasterProps): JSX.Element {
  const [local, rest] = splitProps(props, ["class", "placement"]);
  const [expanded, setExpanded] = createSignal(false);
  const [toastHeights, setToastHeights] = createSignal<
    Readonly<Record<string, number>>
  >({});
  const placement = (): ToastPlacement => local.placement ?? "bottom-right";
  const heightFor = (id: string): number =>
    toastHeights()[id] ?? DEFAULT_TOAST_HEIGHT;
  const frontmostHeight = (): number => {
    const frontmostToast = programmaticToasts()[0];
    return frontmostToast === undefined ? 0 : heightFor(frontmostToast.id);
  };
  const offsetFor = (index: number): number =>
    programmaticToasts()
      .slice(0, index)
      .reduce((offset, item) => offset + heightFor(item.id) + TOAST_GAP, 0);
  const expandedHeight = (): number => {
    const items = programmaticToasts();
    if (items.length === 0) return 0;
    return (
      items.reduce((height, item) => height + heightFor(item.id), 0) +
      TOAST_GAP * (items.length - 1)
    );
  };
  const isExpanded = (): boolean =>
    expanded() && programmaticToasts().length > 1;
  const setToastHeight = (id: string, height?: number): void => {
    setToastHeights((current) => {
      if (height === undefined) {
        if (current[id] === undefined) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      if (current[id] === height) return current;
      return { ...current, [id]: height };
    });
  };

  return (
    <div
      {...rest}
      aria-label="Notifications"
      class={cn("toaster", `toaster--${placement()}`, local.class)}
      data-expanded={isExpanded() ? "" : undefined}
      data-slot="toaster"
      onFocusIn={() => setExpanded(true)}
      onFocusOut={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          !(
            nextTarget instanceof Node &&
            event.currentTarget.contains(nextTarget)
          ) &&
          !event.currentTarget.matches(":hover")
        ) {
          setExpanded(false);
        }
      }}
      onPointerEnter={() => setExpanded(true)}
      onPointerLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) {
          setExpanded(false);
        }
      }}
      role="region"
      tabIndex={programmaticToasts().length > 1 ? 0 : undefined}
    >
      <div
        class="toaster__stack"
        style={{
          height: `${isExpanded() ? expandedHeight() : frontmostHeight()}px`,
        }}
      >
        <For each={programmaticToasts().map((item) => item.id)}>
          {(id, index) => (
            <ProgrammaticToastItem
              frontmostHeight={frontmostHeight()}
              id={id}
              index={index()}
              offset={offsetFor(index())}
              onHeightChange={setToastHeight}
              ownHeight={heightFor(id)}
            />
          )}
        </For>
      </div>
    </div>
  );
}
