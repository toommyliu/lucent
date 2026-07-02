import {
  Button,
  Icon,
  Input,
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
  cn,
  type ButtonProps,
} from "@lucent/ui";
import {
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  splitProps,
  Switch,
  type Accessor,
  type JSX,
  type Setter,
} from "solid-js";

import type { AppPlatform } from "../../shared/desktopBridge";
import {
  formatHotkeyDisplay,
  readHotkeyBinding,
  type HotkeyBinding,
  type SettingsCommandId,
} from "../../shared/hotkeys";
import {
  AUTO_ZONE_MAP_OPTIONS,
  type AutoZoneSupportedMap,
} from "./flash/features/AutoZone";

export type GameTopNavMenu =
  | "windows"
  | "scripts"
  | "options"
  | "combat"
  | "autozone"
  | "relogin"
  | "pads"
  | "cells";
export type CombatProfileAutoAttackMode =
  | "equipped-class"
  | "generic"
  | "selected";
export type WindowId =
  | "environment"
  | "fast-travels"
  | "loader-grabber"
  | "follower"
  | "packets"
  | "account-manager";

export interface CombatProfile {
  readonly id: string;
  readonly label: string;
}

export interface TopNavOptionItem {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface TopNavOptionsMenuContentProps {
  readonly hotkeyBindings: Accessor<readonly HotkeyBinding[]>;
  readonly hotkeyPlatform: AppPlatform;
  readonly gameLoaded: Accessor<boolean>;
  readonly playerReady: Accessor<boolean>;
  readonly optionItems: Accessor<readonly TopNavOptionItem[]>;
  readonly walkSpeed: Accessor<string>;
  readonly setWalkSpeed: Setter<string>;
  readonly handleSetWalkSpeed: () => void;
  readonly frameRate: Accessor<string>;
  readonly setFrameRate: Setter<string>;
  readonly handleSetFrameRate: () => void;
  readonly customName: Accessor<string>;
  readonly setCustomName: Setter<string>;
  readonly handleSetCustomName: () => void;
  readonly customGuild: Accessor<string>;
  readonly setCustomGuild: Setter<string>;
  readonly handleSetCustomGuild: () => void;
}

export interface TopNavProps extends TopNavOptionsMenuContentProps {
  readonly openMenu: Accessor<GameTopNavMenu | null>;
  readonly setOpenMenu: Setter<GameTopNavMenu | null>;
  readonly autoAttackEnabled: Accessor<boolean>;
  readonly autoAttackProfileLabel: Accessor<string>;
  readonly autoAttackConfiguredProfileLabel: Accessor<string>;
  readonly autoAttackLastError: Accessor<string>;
  readonly combatProfiles: Accessor<readonly CombatProfile[]>;
  readonly autoAttackMode: Accessor<CombatProfileAutoAttackMode>;
  readonly selectedAutoAttackProfileId: Accessor<string | undefined>;
  readonly handleToggleAutoAttack: () => void;
  readonly handleSelectAutoAttackProfile: (
    mode: CombatProfileAutoAttackMode,
    selectedProfileId?: string,
  ) => void;
  readonly scriptLoaded: Accessor<boolean>;
  readonly scriptRunning: Accessor<boolean>;
  readonly scriptStatus: Accessor<string>;
  readonly scriptUsePrivateRooms: Accessor<boolean>;
  readonly scriptSafeStartStop: Accessor<boolean>;
  readonly scriptInputsAvailable: Accessor<boolean>;
  readonly loadScript: () => void | Promise<void>;
  readonly toggleScript: () => void | Promise<void>;
  readonly openScriptInputs: () => void;
  readonly handleToggleScriptPrivateRooms: () => void;
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
    items: [{ id: "loader-grabber", label: "Loader/Grabber" }],
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

const clickOption =
  (option: TopNavOptionItem): JSX.EventHandler<HTMLDivElement, MouseEvent> =>
  () => {
    if (option.disabled) {
      return;
    }
    option.onSelect();
  };

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

export function TopNavOptionsMenuContent(
  props: TopNavOptionsMenuContentProps,
): JSX.Element {
  const gameInteractionDisabled = () =>
    !props.gameLoaded() || !props.playerReady();

  return (
    <>
      <MenuAutofocusAnchor />
      <div class="game-options-grid">
        <For each={props.optionItems()}>
          {(option) => (
            <MenuCheckboxItem
              checked={option.checked}
              class="game-menu__item"
              closeOnSelect={false}
              disabled={option.disabled}
              onClick={clickOption(option)}
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
        <Label class="game-menu__field game-menu__field--inline">
          <span>Walk Speed</span>
          <Input
            class="game-menu__inline-input"
            disabled={gameInteractionDisabled()}
            inputMode="decimal"
            size="sm"
            type="number"
            value={props.walkSpeed()}
            onBlur={props.handleSetWalkSpeed}
            onKeyDown={commitMenuInputOnEnter(props.handleSetWalkSpeed)}
            onInput={(event) => props.setWalkSpeed(event.currentTarget.value)}
          />
        </Label>
        <Label class="game-menu__field game-menu__field--inline">
          <span>FPS</span>
          <Input
            class="game-menu__inline-input"
            disabled={gameInteractionDisabled()}
            inputMode="decimal"
            size="sm"
            type="number"
            value={props.frameRate()}
            onBlur={props.handleSetFrameRate}
            onKeyDown={commitMenuInputOnEnter(props.handleSetFrameRate)}
            onInput={(event) => props.setFrameRate(event.currentTarget.value)}
          />
        </Label>
        <Label class="game-menu__field game-menu__field--wide game-menu__field--inline">
          <span>Custom Name</span>
          <Input
            disabled={gameInteractionDisabled()}
            placeholder="Keep current name"
            size="sm"
            value={props.customName()}
            onBlur={props.handleSetCustomName}
            onKeyDown={commitMenuInputOnEnter(props.handleSetCustomName)}
            onInput={(event) => props.setCustomName(event.currentTarget.value)}
          />
        </Label>
        <Label class="game-menu__field game-menu__field--wide game-menu__field--inline">
          <span>Custom Guild</span>
          <Input
            disabled={gameInteractionDisabled()}
            placeholder="Keep current guild"
            size="sm"
            value={props.customGuild()}
            onBlur={props.handleSetCustomGuild}
            onKeyDown={commitMenuInputOnEnter(props.handleSetCustomGuild)}
            onInput={(event) => props.setCustomGuild(event.currentTarget.value)}
          />
        </Label>
      </div>
    </>
  );
}

export function TopNav(props: TopNavProps): JSX.Element {
  let topNavContainer: HTMLDivElement | undefined;
  let autoReloginMenuContent: HTMLDivElement | undefined;
  const [autoReloginServerMenuOpen, setAutoReloginServerMenuOpen] =
    createSignal(false);

  const autoReloginNeedsAttention = (): boolean =>
    props.autoReloginLastError() !== "";

  const autoReloginAttemptsRemainingLabel = (): string => {
    const remaining = props.autoReloginAttemptsRemaining();
    if (remaining === null) return "";
    if (remaining <= 0) return "No retry attempts left";
    return `${remaining} retry ${remaining === 1 ? "attempt" : "attempts"} left`;
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

    const error = props.autoReloginLastError();
    return error === "" ? "Auto Relogin" : `Auto Relogin failed: ${error}`;
  };

  const autoReloginTriggerHasStatus = (): boolean =>
    props.autoReloginAttempting() ||
    props.autoReloginWaitingDelay() ||
    autoReloginNeedsAttention();

  const autoReloginMenuHasStatus = (): boolean =>
    props.autoReloginToggling() ||
    autoReloginTriggerHasStatus() ||
    autoReloginAttemptsRemainingLabel() !== "";

  const autoReloginTriggerStatusKind = ():
    | "waiting"
    | "retrying"
    | "alert"
    | undefined =>
    props.autoReloginAttempting()
      ? "retrying"
      : props.autoReloginWaitingDelay()
        ? "waiting"
        : autoReloginNeedsAttention()
          ? "alert"
          : undefined;

  const autoAttackTriggerLabel = (): string => {
    const runtimeLabel = props.autoAttackProfileLabel();
    const configuredLabel = props.autoAttackConfiguredProfileLabel();
    const error = props.autoAttackLastError();

    if (error !== "") {
      return `Auto Attack failed: ${error}`;
    }

    if (!props.autoAttackEnabled()) {
      return configuredLabel === ""
        ? "Auto Attack disabled"
        : `Auto Attack disabled: ${configuredLabel}`;
    }

    if (
      props.autoAttackMode() === "equipped-class" &&
      runtimeLabel !== "" &&
      runtimeLabel !== configuredLabel
    ) {
      return `Auto Attack enabled: ${configuredLabel}, using ${runtimeLabel}`;
    }

    return configuredLabel === ""
      ? "Auto Attack enabled"
      : `Auto Attack enabled: ${configuredLabel}`;
  };

  const autoAttackSelectionValue = (): string =>
    props.autoAttackMode() === "selected"
      ? `profile:${props.selectedAutoAttackProfileId() ?? ""}`
      : props.autoAttackMode();

  const handleAutoAttackSelectionChange = (details: { value: string }) => {
    const value = details.value;
    if (value === "generic" || value === "equipped-class") {
      props.handleSelectAutoAttackProfile(value);
      return;
    }

    if (value.startsWith("profile:")) {
      props.handleSelectAutoAttackProfile(
        "selected",
        value.slice("profile:".length),
      );
    }
  };

  onMount(() => {
    let lastTopNavHeight = 0;

    const setTopNavOffset = (height: number): void => {
      if (!Number.isFinite(height)) return;

      const roundedHeight = Math.ceil(height);
      if (roundedHeight <= 0 || roundedHeight === lastTopNavHeight) return;

      lastTopNavHeight = roundedHeight;
      document.documentElement.style.setProperty(
        "--topnav-offset",
        `${roundedHeight}px`,
      );
    };

    const observer = new ResizeObserver(([entry]) => {
      const height =
        entry?.borderBoxSize[0]?.blockSize ?? entry?.contentRect.height;
      if (height !== undefined) setTopNavOffset(height);
    });

    if (topNavContainer) observer.observe(topNavContainer);

    onCleanup(() => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--topnav-offset");
    });
  });

  createEffect(() => {
    if (props.autoReloginAttempting()) {
      setAutoReloginServerMenuOpen(false);
    }
  });

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

  const travelDisabled = () => gameInteractionDisabled() || props.travelBusy();

  const toggleTravelMenu =
    (menu: "pads" | "cells"): JSX.EventHandler<HTMLButtonElement, MouseEvent> =>
    (event) => {
      if (travelDisabled()) {
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
    <div
      ref={(element) => {
        topNavContainer = element;
      }}
      id="topnav-container"
      class="game-topnav-container"
    >
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
            <MenuContent class="game-menu game-menu--mega" portal={false}>
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
            </MenuContent>
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
            <MenuContent class="game-menu game-menu--scripts" portal={false}>
              <MenuGroup>
                <MenuItem
                  class="game-menu__item"
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
                  disabled={!props.scriptLoaded() || props.scriptRunning()}
                  onSelect={props.toggleScript}
                  value="start-script"
                >
                  <span class="game-menu__item-label">
                    {props.scriptRunning() ? "Stop" : "Start"}
                  </span>
                </MenuItem>
                <MenuSub closeOnSelect={false}>
                  <MenuSubTrigger class="game-menu__item">
                    <span class="game-menu__item-label">Options</span>
                  </MenuSubTrigger>
                  <MenuSubContent
                    class="game-menu game-menu--compact"
                    portal={false}
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
                      checked={props.scriptSafeStartStop()}
                      class="game-menu__item"
                      closeOnSelect={false}
                      onClick={props.handleToggleScriptSafeStartStop}
                      value="script-safe-start-stop"
                    >
                      Safe Start/Stop
                    </MenuCheckboxItem>
                  </MenuSubContent>
                </MenuSub>
              </MenuGroup>
            </MenuContent>
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
            <MenuContent class="game-menu game-menu--options" portal={false}>
              <TopNavOptionsMenuContent {...props} />
            </MenuContent>
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
            <MenuContent class="game-menu game-menu--autozone" portal={false}>
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
                <MenuSubContent
                  class="game-menu game-menu--compact game-menu--autozone-maps"
                  portal={false}
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
                </MenuSubContent>
              </MenuSub>
            </MenuContent>
          </Menu>

          <Menu
            open={props.openMenu() === "relogin"}
            onOpenChange={setAutoReloginMenuOpen}
          >
            <TopNavMenuTrigger
              aria-label={autoReloginTriggerLabel()}
              class={cn(
                "game-topnav__trigger--relogin",
                autoReloginNeedsAttention() &&
                  !props.autoReloginAttempting() &&
                  !props.autoReloginWaitingDelay() &&
                  "game-topnav__trigger--alert",
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
              <span>Auto Relogin</span>
              <Show
                when={props.autoReloginEnabled() && props.autoReloginServer()}
              >
                <span class="game-topnav__trigger-detail">
                  {props.autoReloginServer()}
                </span>
              </Show>
              <span
                aria-hidden="true"
                class="game-topnav__status-slot"
                data-kind={autoReloginTriggerStatusKind()}
                data-visible={autoReloginTriggerHasStatus() ? "" : undefined}
              >
                <Switch>
                  <Match when={autoReloginTriggerStatusKind() === "waiting"}>
                    <Icon
                      icon="clock"
                      class="game-topnav__status-icon game-topnav__delay-icon"
                    />
                  </Match>
                  <Match when={autoReloginTriggerStatusKind() === "retrying"}>
                    <Icon
                      icon="loader_circle"
                      class="game-topnav__status-icon game-topnav__retry-spinner"
                    />
                  </Match>
                  <Match when={autoReloginTriggerStatusKind() === "alert"}>
                    <Icon
                      icon="circle_alert"
                      class="game-topnav__status-icon game-topnav__alert-icon"
                    />
                  </Match>
                </Switch>
              </span>
            </TopNavMenuTrigger>
            <MenuContent
              ref={(element) => {
                autoReloginMenuContent = element;
              }}
              class="game-menu game-menu--relogin"
              portal={false}
            >
              <MenuAutofocusAnchor />
              <Show when={autoReloginMenuHasStatus()}>
                <div class="game-menu__status game-menu__status--relogin">
                  <Show when={props.autoReloginToggling()}>
                    <span class="game-menu__status-row">
                      <Icon
                        icon="loader_circle"
                        aria-hidden="true"
                        class="game-menu__status-icon game-menu__status-icon--spin"
                      />
                      <span>
                        {props.autoReloginEnabled() ? "Enabling" : "Disabling"}
                      </span>
                    </span>
                  </Show>
                  <Show when={props.autoReloginWaitingDelay()}>
                    <span class="game-menu__status-row">
                      <Icon
                        icon="clock"
                        aria-hidden="true"
                        class="game-menu__status-icon"
                      />
                      <span>Waiting before reconnect</span>
                    </span>
                  </Show>
                  <Show when={props.autoReloginAttempting()}>
                    <span class="game-menu__status-row">
                      <Icon
                        icon="loader_circle"
                        aria-hidden="true"
                        class="game-menu__status-icon game-menu__status-icon--spin"
                      />
                      <span>Attempting reconnect</span>
                    </span>
                  </Show>
                  <Show when={props.autoReloginLastError()}>
                    {(error) => (
                      <span class="game-menu__status-row game-menu__error">
                        <Icon
                          icon="circle_alert"
                          aria-hidden="true"
                          class="game-menu__status-icon"
                        />
                        <span>{error()}</span>
                      </span>
                    )}
                  </Show>
                  <Show when={autoReloginAttemptsRemainingLabel()}>
                    {(label) => (
                      <span class="game-menu__status-row">
                        <span
                          aria-hidden="true"
                          class="game-menu__status-icon"
                        />
                        <span>{label()}</span>
                      </span>
                    )}
                  </Show>
                </div>
                <MenuSeparator />
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
                <MenuSubTrigger
                  aria-disabled={
                    props.autoReloginAttempting() ? "true" : undefined
                  }
                  class="game-menu__item game-menu__server-trigger"
                >
                  <span class="game-menu__item-label">Server</span>
                  <span class="game-menu__item-value">
                    {props.autoReloginServer() || "None"}
                  </span>
                </MenuSubTrigger>
                <MenuSubContent
                  class="game-menu game-menu--compact game-menu--relogin-servers"
                  onKeyDownCapture={closeAutoReloginServerMenuToParent}
                  portal={false}
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
                          disabled={props.autoReloginAttempting()}
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
                </MenuSubContent>
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
            </MenuContent>
          </Menu>

          <Button
            class={cn(
              "game-topnav__button",
              props.scriptRunning() && "game-topnav__button--danger",
              props.scriptLoaded() &&
                !props.scriptRunning() &&
                "game-topnav__button--success",
            )}
            disabled={!props.scriptLoaded()}
            onClick={props.toggleScript}
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
              <span
                aria-hidden="true"
                class={cn(
                  "game-topnav__combat-check",
                  props.autoAttackEnabled() &&
                    "game-topnav__combat-check--active",
                )}
              />
              <span class="game-topnav__combat-label">
                {props.autoAttackConfiguredProfileLabel()}
              </span>
              <Icon
                icon="chevron_down"
                aria-hidden="true"
                class="game-topnav__select-chevron"
              />
            </TopNavMenuTrigger>
            <MenuContent class="game-menu game-menu--combat" portal={false}>
              <MenuAutofocusAnchor />
              <MenuGroup>
                <MenuLabel>State</MenuLabel>
                <MenuCheckboxItem
                  checked={props.autoAttackEnabled()}
                  class="game-menu__item"
                  closeOnSelect={false}
                  disabled={gameInteractionDisabled()}
                  onClick={props.handleToggleAutoAttack}
                  value="toggle-auto-attack"
                >
                  {props.autoAttackEnabled() ? "Enabled" : "Disabled"}
                </MenuCheckboxItem>
              </MenuGroup>
              <MenuSeparator />
              <MenuGroup>
                <MenuLabel>Mode</MenuLabel>
              </MenuGroup>
              <MenuRadioGroup
                value={autoAttackSelectionValue()}
                onValueChange={handleAutoAttackSelectionChange}
              >
                <MenuRadioItem
                  class="game-menu__item"
                  closeOnSelect={false}
                  value="equipped-class"
                >
                  <span class="game-menu__item-label">
                    Match equipped class
                  </span>
                </MenuRadioItem>
                <MenuRadioItem
                  class="game-menu__item"
                  closeOnSelect={false}
                  value="generic"
                >
                  <span class="game-menu__item-label">Use generic</span>
                </MenuRadioItem>
              </MenuRadioGroup>
              <Show when={props.combatProfiles().length > 0}>
                <MenuSeparator />
                <MenuGroup>
                  <MenuLabel>Profiles</MenuLabel>
                </MenuGroup>
                <MenuRadioGroup
                  value={autoAttackSelectionValue()}
                  onValueChange={handleAutoAttackSelectionChange}
                >
                  <For each={props.combatProfiles()}>
                    {(profile) => (
                      <MenuRadioItem
                        class="game-menu__item"
                        closeOnSelect={false}
                        value={`profile:${profile.id}`}
                      >
                        <span class="game-menu__item-label">
                          {profile.label}
                        </span>
                      </MenuRadioItem>
                    )}
                  </For>
                </MenuRadioGroup>
              </Show>
            </MenuContent>
          </Menu>

          <Menu
            open={props.openMenu() === "pads"}
            onOpenChange={setMenuOpen("pads")}
          >
            <TopNavMenuTrigger
              class="game-topnav__select-trigger"
              disabled={travelDisabled()}
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
            <MenuContent
              class="game-menu game-menu--compact game-menu--pads"
              portal={false}
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
            </MenuContent>
          </Menu>

          <Menu
            open={props.openMenu() === "cells"}
            onOpenChange={setMenuOpen("cells")}
          >
            <TopNavMenuTrigger
              class="game-topnav__select-trigger game-topnav__select-trigger--cell"
              disabled={travelDisabled()}
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
            <MenuContent
              class="game-menu game-menu--compact game-menu--cells"
              portal={false}
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
            </MenuContent>
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
