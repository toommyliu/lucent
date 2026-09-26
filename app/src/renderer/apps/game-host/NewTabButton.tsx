import type { RecentlyClosedGameSession } from "@lucent/core/accounts";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuTrigger,
  Icon,
  TooltipIconButton,
} from "@lucent/ui";
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";

import type { DesktopGameViewHostBridge } from "../../../shared/desktopBridge";

interface NewTabButtonProps {
  readonly atCapacity: boolean;
  readonly pending: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAdd: () => void;
  readonly onReopen: (id: number) => void;
  readonly getRecentlyClosed: DesktopGameViewHostBridge["getRecentlyClosed"];
}

type HistoryState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | {
      readonly status: "ready";
      readonly entries: readonly RecentlyClosedGameSession[];
    };

export function NewTabButton(props: NewTabButtonProps): JSX.Element {
  const [history, setHistory] = createSignal<HistoryState>({
    status: "loading",
  });
  const [reload, setReload] = createSignal(0);

  createEffect(() => {
    reload();
    if (!props.open) return;
    let disposed = false;
    setHistory({ status: "loading" });
    void props.getRecentlyClosed().then(
      (entries) => {
        if (!disposed) setHistory({ status: "ready", entries });
      },
      () => {
        if (!disposed) setHistory({ status: "error" });
      },
    );
    onCleanup(() => {
      disposed = true;
    });
  });

  const handleKeyDown: JSX.EventHandler<HTMLButtonElement, KeyboardEvent> = (
    event,
  ) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
      return;
    event.preventDefault();
    props.onOpenChange(true);
  };

  const entries = () => {
    const current = history();
    return current.status === "ready" ? current.entries : [];
  };

  return (
    <Menu
      aria-label="Recently closed"
      open={props.open}
      positioning={{
        fitViewport: true,
        overflowPadding: 4,
        placement: "bottom-start",
      }}
      unmountOnExit
      onOpenChange={(details) => props.onOpenChange(details.open)}
    >
      <MenuTrigger
        asChild={(triggerProps) => (
          <TooltipIconButton
            {...triggerProps({
              "aria-label": "New tab",
              "aria-busy": props.pending,
              "aria-disabled": props.atCapacity || props.pending,
              "aria-haspopup": "menu",
              "aria-expanded": props.open,
              type: "button",
            })}
            aria-label="New tab"
            onClick={() => {
              if (!props.pending && !props.atCapacity) props.onAdd();
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              props.onOpenChange(true);
            }}
            onKeyDown={handleKeyDown}
            class="game-view-tabs__action game-view-tabs__add"
            size="icon-sm"
            variant="ghost"
            data-at-capacity={props.atCapacity ? "" : undefined}
            open={props.open ? false : undefined}
            positioning={{
              fitViewport: true,
              overflowPadding: 4,
              placement: "left",
            }}
            tooltip={props.atCapacity ? "Tab limit reached" : "New tab"}
          >
            <Icon aria-hidden="true" icon="plus" size="sm" />
          </TooltipIconButton>
        )}
      />
      <MenuContent class="game-view-tabs__recent-menu">
        <MenuGroup id="recently-closed-tabs">
          <MenuLabel>Recently closed</MenuLabel>
          <Show when={props.atCapacity}>
            <p class="game-view-tabs__menu-note">Close a tab to reopen one.</p>
          </Show>
          <Show when={history().status === "loading"}>
            <p class="game-view-tabs__menu-note" role="status">
              Loading tabs...
            </p>
          </Show>
          <Show when={history().status === "error"}>
            <p class="game-view-tabs__menu-note" role="alert">
              Unable to load recently closed tabs.
            </p>
            <MenuItem
              closeOnSelect={false}
              value="retry"
              onSelect={() => setReload((value) => value + 1)}
            >
              Try again
            </MenuItem>
          </Show>
          <Show when={history().status === "ready"}>
            <For
              each={entries()}
              fallback={
                <p class="game-view-tabs__menu-note">No recently closed tabs</p>
              }
            >
              {(entry) => (
                <MenuItem
                  disabled={props.atCapacity || props.pending}
                  onSelect={() => {
                    if (!props.atCapacity && !props.pending)
                      props.onReopen(entry.id);
                  }}
                  value={String(entry.id)}
                >
                  <span
                    class="game-view-tabs__menu-item-label"
                    title={entry.username}
                  >
                    {entry.username}
                  </span>
                </MenuItem>
              )}
            </For>
          </Show>
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}
