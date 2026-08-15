import {
  createEffect,
  createSignal,
  onCleanup,
  splitProps,
  type JSX,
} from "solid-js";
import { Spinner } from "./Spinner";
import { cn } from "../lib/cn";

const loadingIndicatorDelayMs = 200;

export type ButtonVariant =
  | "default"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "destructive-outline"
  | "link";

export type ButtonSize =
  | "xs"
  | "sm"
  | "default"
  | "lg"
  | "xl"
  | "icon-xs"
  | "icon-sm"
  | "icon"
  | "icon-lg"
  | "icon-xl";

export interface ButtonProps extends Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  "class"
> {
  readonly as?: "button" | "a";
  readonly class?: string;
  readonly href?: string;
  readonly loading?: boolean;
  readonly pending?: boolean;
  readonly size?: ButtonSize;
  readonly variant?: ButtonVariant;
}

export function Button(props: ButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "as",
    "aria-busy",
    "children",
    "class",
    "disabled",
    "href",
    "loading",
    "onClick",
    "pending",
    "size",
    "tabIndex",
    "type",
    "variant",
  ]);
  const [loadingIndicatorVisible, setLoadingIndicatorVisible] =
    createSignal(false);

  createEffect(() => {
    if (!local.loading) {
      setLoadingIndicatorVisible(false);
      return;
    }

    const timer = window.setTimeout(
      () => setLoadingIndicatorVisible(true),
      loadingIndicatorDelayMs,
    );
    onCleanup(() => window.clearTimeout(timer));
  });

  const variant = () => local.variant ?? "default";
  const size = () => local.size ?? "default";
  const sizeClass = () =>
    size() === "default" ? "button--size-default" : `button--${size()}`;
  const busy = () => Boolean(local.loading || local.pending);
  const disabled = () => Boolean(local.disabled || busy());
  const className = () =>
    cn(
      "button",
      `button--${variant()}`,
      sizeClass(),
      loadingIndicatorVisible() && "button--loading",
      disabled() && "button--disabled",
      local.class,
    );
  const children = () => (
    <>
      <span class="button__content">{local.children}</span>
      {loadingIndicatorVisible() && (
        <Spinner class="button__spinner" size="sm" />
      )}
    </>
  );

  if (local.as === "a") {
    return (
      <a
        {...(rest as JSX.AnchorHTMLAttributes<HTMLAnchorElement>)}
        aria-busy={busy() ? "true" : local["aria-busy"]}
        aria-disabled={disabled() ? "true" : undefined}
        class={className()}
        data-loading={local.loading ? "" : undefined}
        data-slot="button"
        href={disabled() ? undefined : local.href}
        onClick={(event) => {
          if (disabled()) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (typeof local.onClick === "function") {
            (
              local.onClick as unknown as JSX.EventHandler<
                HTMLAnchorElement,
                MouseEvent
              >
            )(event);
          }
        }}
        tabIndex={disabled() ? -1 : local.tabIndex}
      >
        {children()}
      </a>
    );
  }

  return (
    <button
      {...rest}
      aria-busy={busy() ? "true" : local["aria-busy"]}
      class={className()}
      data-loading={local.loading ? "" : undefined}
      data-slot="button"
      disabled={disabled()}
      onClick={(event) => {
        if (typeof local.onClick === "function") {
          (local.onClick as JSX.EventHandler<HTMLButtonElement, MouseEvent>)(
            event,
          );
        }
      }}
      tabIndex={local.tabIndex}
      type={local.type ?? "button"}
    >
      {children()}
    </button>
  );
}
