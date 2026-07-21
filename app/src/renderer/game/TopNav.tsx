import {
  Button,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Kbd,
  Label,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Slider,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  type ButtonProps,
  type MenuCheckboxItemProps,
  type MenuContentProps,
  type MenuSubContentProps,
} from "@lucent/ui";
import {
  createSignal,
  For,
  Show,
  splitProps,
  type Accessor,
  type JSX,
  type Setter,
} from "solid-js";
import { Portal } from "solid-js/web";

import type { AppPlatform } from "../../shared/desktopBridge";
import {
  formatHotkeyDisplay,
  readHotkeyBinding,
  type HotkeyBinding,
  type SettingsCommandId,
} from "@lucent/core/hotkeys";
import {
  AUTO_ZONE_MAP_OPTIONS,
  type AutoZoneSupportedMap,
} from "./automation/AutoZone";

export type GameTopNavMenu =
  | "windows"
  | "scripts"
  | "options"
  | "combat"
  | "autozone"
  | "relogin"
  | "pads"
  | "cells";
export type WindowId =
  | "environment"
  | "fast-travels"
  | "loader-grabber"
  | "follower"
  | "packets"
  | "account-manager"
  | "combat-profiles";

export interface TopNavCombatProfile {
  readonly className?: string;
  readonly id: string;
  readonly label: string;
}

export interface TopNavOptionItem {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

export interface TopNavOptionsMenuContentProps {
  readonly hotkeyBindings: Accessor<readonly HotkeyBinding[]>;
  readonly hotkeyPlatform: AppPlatform;
  readonly gameLoaded: Accessor<boolean>;
  readonly playerReady: Accessor<boolean>;
  readonly optionItems: Accessor<readonly TopNavOptionItem[]>;
  readonly walkSpeed: Accessor<string>;
  readonly setWalkSpeed: Setter<string>;
  readonly handleSetWalkSpeed: (walkSpeed: number) => void;
  readonly frameRate: Accessor<string>;
  readonly setFrameRate: Setter<string>;
  readonly handleSetFrameRate: (frameRate: number) => void;
  readonly customName: Accessor<string>;
  readonly customNameConfigured: Accessor<boolean>;
  readonly setCustomName: Setter<string>;
  readonly handleSetCustomName: () => void;
  readonly handleResetCustomName: () => void;
  readonly customGuild: Accessor<string>;
  readonly customGuildConfigured: Accessor<boolean>;
  readonly setCustomGuild: Setter<string>;
  readonly handleSetCustomGuild: () => void;
  readonly handleResetCustomGuild: () => void;
}

export interface TopNavProps extends TopNavOptionsMenuContentProps {
  readonly openMenu: Accessor<GameTopNavMenu | null>;
  readonly setOpenMenu: Setter<GameTopNavMenu | null>;
  readonly autoAttackEnabled: Accessor<boolean>;
  readonly autoAttackProfileLabel: Accessor<string>;
  readonly autoAttackConfiguredProfileLabel: Accessor<string>;
  readonly autoAttackLastError: Accessor<string>;
  readonly autoAttackTargetPriority: Accessor<string>;
  readonly setAutoAttackTargetPriority: Setter<string>;
  readonly combatProfiles: Accessor<readonly TopNavCombatProfile[]>;
  readonly selectedAutoAttackProfileId: Accessor<string>;
  readonly handleToggleAutoAttack: () => void;
  readonly handleSelectAutoAttackProfile: (selectedProfileId: string) => void;
  readonly scriptLoaded: Accessor<boolean>;
  readonly scriptRunning: Accessor<boolean>;
  readonly scriptStatus: Accessor<string>;
  readonly scriptTogglePending: Accessor<boolean>;
  readonly scriptRestartAfterReconnect: Accessor<boolean>;
  readonly scriptUsePrivateRooms: Accessor<boolean>;
  readonly scriptSafeStartStop: Accessor<boolean>;
  readonly scriptInputsAvailable: Accessor<boolean>;
  readonly loadScript: () => void | Promise<void>;
  readonly toggleScript: () => void | Promise<void>;
  readonly openScriptInputs: () => void;
  readonly handleToggleScriptPrivateRooms: () => void;
  readonly handleToggleScriptRestartAfterReconnect: () => void;
  readonly handleToggleScriptSafeStartStop: () => void;
  readonly autoZoneEnabled: Accessor<boolean>;
  readonly autoZoneMap: Accessor<AutoZoneSupportedMap | undefined>;
  readonly handleToggleAutoZone: () => void;
  readonly handleSelectAutoZoneMap: (
    map: AutoZoneSupportedMap | undefined,
  ) => void;
  readonly autoReloginEnabled: Accessor<boolean>;
  readonly autoReloginCaptured: Accessor<boolean>;
  readonly autoReloginAttempting: Accessor<boolean>;
  readonly autoReloginWaitingDelay: Accessor<boolean>;
  readonly autoReloginToggling: Accessor<boolean>;
  readonly autoReloginDelaySeconds: Accessor<string>;
  readonly setAutoReloginDelaySeconds: Setter<string>;
  readonly autoReloginServer: Accessor<string>;
  readonly autoReloginServers: Accessor<readonly string[]>;
  readonly autoReloginLastError: Accessor<string>;
  readonly autoReloginAttemptsRemaining: Accessor<number | null>;
  readonly handleToggleAutoRelogin: () => void;
  readonly handleRefreshAutoReloginServers: () => void;
  readonly handleSelectAutoReloginServer: (serverName: string) => void;
  readonly handleSetAutoReloginDelay: () => void;
  readonly cells: Accessor<readonly string[]>;
  readonly pads: Accessor<readonly string[]>;
  readonly validPads: Accessor<readonly string[]>;
  readonly selectedCell: Accessor<string>;
  readonly selectedPad: Accessor<string>;
  readonly travelBusy: Accessor<boolean>;
  readonly handleRefreshTravelOptions: () => void;
  readonly handleSelectCell: (cell: string) => void;
  readonly handleSelectPad: (pad: string) => void;
  readonly handleOpenBank: () => void;
  readonly handleOpenWindow: (id: WindowId) => void;
}

const gameWindowGroups: readonly {
  readonly name: string;
  readonly items: readonly {
    readonly id: WindowId;
    readonly label: string;
  }[];
}[] = [
  {
    name: "Automation",
    items: [
      { id: "environment", label: "Environment" },
      { id: "follower", label: "Follower" },
      { id: "packets", label: "Packets" },
    ],
  },
  {
    name: "Tools",
    items: [
      { id: "combat-profiles", label: "Combat Profiles" },
      { id: "loader-grabber", label: "Loader/Grabber" },
    ],
  },
];

export const topNavOptionCommandIds: Partial<
  Record<SettingsCommandId, string>
> = {
  toggleInfiniteRange: "infinite-range",
  toggleProvokeCell: "provoke-cell",
  toggleEnemyMagnet: "enemy-magnet",
  toggleLagKiller: "lag-killer",
  toggleHidePlayers: "hide-players",
  toggleSkipCutscenes: "skip-cutscenes",
  toggleAntiCounter: "anti-counter",
  toggleAnimations: "animations",
  toggleCollisions: "collisions",
  toggleDeathAds: "death-ads",
};

const commandIdsByOptionId = new Map<string, SettingsCommandId>(
  Object.entries(topNavOptionCommandIds).map(([commandId, optionId]) => [
    optionId,
    commandId as SettingsCommandId,
  ]),
);

export const windowCommandIds: Partial<Record<WindowId, SettingsCommandId>> = {
  environment: "openEnvironment",
  "loader-grabber": "openLoaderGrabber",
  follower: "openFollower",
  packets: "openPackets",
};

const commandHotkey = (
  bindings: readonly HotkeyBinding[],
  id: SettingsCommandId,
): string => readHotkeyBinding(bindings, id);

const formatOptionalHotkeyDisplay = (
  value: string,
  platform: AppPlatform,
): string => (value === "" ? "" : formatHotkeyDisplay(value, platform, ""));

const optionHotkey = (
  bindings: readonly HotkeyBinding[],
  optionId: string,
): string => {
  const commandId = commandIdsByOptionId.get(optionId);
  return commandId ? commandHotkey(bindings, commandId) : "";
};

const windowHotkey = (
  bindings: readonly HotkeyBinding[],
  id: WindowId,
): string => {
  const commandId = windowCommandIds[id];
  return commandId ? commandHotkey(bindings, commandId) : "";
};

const getAutoZoneMapLabel = (map: AutoZoneSupportedMap | undefined): string =>
  map === undefined
    ? ""
    : (AUTO_ZONE_MAP_OPTIONS.find((option) => option.value === map)?.label ??
      map);

const MenuAutofocusAnchor = (): JSX.Element => (
  <span
    aria-hidden="true"
    class="game-menu__autofocus-anchor"
    data-autofocus=""
    tabIndex={-1}
  />
);

function ResetCustomValueButton(props: {
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <Button
      aria-label={props.label}
      class="game-menu__field-reset"
      disabled={props.disabled}
      size="icon-xs"
      type="button"
      variant="ghost"
      onClick={props.onClick}
      onPointerDown={(event) => event.preventDefault()}
    >
      <Icon icon="rotate_ccw" size="sm" />
    </Button>
  );
}

function MenuSliderField(props: {
  readonly disabled: boolean;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onCommit: (value: number) => void;
  readonly resetValue: number;
  readonly setValue: Setter<string>;
  readonly value: Accessor<string>;
}): JSX.Element {
  const value = () => {
    const parsed = Number(props.value());
    return Number.isFinite(parsed)
      ? Math.max(props.min, Math.min(props.max, parsed))
      : props.resetValue;
  };
  const commit = (nextValue: number): void => {
    props.setValue(String(nextValue));
    props.onCommit(nextValue);
  };

  return (
    <div
      class="game-menu__field game-menu__slider-field"
      data-disabled={props.disabled ? "" : undefined}
    >
      <span class="game-menu__field-heading">
        <span class="game-menu__field-label">{props.label}</span>
        <span class="game-menu__field-actions">
          <span class="game-menu__slider-value">{value()}</span>
          <Button
            aria-label={`Reset ${props.label.toLowerCase()}`}
            disabled={props.disabled || value() === props.resetValue}
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={() => commit(props.resetValue)}
            onPointerDown={(event) => event.preventDefault()}
          >
            <Icon icon="rotate_ccw" size="sm" />
          </Button>
        </span>
      </span>
      <Slider
        aria-label={[props.label]}
        disabled={props.disabled}
        max={props.max}
        min={props.min}
        step={1}
        value={[value()]}
        onKeyDown={(event) => {
          if (event.key !== "Escape" && event.key !== "Tab") {
            event.stopPropagation();
          }
        }}
        onValueChange={(details) => {
          const nextValue = details.value[0];
          if (nextValue !== undefined) props.setValue(String(nextValue));
        }}
        onValueChangeEnd={(details) => {
          const nextValue = details.value[0];
          if (nextValue !== undefined) commit(nextValue);
        }}
      />
    </div>
  );
}

const stopMenuInputKeyPropagation: JSX.EventHandler<
  HTMLInputElement,
  KeyboardEvent
> = (event) => {
  if (event.key !== "Escape" && event.key !== "Tab") {
    event.stopPropagation();
  }
};

const commitMenuInputOnEnter =
  (commit: () => void): JSX.EventHandler<HTMLInputElement, KeyboardEvent> =>
  (event) => {
    stopMenuInputKeyPropagation(event);
    if (event.key !== "Enter") return;

    event.preventDefault();
    commit();
  };

const combatProfileClassName = (profile: TopNavCombatProfile): string =>
  profile.className?.trim() || "";

const combatProfileTooltip = (profile: TopNavCombatProfile): string =>
  `${profile.label} - ${combatProfileClassName(profile) || "Any class"}`;

type TopNavMenuTriggerProps = Omit<ButtonProps, "as" | "size" | "type"> & {
  readonly expanded?: boolean;
};

function TopNavMenuTrigger(props: TopNavMenuTriggerProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "children",
    "class",
    "expanded",
    "variant",
  ]);

  return (
    <MenuTrigger
      asChild={(triggerProps) => (
        <Button
          {...(triggerProps({
            ...rest,
            children: local.children,
            class: cn("game-topnav__trigger", local.class),
            "data-expanded": local.expanded ? "" : undefined,
            size: "sm",
            type: "button",
            variant: local.variant ?? "ghost",
          } as ButtonProps) as ButtonProps)}
        />
      )}
    />
  );
}

type GameMenuPortalProps = {
  readonly portalMount: Accessor<Node | undefined>;
};

function GameMenuContent(
  props: MenuContentProps & GameMenuPortalProps,
): JSX.Element {
  const [local, rest] = splitProps(props, ["portalMount"]);

  return (
    <Show when={local.portalMount()}>
      {(portalMount) => (
        <Portal mount={portalMount()}>
          <MenuContent {...rest} portal={false} />
        </Portal>
      )}
    </Show>
  );
}

function GameMenuSubContent(
  props: MenuSubContentProps & GameMenuPortalProps,
): JSX.Element {
  const [local, rest] = splitProps(props, ["portalMount"]);

  return (
    <Show when={local.portalMount()}>
      {(portalMount) => (
        <Portal mount={portalMount()}>
          <MenuSubContent {...rest} portal={false} />
        </Portal>
      )}
    </Show>
  );
}

export function TopNavOptionsMenuContent(
  props: TopNavOptionsMenuContentProps,
): JSX.Element {
  const gameInteractionDisabled = () =>
    !props.gameLoaded() || !props.playerReady();

  return (
    <>
      <MenuAutofocusAnchor />
      <div class="game-menu__options-content">
        <div class="game-options-grid">
          <For each={props.optionItems()}>
            {(option) => (
              <MenuCheckboxItem
                checked={option.checked}
                class="game-menu__item"
                closeOnSelect={false}
                disabled={option.disabled}
                onCheckedChange={option.onCheckedChange}
                value={option.id}
              >
                <span class="game-menu__option-content">
                  <span class="game-menu__item-label">{option.label}</span>
                  <Show
                    when={formatOptionalHotkeyDisplay(
                      optionHotkey(props.hotkeyBindings(), option.id),
                      props.hotkeyPlatform,
                    )}
                  >
                    {(shortcut) => <Kbd>{shortcut()}</Kbd>}
                  </Show>
                </span>
              </MenuCheckboxItem>
            )}
          </For>
        </div>
        <MenuSeparator />
        <div class="game-menu__fields">
          <MenuSliderField
            disabled={gameInteractionDisabled()}
            label="Walk Speed"
            max={99}
            min={1}
            onCommit={props.handleSetWalkSpeed}
            resetValue={8}
            setValue={props.setWalkSpeed}
            value={props.walkSpeed}
          />
          <MenuSliderField
            disabled={gameInteractionDisabled()}
            label="FPS"
            max={60}
            min={1}
            onCommit={props.handleSetFrameRate}
            resetValue={24}
            setValue={props.setFrameRate}
            value={props.frameRate}
          />
          <div
            class="game-menu__field game-menu__identity-field"
            data-disabled={gameInteractionDisabled() ? "" : undefined}
          >
            <Label class="game-menu__field-label" for="game-custom-name">
              Custom Name
            </Label>
            <InputGroup size="sm">
              <InputGroupInput
                disabled={gameInteractionDisabled()}
                id="game-custom-name"
                value={props.customName()}
                onBlur={props.handleSetCustomName}
                onKeyDown={commitMenuInputOnEnter(props.handleSetCustomName)}
                onInput={(event) =>
                  props.setCustomName(event.currentTarget.value)
                }
              />
              <InputGroupAddon align="inline-end">
                <ResetCustomValueButton
                  disabled={
                    gameInteractionDisabled() || !props.customNameConfigured()
                  }
                  label="Reset custom name"
                  onClick={props.handleResetCustomName}
                />
              </InputGroupAddon>
            </InputGroup>
          </div>
          <div
            class="game-menu__field game-menu__identity-field"
            data-disabled={gameInteractionDisabled() ? "" : undefined}
          >
            <Label class="game-menu__field-label" for="game-custom-guild">
              Custom Guild
            </Label>
            <InputGroup size="sm">
              <InputGroupInput
                disabled={gameInteractionDisabled()}
                id="game-custom-guild"
                value={props.customGuild()}
                onBlur={props.handleSetCustomGuild}
                onKeyDown={commitMenuInputOnEnter(props.handleSetCustomGuild)}
                onInput={(event) =>
                  props.setCustomGuild(event.currentTarget.value)
                }
              />
              <InputGroupAddon align="inline-end">
                <ResetCustomValueButton
                  disabled={
                    gameInteractionDisabled() || !props.customGuildConfigured()
                  }
                  label="Reset custom guild"
                  onClick={props.handleResetCustomGuild}
                />
              </InputGroupAddon>
            </InputGroup>
          </div>
        </div>
      </div>
    </>
  );
}

export function TopNav(props: TopNavProps): JSX.Element {
  let autoReloginMenuContent: HTMLDivElement | undefined;
  const [menuPortalMount, setMenuPortalMount] = createSignal<HTMLDivElement>();
  const [autoReloginServerMenuOpen, setAutoReloginServerMenuOpen] =
    createSignal(false);

  const handleToggleScriptClick = (): void => {
    void props.toggleScript();
  };
  const scriptToggleDisabled = (): boolean =>
    !props.scriptLoaded() ||
    props.scriptTogglePending() ||
    (!props.scriptRunning() && !props.playerReady());

  const autoReloginNeedsAttention = (): boolean =>
    props.autoReloginLastError() !== "";
  const autoReloginAwaitingSession = (): boolean =>
    props.autoReloginEnabled() && !props.autoReloginCaptured();
  const autoReloginShimmering = (): boolean =>
    props.autoReloginToggling() ||
    props.autoReloginAttempting() ||
    props.autoReloginWaitingDelay() ||
    autoReloginAwaitingSession();

  const autoReloginAttemptsRemainingLabel = (): string => {
    const remaining = props.autoReloginAttemptsRemaining();
    if (remaining === null) return "";
    if (remaining <= 0) return "final attempt";
    return `${remaining} ${remaining === 1 ? "retry" : "retries"} left`;
  };

  const autoReloginTriggerLabel = (): string => {
    if (props.autoReloginAttempting()) {
      const remaining = autoReloginAttemptsRemainingLabel();
      return remaining === ""
        ? "Auto Relogin reconnecting"
        : `Auto Relogin reconnecting (${remaining})`;
    }

    if (props.autoReloginWaitingDelay()) {
      return "Auto Relogin waiting before reconnect";
    }

    if (autoReloginAwaitingSession()) {
      return "Auto Relogin waiting for login";
    }

    const error = props.autoReloginLastError();
    return error === "" ? "Auto Relogin" : `Auto Relogin failed: ${error}`;
  };

  const autoReloginHasTerminalError = (): boolean =>
    autoReloginNeedsAttention() &&
    !props.autoReloginToggling() &&
    !props.autoReloginAttempting() &&
    !props.autoReloginWaitingDelay() &&
    !autoReloginAwaitingSession();

  const autoReloginMenuStatus = (): string => {
    if (props.autoReloginToggling()) {
      return props.autoReloginEnabled() ? "Enabling" : "Disabling";
    }

    let status = "";
    if (props.autoReloginWaitingDelay()) status = "Waiting to reconnect";
    else if (autoReloginAwaitingSession()) status = "Waiting for login";
    else if (props.autoReloginAttempting()) status = "Reconnecting";

    if (status !== "") {
      const attempts = autoReloginAttemptsRemainingLabel();
      return attempts === "" ? status : `${status} (${attempts})`;
    }

    return props.autoReloginLastError();
  };

  const autoAttackTriggerLabel = (): string => {
    const profileLabel = autoAttackTriggerText();
    const error = props.autoAttackLastError();

    if (error !== "") {
      return `Auto Attack failed: ${error}`;
    }

    if (!props.autoAttackEnabled()) {
      return profileLabel === ""
        ? "Auto Attack disabled"
        : `Auto Attack disabled: ${profileLabel}`;
    }

    return profileLabel === ""
      ? "Auto Attack enabled"
      : `Auto Attack enabled: ${profileLabel}`;
  };

  const autoAttackTriggerText = (): string =>
    props.autoAttackEnabled()
      ? props.autoAttackProfileLabel() ||
        props.autoAttackConfiguredProfileLabel()
      : props.autoAttackConfiguredProfileLabel();

  const autoAttackSelectionValue = (): string =>
    props.selectedAutoAttackProfileId();

  const autoAttackPrioritySummary = (): string => {
    const targetCount = props
      .autoAttackTargetPriority()
      .split(/[,;\n]+/u)
      .map((target) => target.trim())
      .filter((target) => target !== "").length;
    if (targetCount === 0) {
      return "Off";
    }

    return `${targetCount} ${targetCount === 1 ? "target" : "targets"}`;
  };

  const handleAutoAttackSelectionChange = (details: { value: string }) => {
    if (props.autoAttackEnabled()) {
      return;
    }

    if (details.value !== "") {
      props.handleSelectAutoAttackProfile(details.value);
    }
  };

  const setMenuOpen =
    (menu: GameTopNavMenu) =>
    (details: { readonly open: boolean }): void => {
      props.setOpenMenu(details.open ? menu : null);
    };

  const setAutoReloginMenuOpen = (details: {
    readonly open: boolean;
  }): void => {
    if (details.open) {
      props.handleRefreshAutoReloginServers();
    } else {
      setAutoReloginServerMenuOpen(false);
    }
    props.setOpenMenu(details.open ? "relogin" : null);
  };

  const toggleMenu =
    (menu: GameTopNavMenu): JSX.EventHandler<HTMLButtonElement, MouseEvent> =>
    (event) => {
      event.preventDefault();
      props.setOpenMenu((current) => (current === menu ? null : menu));
    };

  const gameInteractionDisabled = () => !props.playerReady();

  const travelUnavailable = () => gameInteractionDisabled();

  const travelInteractionBlocked = () =>
    travelUnavailable() || props.travelBusy();

  const toggleTravelMenu =
    (menu: "pads" | "cells"): JSX.EventHandler<HTMLButtonElement, MouseEvent> =>
    (event) => {
      if (travelInteractionBlocked()) {
        event.preventDefault();
        return;
      }

      props.handleRefreshTravelOptions();
      toggleMenu(menu)(event);
    };

  const isValidPad = (pad: string) =>
    props
      .validPads()
      .some((validPad) => validPad.toLowerCase() === pad.toLowerCase());

  const commitAutoReloginDelayOnEnter: JSX.EventHandler<
    HTMLInputElement,
    KeyboardEvent
  > = (event) => {
    stopMenuInputKeyPropagation(event);
    if (event.key !== "Enter") return;
    event.preventDefault();
    props.handleSetAutoReloginDelay();
  };

  const closeAutoReloginServerMenuToParent: JSX.EventHandler<
    HTMLDivElement,
    KeyboardEvent
  > = (event) => {
    if (event.key !== "ArrowLeft") return;
    event.preventDefault();
    event.stopPropagation();
    setAutoReloginServerMenuOpen(false);
    autoReloginMenuContent?.focus({ preventScroll: true });
  };

  return (
    <div id="topnav-container" class="game-topnav-container">
      <div
        ref={(element) => setMenuPortalMount(element)}
        class="game-topnav__menu-portal"
      />
      <nav id="topnav" class="game-topnav" aria-label="Game controls">
        <div
          class="game-topnav__left"
          data-menu-open={
            props.openMenu() !== null &&
            props.openMenu() !== "pads" &&
            props.openMenu() !== "cells"
              ? ""
              : undefined
          }
        >
          <Menu
            open={props.openMenu() === "windows"}
            onOpenChange={setMenuOpen("windows")}
          >
            <TopNavMenuTrigger
              expanded={props.openMenu() === "windows"}
              onClick={toggleMenu("windows")}
            >
              Windows
            </TopNavMenuTrigger>
            <GameMenuContent
              class="game-menu game-menu--mega"
              portalMount={menuPortalMount}
            >
              <div class="game-menu__mega-grid">
                <For each={gameWindowGroups}>
                  {(group) => (
                    <MenuGroup class="game-menu__group">
                      <MenuLabel>{group.name}</MenuLabel>
                      <For each={group.items}>
                        {(item) => (
                          <MenuItem
                            class="game-menu__item"
                            onSelect={() => props.handleOpenWindow(item.id)}
                            value={item.id}
                          >
                            <span class="game-menu__item-label">
                              {item.label}
                            </span>
                            <Show
                              when={formatOptionalHotkeyDisplay(
                                windowHotkey(props.hotkeyBindings(), item.id),
                                props.hotkeyPlatform,
                              )}
                            >
                              {(shortcut) => <Kbd>{shortcut()}</Kbd>}
                            </Show>
                          </MenuItem>
                        )}
                      </For>
                    </MenuGroup>
                  )}
                </For>
              </div>
            </GameMenuContent>
          </Menu>

          <Menu
            open={props.openMenu() === "scripts"}
            onOpenChange={setMenuOpen("scripts")}
          >
            <TopNavMenuTrigger
              expanded={props.openMenu() === "scripts"}
              onClick={toggleMenu("scripts")}
            >
              Scripts
            </TopNavMenuTrigger>
            <GameMenuContent
              class="game-menu game-menu--scripts"
              portalMount={menuPortalMount}
            >
              <div class="game-menu__status" role="status">
                {props.scriptStatus()}
              </div>
              <MenuGroup>
                <MenuItem
                  class="game-menu__item"
                  disabled={props.scriptRunning()}
                  onSelect={() => void props.loadScript()}
                  value="loadScript"
                >
                  <span class="game-menu__item-label">Load Script</span>
                  <Show
                    when={formatOptionalHotkeyDisplay(
                      commandHotkey(props.hotkeyBindings(), "loadScript"),
                      props.hotkeyPlatform,
                    )}
                  >
                    {(shortcut) => <Kbd>{shortcut()}</Kbd>}
                  </Show>
                </MenuItem>
                <MenuItem
                  class="game-menu__item"
                  disabled={
                    !props.scriptLoaded() ||
                    !props.scriptInputsAvailable() ||
                    props.scriptRunning()
                  }
                  onSelect={props.openScriptInputs}
                  value="script-inputs"
                >
                  <span class="game-menu__item-label">Edit Inputs...</span>
                </MenuItem>
                <MenuItem
                  class="game-menu__item"
                  disabled={scriptToggleDisabled()}
                  onClick={handleToggleScriptClick}
                  value="start-script"
                >
                  <span class="game-menu__item-label">
                    {props.scriptRunning() ? "Stop" : "Start"}
                  </span>
                  <Show
                    when={formatOptionalHotkeyDisplay(
                      commandHotkey(props.hotkeyBindings(), "toggleScript"),
                      props.hotkeyPlatform,
                    )}
                  >
                    {(shortcut) => <Kbd>{shortcut()}</Kbd>}
                  </Show>
                </MenuItem>
                <MenuSub closeOnSelect={false}>
                  <MenuSubTrigger class="game-menu__item">
                    <span class="game-menu__item-label">Options</span>
                  </MenuSubTrigger>
                  <GameMenuSubContent
                    class="game-menu game-menu--compact"
                    portalMount={menuPortalMount}
                  >
                    <MenuCheckboxItem
                      checked={props.scriptUsePrivateRooms()}
                      class="game-menu__item"
                      closeOnSelect={false}
                      onClick={props.handleToggleScriptPrivateRooms}
                      value="script-use-private-rooms"
                    >
                      Use Private Rooms
                    </MenuCheckboxItem>
                    <MenuCheckboxItem
                      checked={props.scriptRestartAfterReconnect()}
                      class="game-menu__item"
                      closeOnSelect={false}
                      onClick={props.handleToggleScriptRestartAfterReconnect}
                      value="script-restart-after-reconnect"
                    >
                      Restart After Reconnect
                    </MenuCheckboxItem>
                    <Tooltip
                      closeDelay={0}
                      openDelay={400}
                      positioning={{ placement: "right" }}
                    >
                      <TooltipTrigger
                        asChild={(triggerProps) => (
                          <MenuCheckboxItem
                            {...(triggerProps({
                              "aria-description":
                                "Best-effort attempt to start or stop the script at your house.",
                              checked: props.scriptSafeStartStop(),
                              class: "game-menu__item",
                              closeOnSelect: false,
                              onClick: props.handleToggleScriptSafeStartStop,
                              value: "script-safe-start-stop",
                            } as unknown as ButtonProps) as unknown as MenuCheckboxItemProps)}
                          >
                            Safe Start/Stop
                          </MenuCheckboxItem>
                        )}
                      />
                      <TooltipContent>
                        Best-effort attempt to start or stop the script at your
                        house.
                      </TooltipContent>
                    </Tooltip>
                  </GameMenuSubContent>
                </MenuSub>
              </MenuGroup>
            </GameMenuContent>
          </Menu>

          <Menu
            open={props.openMenu() === "options"}
            onOpenChange={setMenuOpen("options")}
          >
            <TopNavMenuTrigger
              expanded={props.openMenu() === "options"}
              onClick={toggleMenu("options")}
            >
              Options
            </TopNavMenuTrigger>
            <GameMenuContent
              class="game-menu game-menu--options"
              portalMount={menuPortalMount}
            >
              <TopNavOptionsMenuContent {...props} />
            </GameMenuContent>
          </Menu>

          <Menu
            open={props.openMenu() === "autozone"}
            onOpenChange={setMenuOpen("autozone")}
          >
            <TopNavMenuTrigger
              class="game-topnav__trigger--autozone"
              expanded={props.openMenu() === "autozone"}
              onClick={toggleMenu("autozone")}
              title={
                props.autoZoneEnabled() && props.autoZoneMap()
                  ? `Auto Zone: ${getAutoZoneMapLabel(props.autoZoneMap())}`
                  : undefined
              }
            >
              <span>Auto Zone</span>
              <Show when={props.autoZoneEnabled() && props.autoZoneMap()}>
                <span class="game-topnav__trigger-detail">
                  {props.autoZoneMap()}
                </span>
              </Show>
            </TopNavMenuTrigger>
            <GameMenuContent
              class="game-menu game-menu--autozone"
              portalMount={menuPortalMount}
            >
              <MenuAutofocusAnchor />
              <MenuCheckboxItem
                checked={props.autoZoneEnabled()}
                class="game-menu__item"
                closeOnSelect={false}
                onClick={props.handleToggleAutoZone}
                value="toggle-autozone"
              >
                {props.autoZoneEnabled() ? "Disable" : "Enable"}
              </MenuCheckboxItem>
              <MenuSub closeOnSelect={false}>
                <MenuSubTrigger class="game-menu__item game-menu__server-trigger">
                  <span class="game-menu__item-label">Map</span>
                  <span class="game-menu__item-value">
                    {getAutoZoneMapLabel(props.autoZoneMap()) || "None"}
                  </span>
                </MenuSubTrigger>
                <GameMenuSubContent
                  class="game-menu game-menu--compact game-menu--autozone-maps"
                  portalMount={menuPortalMount}
                >
                  <For each={AUTO_ZONE_MAP_OPTIONS}>
                    {(option) => (
                      <MenuCheckboxItem
                        checked={props.autoZoneMap() === option.value}
                        class="game-menu__item"
                        closeOnSelect={false}
                        onClick={() =>
                          props.handleSelectAutoZoneMap(
                            option.value as AutoZoneSupportedMap,
                          )
                        }
                        value={option.value}
                      >
                        <span class="game-menu__item-label">
                          {option.label}
                        </span>
                      </MenuCheckboxItem>
                    )}
                  </For>
                </GameMenuSubContent>
              </MenuSub>
            </GameMenuContent>
          </Menu>

          <Menu
            open={props.openMenu() === "relogin"}
            onOpenChange={setAutoReloginMenuOpen}
          >
            <TopNavMenuTrigger
              aria-label={autoReloginTriggerLabel()}
              class={cn(
                "game-topnav__trigger--relogin",
                autoReloginHasTerminalError() && "game-topnav__trigger--alert",
              )}
              expanded={props.openMenu() === "relogin"}
              title={
                autoReloginTriggerLabel() === "Auto Relogin"
                  ? props.autoReloginEnabled() && props.autoReloginServer()
                    ? `Auto Relogin: ${props.autoReloginServer()}`
                    : undefined
                  : autoReloginTriggerLabel()
              }
            >
              <span
                class="game-topnav__relogin-label"
                data-shimmer={autoReloginShimmering() ? "" : undefined}
              >
                Auto Relogin
              </span>
              <Show
                when={props.autoReloginEnabled() && props.autoReloginServer()}
              >
                <span class="game-topnav__trigger-detail">
                  {props.autoReloginServer()}
                </span>
              </Show>
            </TopNavMenuTrigger>
            <GameMenuContent
              ref={(element) => {
                autoReloginMenuContent = element;
              }}
              class="game-menu game-menu--relogin"
              portalMount={menuPortalMount}
            >
              <MenuAutofocusAnchor />
              <Show when={autoReloginMenuStatus()}>
                {(status) => (
                  <>
                    <div
                      class="game-menu__status game-menu__status--relogin"
                      classList={{
                        "game-menu__error": autoReloginHasTerminalError(),
                      }}
                      role="status"
                      title={
                        autoReloginHasTerminalError() ? status() : undefined
                      }
                    >
                      {status()}
                    </div>
                    <MenuSeparator />
                  </>
                )}
              </Show>
              <MenuCheckboxItem
                checked={props.autoReloginEnabled()}
                class="game-menu__item"
                closeOnSelect={false}
                disabled={props.autoReloginToggling()}
                onClick={props.handleToggleAutoRelogin}
                value="toggle-autorelogin"
              >
                {props.autoReloginToggling()
                  ? props.autoReloginEnabled()
                    ? "Enabling..."
                    : "Disabling..."
                  : props.autoReloginEnabled()
                    ? "Disable"
                    : "Enable"}
              </MenuCheckboxItem>
              <MenuSub
                id="autorelogin-server-menu"
                open={autoReloginServerMenuOpen()}
                onOpenChange={(details) =>
                  setAutoReloginServerMenuOpen(details.open)
                }
                closeOnSelect={false}
              >
                <MenuSubTrigger class="game-menu__item game-menu__server-trigger">
                  <span class="game-menu__item-label">Server</span>
                  <span class="game-menu__item-value">
                    {props.autoReloginServer() || "None"}
                  </span>
                </MenuSubTrigger>
                <GameMenuSubContent
                  class="game-menu game-menu--compact game-menu--relogin-servers"
                  onKeyDownCapture={closeAutoReloginServerMenuToParent}
                  portalMount={menuPortalMount}
                >
                  <Show
                    when={props.autoReloginServers().length > 0}
                    fallback={
                      <MenuItem
                        class="game-menu__item"
                        disabled
                        value="no-servers"
                      >
                        No servers found
                      </MenuItem>
                    }
                  >
                    <For each={props.autoReloginServers()}>
                      {(serverName) => (
                        <MenuCheckboxItem
                          checked={props.autoReloginServer() === serverName}
                          class="game-menu__item"
                          closeOnSelect={false}
                          onClick={() =>
                            props.handleSelectAutoReloginServer(serverName)
                          }
                          value={serverName}
                        >
                          <span class="game-menu__item-label">
                            {serverName}
                          </span>
                        </MenuCheckboxItem>
                      )}
                    </For>
                  </Show>
                </GameMenuSubContent>
              </MenuSub>
              <MenuSeparator />
              <div class="game-menu__fields game-menu__fields--single-row">
                <Label class="game-menu__field game-menu__field--inline game-menu__field--wide game-menu__field--menu-inset">
                  <span>Delay</span>
                  <div class="game-menu__delay-control">
                    <Input
                      class="game-menu__delay-input"
                      inputMode="decimal"
                      max="300"
                      min="0"
                      size="sm"
                      step="1"
                      type="number"
                      value={props.autoReloginDelaySeconds()}
                      onBlur={props.handleSetAutoReloginDelay}
                      onKeyDown={commitAutoReloginDelayOnEnter}
                      onInput={(event) =>
                        props.setAutoReloginDelaySeconds(
                          event.currentTarget.value,
                        )
                      }
                    />
                    <span class="game-menu__delay-unit">sec</span>
                  </div>
                </Label>
              </div>
            </GameMenuContent>
          </Menu>

          <Button
            class={cn(
              "game-topnav__button",
              props.scriptRunning() && "game-topnav__button--danger",
              props.scriptLoaded() &&
                !props.scriptRunning() &&
                "game-topnav__button--success",
            )}
            disabled={scriptToggleDisabled()}
            onClick={handleToggleScriptClick}
            size="sm"
            variant="ghost"
          >
            {props.scriptRunning() ? "Stop" : "Start"}
          </Button>
        </div>

        <div
          class="game-topnav__right"
          data-menu-open={
            props.openMenu() === "combat" ||
            props.openMenu() === "pads" ||
            props.openMenu() === "cells"
              ? ""
              : undefined
          }
        >
          <Menu
            open={props.openMenu() === "combat"}
            onOpenChange={setMenuOpen("combat")}
          >
            <TopNavMenuTrigger
              aria-label={autoAttackTriggerLabel()}
              aria-pressed={props.autoAttackEnabled()}
              class={cn(
                "game-topnav__combat-trigger",
                props.autoAttackLastError() !== "" &&
                  "game-topnav__trigger--alert",
              )}
              data-enabled={props.autoAttackEnabled() ? "" : undefined}
              disabled={gameInteractionDisabled()}
              expanded={props.openMenu() === "combat"}
              onClick={toggleMenu("combat")}
              title={autoAttackTriggerLabel()}
            >
              <span class="game-topnav__combat-label">
                {autoAttackTriggerText()}
              </span>
              <Icon
                icon="chevron_down"
                aria-hidden="true"
                class="game-topnav__select-chevron"
              />
            </TopNavMenuTrigger>
            <GameMenuContent
              class="game-menu game-menu--combat"
              portalMount={menuPortalMount}
            >
              <MenuAutofocusAnchor />
              <MenuCheckboxItem
                checked={props.autoAttackEnabled()}
                class="game-menu__item game-menu__switch-item"
                closeOnSelect={false}
                disabled={gameInteractionDisabled()}
                onClick={props.handleToggleAutoAttack}
                value="toggle-auto-attack"
              >
                <span class="game-menu__item-label">Auto Attack</span>
                <span
                  aria-hidden="true"
                  class="game-menu__switch-visual"
                  data-checked={props.autoAttackEnabled() ? "" : undefined}
                />
              </MenuCheckboxItem>
              <MenuSub closeOnSelect={false}>
                <MenuSubTrigger class="game-menu__item game-menu__sub-trigger">
                  <span class="game-menu__item-label">Priority</span>
                  <span class="game-menu__item-value">
                    {autoAttackPrioritySummary()}
                  </span>
                </MenuSubTrigger>
                <GameMenuSubContent
                  class="game-menu game-menu--combat-priority"
                  portalMount={menuPortalMount}
                >
                  <div class="game-menu__fields game-menu__fields--single-row">
                    <Label class="game-menu__field game-menu__field--wide">
                      <span>Targets</span>
                      <Input
                        class="game-menu__priority-input"
                        disabled={props.autoAttackEnabled()}
                        placeholder="id:1, Undead Warrior"
                        size="sm"
                        value={props.autoAttackTargetPriority()}
                        onKeyDown={stopMenuInputKeyPropagation}
                        onInput={(event) =>
                          props.setAutoAttackTargetPriority(
                            event.currentTarget.value,
                          )
                        }
                      />
                    </Label>
                  </div>
                </GameMenuSubContent>
              </MenuSub>
              <MenuSeparator />
              <MenuGroup>
                <MenuItem
                  class="game-menu__section-trigger"
                  title="Open Combat Profiles"
                  value="open-combat-profiles"
                  onSelect={() => props.handleOpenWindow("combat-profiles")}
                >
                  <span>Combat Profile</span>
                  <Icon icon="arrow_up_right" aria-hidden="true" />
                </MenuItem>
              </MenuGroup>
              <MenuRadioGroup
                value={autoAttackSelectionValue()}
                onValueChange={handleAutoAttackSelectionChange}
              >
                <For each={props.combatProfiles()}>
                  {(profile) => (
                    <MenuRadioItem
                      aria-label={combatProfileTooltip(profile)}
                      class="game-menu__item game-menu__profile-item"
                      closeOnSelect={false}
                      disabled={props.autoAttackEnabled()}
                      title={combatProfileTooltip(profile)}
                      value={profile.id}
                    >
                      <span class="game-menu__item-label">{profile.label}</span>
                      <span class="game-menu__item-value game-menu__profile-class">
                        {combatProfileClassName(profile) || "Any"}
                      </span>
                    </MenuRadioItem>
                  )}
                </For>
              </MenuRadioGroup>
            </GameMenuContent>
          </Menu>

          <Menu
            open={props.openMenu() === "pads"}
            onOpenChange={setMenuOpen("pads")}
          >
            <TopNavMenuTrigger
              class="game-topnav__select-trigger"
              aria-busy={props.travelBusy() ? "true" : undefined}
              disabled={travelUnavailable()}
              expanded={props.openMenu() === "pads"}
              onClick={toggleTravelMenu("pads")}
              variant="secondary"
            >
              <span class="game-topnav__select-label">
                {props.selectedPad() || "Pad"}
              </span>
              <Icon
                icon="chevron_down"
                aria-hidden="true"
                class="game-topnav__select-chevron"
              />
            </TopNavMenuTrigger>
            <GameMenuContent
              class="game-menu game-menu--compact game-menu--pads"
              portalMount={menuPortalMount}
            >
              <Show
                when={props.pads().length > 0}
                fallback={
                  <MenuItem class="game-menu__item" disabled value="no-pads">
                    No pads found
                  </MenuItem>
                }
              >
                <For each={props.pads()}>
                  {(pad) => (
                    <MenuItem
                      class={cn(
                        "game-menu__item game-menu__pad-option",
                        isValidPad(pad) && "game-menu__pad-option--valid",
                      )}
                      onSelect={() => props.handleSelectPad(pad)}
                      value={pad}
                    >
                      <span class="game-menu__pad-name">{pad}</span>
                    </MenuItem>
                  )}
                </For>
              </Show>
            </GameMenuContent>
          </Menu>

          <Menu
            open={props.openMenu() === "cells"}
            onOpenChange={setMenuOpen("cells")}
          >
            <TopNavMenuTrigger
              class="game-topnav__select-trigger game-topnav__select-trigger--cell"
              aria-busy={props.travelBusy() ? "true" : undefined}
              disabled={travelUnavailable()}
              expanded={props.openMenu() === "cells"}
              onClick={toggleTravelMenu("cells")}
              variant="secondary"
            >
              <span class="game-topnav__select-label">
                {props.selectedCell() || "Cell"}
              </span>
              <Icon
                icon="chevron_down"
                aria-hidden="true"
                class="game-topnav__select-chevron"
              />
            </TopNavMenuTrigger>
            <GameMenuContent
              class="game-menu game-menu--compact game-menu--cells"
              portalMount={menuPortalMount}
            >
              <Show
                when={props.cells().length > 0}
                fallback={
                  <MenuItem class="game-menu__item" disabled value="no-cells">
                    No cells found
                  </MenuItem>
                }
              >
                <For each={props.cells()}>
                  {(cell) => (
                    <MenuItem
                      class="game-menu__item"
                      onSelect={() => props.handleSelectCell(cell)}
                      value={cell}
                    >
                      {cell}
                    </MenuItem>
                  )}
                </For>
              </Show>
            </GameMenuContent>
          </Menu>

          <Button
            disabled={gameInteractionDisabled()}
            onClick={props.handleOpenBank}
            size="sm"
            variant="secondary"
          >
            Bank
          </Button>
        </div>
      </nav>
    </div>
  );
}
