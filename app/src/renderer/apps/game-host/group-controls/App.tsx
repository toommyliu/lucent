import {
  Button,
  Card,
  CardAction,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
  Icon,
  IconButton,
  Input,
  Label,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  Switch,
  type ButtonProps,
  type IconButtonProps,
} from "@lucent/ui";
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";

import { selectDesktopBridge } from "../../../../shared/desktopBridge";
import type {
  GameViewGroupCommandDispatchResult,
  GameViewGroupCommandRequest,
  GameViewGroupOption,
  GameViewGroupRenderingMode,
  GameViewHostState,
} from "../../../../shared/gameViews";

interface GroupOptionDefinition {
  readonly label: string;
  readonly option: GameViewGroupOption;
}

interface RenderingModeDefinition {
  readonly label: string;
  readonly mode: GameViewGroupRenderingMode;
}

type GroupOptionState = Readonly<Record<GameViewGroupOption, boolean>>;

const gameViewHost = selectDesktopBridge(
  window.desktop,
  "game-group-controls",
).gameViewHost;

const primaryGroupOptions: readonly GroupOptionDefinition[] = [
  {
    label: "Infinite Range",
    option: "infinite-range",
  },
  {
    label: "Enemy Magnet",
    option: "enemy-magnet",
  },
  {
    label: "Provoke Cell",
    option: "provoke-cell",
  },
  {
    label: "Anti-Counter",
    option: "anti-counter",
  },
  {
    label: "Skip Cutscenes",
    option: "skip-cutscenes",
  },
] as const;

const moreGroupOptions: readonly GroupOptionDefinition[] = [
  {
    label: "Collisions",
    option: "collisions",
  },
  {
    label: "Death Ads",
    option: "death-ads",
  },
  {
    label: "Hide Players",
    option: "hide-players",
  },
  {
    label: "Animations",
    option: "animations",
  },
] as const;

const groupOptions: readonly GroupOptionDefinition[] = [
  ...primaryGroupOptions,
  ...moreGroupOptions,
];

const renderingModes: readonly RenderingModeDefinition[] = [
  { label: "Full", mode: "full" },
  { label: "Interface Only", mode: "interface-only" },
  { label: "Minimal", mode: "minimal" },
] as const;

const defaultRenderingMode = "minimal" satisfies GameViewGroupRenderingMode;

const initialOptionState: GroupOptionState = {
  animations: false,
  "anti-counter": false,
  collisions: false,
  "death-ads": false,
  "enemy-magnet": false,
  "hide-players": false,
  "infinite-range": false,
  "provoke-cell": false,
  "skip-cutscenes": false,
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message.trim() !== ""
    ? cause.message
    : "Group action failed.";

const commandLabel = (command: GameViewGroupCommandRequest): string => {
  switch (command.kind) {
    case "start-scripts":
      return "Start";
    case "stop-scripts":
      return "Stop";
    case "load-script":
      return "Load";
    case "login":
      return "Log in";
    case "logout":
      return "Log out";
    case "join-location":
      return "Travel";
    case "go-to-player":
      return "Jump";
    case "set-rendering-mode":
      return (
        renderingModes.find((mode) => mode.mode === command.mode)?.label ??
        "Rendering"
      );
    case "set-option":
      return (
        groupOptions.find((definition) => definition.option === command.option)
          ?.label ?? "Options"
      );
  }
};

const resultMessage = (
  command: GameViewGroupCommandRequest,
  result: GameViewGroupCommandDispatchResult,
): string => {
  if (result.status === "canceled") return "Script selection canceled.";
  if (result.recipientCount === 0) return "No selected tabs are ready.";

  const tabs = `${result.recipientCount} ${result.recipientCount === 1 ? "tab" : "tabs"}`;
  const skipped =
    result.skippedCount === 0
      ? ""
      : ` ${result.skippedCount} ${result.skippedCount === 1 ? "tab is" : "tabs are"} not ready.`;
  if (command.kind === "login") {
    return `Login queued for ${tabs}.${skipped}`;
  }
  return `${commandLabel(command)} sent to ${tabs}.${skipped}`;
};

export function App(): JSX.Element {
  const [hostState, setHostState] = createSignal<GameViewHostState | null>(
    null,
  );
  const [pendingKeys, setPendingKeys] = createSignal<ReadonlySet<string>>(
    new Set(),
  );
  const [status, setStatus] = createSignal("Ready.");
  const [map, setMap] = createSignal("");
  const [cell, setCell] = createSignal("");
  const [pad, setPad] = createSignal("");
  const [player, setPlayer] = createSignal("");
  const [renderingMode, setRenderingMode] =
    createSignal<GameViewGroupRenderingMode>(defaultRenderingMode);
  const [options, setOptions] =
    createSignal<GroupOptionState>(initialOptionState);
  let closeButton: HTMLButtonElement | undefined;
  let focusFrame: number | undefined;

  const sessions = createMemo(() => hostState()?.sessions ?? []);
  const selectedTargetIds = createMemo(
    () => new Set(hostState()?.groupTargetIds ?? []),
  );
  const selectedCount = createMemo(
    () => hostState()?.groupTargetIds.length ?? 0,
  );
  const selectedNames = createMemo(() =>
    sessions()
      .filter((session) => selectedTargetIds().has(session.id))
      .map((session) => session.name),
  );
  const selectedTabsTitle = createMemo(() => {
    const names = selectedNames();
    return names.length === 0 ? undefined : names.join(", ");
  });
  const selectedReadyCount = createMemo(
    () =>
      sessions().filter(
        (session) =>
          selectedTargetIds().has(session.id) && session.phase === "ready",
      ).length,
  );
  const ready = () => selectedReadyCount() > 0;
  const pending = (key: string): boolean => pendingKeys().has(key);
  const optionPending = (option: GameViewGroupOption): boolean =>
    pending(`option:${option}`);
  const renderingModeLabel = (): string =>
    renderingModes.find((definition) => definition.mode === renderingMode())
      ?.label ?? "Minimal";
  const renderingPending = (): boolean =>
    renderingModes.some((definition) =>
      pending(`rendering:${definition.mode}`),
    );

  const applyHostState = (nextState: GameViewHostState): void => {
    const opening =
      nextState.groupControlsOpen && !hostState()?.groupControlsOpen;
    setHostState(nextState);
    if (!opening) return;

    if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame);
    focusFrame = window.requestAnimationFrame(() => {
      focusFrame = undefined;
      closeButton?.focus({ preventScroll: true });
    });
  };

  const setPending = (key: string, value: boolean): void => {
    setPendingKeys((current) => {
      if (current.has(key) === value) return current;
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const dispatch = async (
    key: string,
    command: GameViewGroupCommandRequest,
  ): Promise<boolean> => {
    if (selectedCount() === 0) {
      setStatus("Select at least one tab above.");
      return false;
    }
    if (!ready() || pending(key)) return false;

    setPending(key, true);
    try {
      const result = await gameViewHost.dispatchGroupCommand({
        command,
        targetIds: [...(hostState()?.groupTargetIds ?? [])],
      });
      setStatus(resultMessage(command, result));
      return result.status === "sent" && result.recipientCount > 0;
    } catch (cause) {
      setStatus(errorMessage(cause));
      return false;
    } finally {
      setPending(key, false);
    }
  };

  const close = (): void => {
    void gameViewHost.setGroupControlsOpen(false).catch((cause: unknown) => {
      setStatus(errorMessage(cause));
    });
  };

  const submitLocation: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (
    event,
  ) => {
    event.preventDefault();
    const target = {
      cell: cell().trim(),
      map: map().trim(),
      pad: pad().trim(),
    };
    if (target.map === "" && target.cell === "" && target.pad === "") {
      setStatus("Enter a map, cell, or pad.");
      return;
    }
    void dispatch("join-location", { kind: "join-location", ...target });
  };

  const submitPlayer: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (
    event,
  ) => {
    event.preventDefault();
    const target = player().trim();
    if (target === "") {
      setStatus("Enter a player name.");
      return;
    }
    void dispatch("go-to-player", {
      kind: "go-to-player",
      player: target,
    });
  };

  const setOption = async (
    option: GameViewGroupOption,
    enabled: boolean,
  ): Promise<void> => {
    if (optionPending(option)) return;
    const previousEnabled = options()[option];
    if (previousEnabled === enabled) return;
    setOptions(
      (current) =>
        ({ ...current, [option]: enabled }) satisfies GroupOptionState,
    );
    const applied = await dispatch(`option:${option}`, {
      enabled,
      kind: "set-option",
      option,
    });
    if (!applied) {
      setOptions((current) =>
        current[option] === enabled
          ? ({
              ...current,
              [option]: previousEnabled,
            } satisfies GroupOptionState)
          : current,
      );
    }
  };

  const toggleOption = (option: GameViewGroupOption): Promise<void> =>
    setOption(option, !options()[option]);

  const applyRenderingMode = (mode: GameViewGroupRenderingMode): void => {
    setRenderingMode(mode);
    void dispatch(`rendering:${mode}`, {
      kind: "set-rendering-mode",
      mode,
    });
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    close();
  };

  onMount(() => {
    let disposed = false;
    const unsubscribe = gameViewHost.onChanged((state) => {
      if (!disposed) applyHostState(state);
    });
    window.addEventListener("keydown", handleKeyDown);
    void gameViewHost
      .getState()
      .then((state) => {
        if (!disposed) applyHostState(state);
      })
      .catch((cause: unknown) => {
        if (!disposed) setStatus(errorMessage(cause));
      });

    onCleanup(() => {
      disposed = true;
      if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame);
      unsubscribe();
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <main
      aria-hidden={hostState()?.groupControlsOpen ? undefined : "true"}
      class="group-controls"
    >
      <Show when={hostState()?.groupControlsOpen}>
        <Card
          aria-labelledby="group-controls-title"
          class="group-controls__surface"
          role="dialog"
        >
          <CardHeader class="group-controls__header">
            <CardTitle aria-level="1" id="group-controls-title">
              <span>Group controls</span>
              <span
                class="group-controls__selection-count"
                title={selectedTabsTitle()}
              >
                {selectedCount()} {selectedCount() === 1 ? "tab" : "tabs"}{" "}
                selected
              </span>
            </CardTitle>
            <CardAction>
              <IconButton
                aria-label="Close group controls"
                onClick={close}
                ref={(element) => {
                  closeButton = element;
                }}
                size="icon-sm"
                title="Close"
                variant="ghost"
              >
                <Icon aria-hidden="true" icon="x" size="sm" />
              </IconButton>
            </CardAction>
          </CardHeader>

          <CardPanel class="group-controls__body">
            <section class="group-controls__section">
              <h2>Scripts</h2>
              <div class="group-controls__actions">
                <Button
                  disabled={!ready()}
                  pending={pending("start-scripts")}
                  onClick={() =>
                    void dispatch("start-scripts", { kind: "start-scripts" })
                  }
                  size="sm"
                >
                  Start
                </Button>
                <Button
                  disabled={!ready()}
                  pending={pending("stop-scripts")}
                  onClick={() =>
                    void dispatch("stop-scripts", { kind: "stop-scripts" })
                  }
                  size="sm"
                  variant="secondary"
                >
                  Stop
                </Button>
                <Button
                  disabled={!ready()}
                  pending={pending("load-script")}
                  onClick={() =>
                    void dispatch("load-script", { kind: "load-script" })
                  }
                  size="sm"
                  variant="outline"
                >
                  Load…
                </Button>
              </div>
            </section>

            <section class="group-controls__section">
              <div class="group-controls__section-heading">
                <h2>Accounts</h2>
              </div>
              <div class="group-controls__actions group-controls__actions--two">
                <Button
                  disabled={!ready()}
                  pending={pending("login")}
                  onClick={() => void dispatch("login", { kind: "login" })}
                  size="sm"
                  variant="secondary"
                >
                  Log in
                </Button>
                <Button
                  disabled={!ready()}
                  pending={pending("logout")}
                  onClick={() => void dispatch("logout", { kind: "logout" })}
                  size="sm"
                  variant="outline"
                >
                  Log out
                </Button>
              </div>
            </section>

            <section class="group-controls__section group-controls__section--stacked">
              <h2>Travel</h2>
              <form class="group-controls__location" onSubmit={submitLocation}>
                <Label>
                  Map
                  <Input
                    autocomplete="off"
                    fullWidth
                    name="map"
                    onInput={(event) => setMap(event.currentTarget.value)}
                    placeholder="yulgar-1234"
                    size="sm"
                    spellcheck={false}
                    value={map()}
                  />
                </Label>
                <Label>
                  Cell
                  <Input
                    autocomplete="off"
                    fullWidth
                    name="cell"
                    onInput={(event) => setCell(event.currentTarget.value)}
                    placeholder="Enter"
                    size="sm"
                    spellcheck={false}
                    value={cell()}
                  />
                </Label>
                <Label>
                  Pad
                  <Input
                    autocomplete="off"
                    fullWidth
                    name="pad"
                    onInput={(event) => setPad(event.currentTarget.value)}
                    placeholder="Spawn"
                    size="sm"
                    spellcheck={false}
                    value={pad()}
                  />
                </Label>
                <Button
                  aria-label="Send selected clients to this location"
                  disabled={!ready()}
                  pending={pending("join-location")}
                  size="icon-sm"
                  title="Go to location"
                  type="submit"
                >
                  <Icon
                    aria-hidden="true"
                    class="group-controls__travel-icon"
                    icon="arrow_up_right"
                    size="sm"
                  />
                </Button>
              </form>
              <form class="group-controls__player" onSubmit={submitPlayer}>
                <Label>
                  Player
                  <Input
                    autocomplete="off"
                    fullWidth
                    name="player"
                    onInput={(event) => setPlayer(event.currentTarget.value)}
                    placeholder="Artix"
                    size="sm"
                    spellcheck={false}
                    value={player()}
                  />
                </Label>
                <Button
                  disabled={!ready()}
                  pending={pending("go-to-player")}
                  size="sm"
                  type="submit"
                  variant="secondary"
                >
                  Jump to player
                </Button>
              </form>
            </section>

            <section class="group-controls__section group-controls__section--options group-controls__section--stacked">
              <div class="group-controls__options-heading">
                <h2>Options</h2>
                <Menu
                  positioning={{
                    fitViewport: true,
                    overflowPadding: 8,
                    placement: "top-end",
                  }}
                  unmountOnExit
                >
                  <MenuTrigger
                    asChild={(triggerProps) => (
                      <Button
                        {...(triggerProps({
                          "aria-label": "More options",
                          class: "group-controls__more-options-trigger",
                          disabled: !ready(),
                          size: "xs",
                          type: "button",
                          variant: "ghost",
                        } as ButtonProps) as ButtonProps)}
                      >
                        More
                        <Icon
                          aria-hidden="true"
                          class="group-controls__more-options-chevron"
                          icon="chevron_down"
                          size="xs"
                        />
                      </Button>
                    )}
                  />
                  <MenuContent class="group-controls__more-options-menu">
                    <For each={moreGroupOptions}>
                      {(definition) => (
                        <MenuCheckboxItem
                          aria-busy={
                            optionPending(definition.option)
                              ? "true"
                              : undefined
                          }
                          checked={options()[definition.option]}
                          closeOnSelect={false}
                          disabled={!ready()}
                          onCheckedChange={(checked) =>
                            void setOption(definition.option, checked)
                          }
                          value={definition.option}
                        >
                          {definition.label}
                        </MenuCheckboxItem>
                      )}
                    </For>
                  </MenuContent>
                </Menu>
              </div>
              <div class="group-controls__options">
                <div class="group-controls__rendering-option">
                  <span
                    class="group-controls__rendering-label"
                    id="group-controls-rendering"
                  >
                    Rendering mode
                  </span>
                  <div
                    aria-labelledby="group-controls-rendering"
                    class="group-controls__rendering-control"
                    role="group"
                  >
                    <Button
                      aria-label={`Apply ${renderingModeLabel()} rendering to selected tabs`}
                      class="group-controls__rendering-apply"
                      disabled={!ready() || renderingPending()}
                      pending={pending(`rendering:${renderingMode()}`)}
                      onClick={() => applyRenderingMode(renderingMode())}
                      size="sm"
                      variant="secondary"
                    >
                      {renderingModeLabel()}
                    </Button>
                    <Menu
                      positioning={{
                        fitViewport: true,
                        overflowPadding: 8,
                        placement: "bottom-end",
                      }}
                      unmountOnExit
                    >
                      <MenuTrigger
                        asChild={(triggerProps) => (
                          <IconButton
                            {...(triggerProps({
                              "aria-label": `Choose rendering mode, currently ${renderingModeLabel()}`,
                              class: "group-controls__rendering-trigger",
                              disabled: !ready() || renderingPending(),
                              size: "icon-sm",
                              type: "button",
                              variant: "secondary",
                            } as IconButtonProps) as IconButtonProps)}
                          >
                            <Icon
                              aria-hidden="true"
                              class="group-controls__rendering-chevron"
                              icon="chevron_down"
                              size="sm"
                            />
                          </IconButton>
                        )}
                      />
                      <MenuContent class="group-controls__rendering-menu">
                        <MenuRadioGroup
                          aria-label="Rendering mode"
                          value={renderingMode()}
                          onValueChange={(details) => {
                            const selected = renderingModes.find(
                              (definition) => definition.mode === details.value,
                            );
                            if (selected !== undefined) {
                              applyRenderingMode(selected.mode);
                            }
                          }}
                        >
                          <For each={renderingModes}>
                            {(definition) => (
                              <MenuRadioItem
                                disabled={!ready() || renderingPending()}
                                value={definition.mode}
                              >
                                {definition.label}
                              </MenuRadioItem>
                            )}
                          </For>
                        </MenuRadioGroup>
                      </MenuContent>
                    </Menu>
                  </div>
                </div>
                <For each={primaryGroupOptions}>
                  {(definition) => (
                    <Switch
                      aria-busy={
                        optionPending(definition.option) ? "true" : undefined
                      }
                      checked={options()[definition.option]}
                      class="group-controls__primary-option"
                      disabled={!ready()}
                      onClick={(event) => {
                        if (optionPending(definition.option)) {
                          event.preventDefault();
                        }
                      }}
                      onInput={() => {
                        if (!optionPending(definition.option)) {
                          void toggleOption(definition.option);
                        }
                      }}
                      size="sm"
                    >
                      <span class="group-controls__option-copy">
                        <strong>{definition.label}</strong>
                      </span>
                    </Switch>
                  )}
                </For>
              </div>
            </section>
          </CardPanel>

          <CardFooter class="group-controls__footer">
            <span aria-live="polite" role="status">
              {status()}
            </span>
          </CardFooter>
        </Card>
      </Show>
    </main>
  );
}
