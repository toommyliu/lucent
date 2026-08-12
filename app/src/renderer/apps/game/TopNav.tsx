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
  Slider,
  cn,
  type ButtonProps,
  type MenuContentProps,
  type MenuSubContentProps,
} from "@lucent/ui";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  splitProps,
  type Accessor,
  type JSX,
  type Setter,
} from "solid-js";
import { Portal } from "solid-js/web";

import type { AppPlatform } from "../../../shared/desktopBridge";
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
import type { RenderingMode } from "./flash/contract/Settings";

export type GameTopNavMenu =
  | "windows"
  | "options"
  | "combat"
  | "autozone"
  | "relogin"
  | "travel";
export type WindowId =
  | "environment"
  | "loader-grabber"
  | "follower"
  | "packets"
  | "account-manager"
  | "combat-profiles";

export interface TopNavCombatProfile {
  readonly className?: string;
  readonly id: string;
  readonly label: string;
  readonly role: string;
}

export interface TopNavToggleOptionItem {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly type: "toggle";
  readonly onCheckedChange: (checked: boolean) => void;
}

export interface TopNavRenderingModeOptionItem {
  readonly disabled?: boolean;
  readonly id: "rendering-mode";
  readonly label: "Rendering Mode";
  readonly mode: RenderingMode;
  readonly pending?: boolean;
  readonly type: "rendering-mode";
  readonly onModeChange: (mode: RenderingMode) => void;
}

export type TopNavOptionItem =
  | TopNavRenderingModeOptionItem
  | TopNavToggleOptionItem;

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
  readonly scriptTogglePending: Accessor<boolean>;
  readonly scriptOptionsReady: Accessor<boolean>;
  readonly openScripts: () => void;
  readonly toggleScript: () => void | Promise<void>;
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

const gameWindowItems: readonly {
  readonly id: WindowId;
  readonly label: string;
}[] = [
  { id: "combat-profiles", label: "Combat Profiles" },
  { id: "environment", label: "Environment" },
  { id: "follower", label: "Follower" },
  { id: "loader-grabber", label: "Loader/Grabber" },
  { id: "packets", label: "Packets" },
];

export const topNavOptionCommandIds: Partial<
  Record<SettingsCommandId, string>
> = {
  toggleInfiniteRange: "infinite-range",
  toggleProvokeCell: "provoke-cell",
  toggleEnemyMagnet: "enemy-magnet",
  toggleHidePlayers: "hide-players",
  toggleSkipCutscenes: "skip-cutscenes",
  toggleAntiCounter: "anti-counter",
  toggleAnimations: "animations",
  toggleCollisions: "collisions",
  toggleDeathAds: "death-ads",
};

const renderingModeOptions: readonly {
  readonly commandId?: SettingsCommandId;
  readonly label: string;
  readonly value: RenderingMode;
}[] = [
  { label: "Full", value: "full" },
  {
    commandId: "toggleInterfaceOnlyRendering",
    label: "Interface Only",
    value: "interface-only",
  },
  {
    commandId: "toggleMinimalRendering",
    label: "Minimal",
    value: "minimal",
  },
];

// Leave room for the Options trigger, 30rem menu, and 14rem flyout.
const RENDERING_MODE_DRILL_IN_MEDIA_QUERY = "(max-width: 50rem)";

const renderingModeLabel = (mode: RenderingMode): string =>
  renderingModeOptions.find((option) => option.value === mode)?.label ?? mode;

interface TopNavOptionSections {
  readonly afterRenderingMode: readonly TopNavToggleOptionItem[];
  readonly beforeRenderingMode: readonly TopNavToggleOptionItem[];
  readonly renderingMode: TopNavRenderingModeOptionItem | undefined;
}

const splitTopNavOptionItems = (
  optionItems: readonly TopNavOptionItem[],
): TopNavOptionSections => {
  const beforeRenderingMode: TopNavToggleOptionItem[] = [];
  const afterRenderingMode: TopNavToggleOptionItem[] = [];
  let renderingMode: TopNavRenderingModeOptionItem | undefined;

  for (const option of optionItems) {
    if (option.type === "rendering-mode") {
      renderingMode ??= option;
      continue;
    }

    (renderingMode === undefined
      ? beforeRenderingMode
      : afterRenderingMode
    ).push(option);
  }

  return { afterRenderingMode, beforeRenderingMode, renderingMode };
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
  const [editing, setEditing] = createSignal(false);
  const [draftValue, setDraftValue] = createSignal("");
  let valueInput: HTMLInputElement | undefined;

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
  const beginEdit = (): void => {
    if (props.disabled) return;

    setDraftValue(String(value()));
    setEditing(true);
    queueMicrotask(() => {
      valueInput?.focus();
      valueInput?.select();
    });
  };
  const cancelEdit = (): void => {
    setEditing(false);
    setDraftValue("");
  };
  const commitEdit = (): void => {
    if (!editing()) return;

    const parsed = Number(draftValue());
    if (!Number.isFinite(parsed) || draftValue().trim() === "") {
      cancelEdit();
      return;
    }

    const nextValue = Math.max(
      props.min,
      Math.min(props.max, Math.round(parsed)),
    );
    setEditing(false);
    setDraftValue("");
    commit(nextValue);
  };

  return (
    <div
      class="game-menu__field game-menu__slider-field"
      data-disabled={props.disabled ? "" : undefined}
    >
      <span class="game-menu__field-heading">
        <span class="game-menu__field-label">{props.label}</span>
        <span class="game-menu__field-actions">
          <Show
            when={editing()}
            fallback={
              <span
                aria-disabled={props.disabled}
                aria-label={`Edit ${props.label.toLowerCase()}`}
                class="game-menu__slider-value"
                role="button"
                tabIndex={props.disabled ? -1 : 0}
                title={`Double-click to edit ${props.label.toLowerCase()}`}
                onDblClick={beginEdit}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;

                  event.preventDefault();
                  event.stopPropagation();
                  beginEdit();
                }}
              >
                {value()}
              </span>
            }
          >
            <Input
              ref={(element) => {
                valueInput = element;
              }}
              aria-label={props.label}
              class="game-menu__slider-value-input"
              inputMode="numeric"
              type="text"
              unstyled
              value={draftValue()}
              onBlur={commitEdit}
              onInput={(event) => setDraftValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelEdit();
                  return;
                }

                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  commitEdit();
                  return;
                }

                if (event.key !== "Tab") event.stopPropagation();
              }}
            />
          </Show>
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
        thumbAlignment="center"
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

const combatProfileRole = (profile: TopNavCombatProfile): string =>
  profile.role.trim();

const combatProfileTooltip = (profile: TopNavCombatProfile): string =>
  `${profile.label} - ${combatProfileRole(profile)} role - ${
    combatProfileClassName(profile) || "Any class"
  }`;

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

type TopNavOptionsMenuInternalProps = TopNavOptionsMenuContentProps &
  GameMenuPortalProps & {
    readonly menuOpen: Accessor<boolean>;
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

function RenderingModeMenuItems(props: {
  readonly hotkeyBindings: Accessor<readonly HotkeyBinding[]>;
  readonly hotkeyPlatform: AppPlatform;
  readonly option: Accessor<TopNavRenderingModeOptionItem>;
}): JSX.Element {
  const handleValueChange = (details: { value: string }) => {
    const current = props.option();
    if (current.pending === true) return;

    const selected = renderingModeOptions.find(
      (candidate) => candidate.value === details.value,
    );
    if (selected !== undefined) current.onModeChange(selected.value);
  };

  return (
    <MenuRadioGroup
      value={props.option().mode}
      onValueChange={handleValueChange}
    >
      <For each={renderingModeOptions}>
        {(mode) => {
          const shortcut = () =>
            mode.commandId === undefined
              ? ""
              : formatOptionalHotkeyDisplay(
                  commandHotkey(props.hotkeyBindings(), mode.commandId),
                  props.hotkeyPlatform,
                );

          return (
            <MenuRadioItem
              class="game-menu__item game-menu__option-item"
              closeOnSelect={false}
              disabled={props.option().pending}
              value={mode.value}
            >
              <span class="game-menu__option-content">
                <span class="game-menu__item-label">{mode.label}</span>
                <Show when={shortcut()}>
                  {(displayShortcut) => (
                    <Kbd
                      aria-label={displayShortcut()}
                      class="game-menu__option-shortcut"
                    >
                      <span class="game-menu__option-shortcut-label">
                        {displayShortcut()}
                      </span>
                    </Kbd>
                  )}
                </Show>
              </span>
            </MenuRadioItem>
          );
        }}
      </For>
    </MenuRadioGroup>
  );
}

export function TopNavOptionsMenuContent(
  props: TopNavOptionsMenuInternalProps,
): JSX.Element {
  const gameInteractionDisabled = () =>
    !props.gameLoaded() || !props.playerReady();
  const optionSections = createMemo(() =>
    splitTopNavOptionItems(props.optionItems()),
  );
  const renderingModeMedia = globalThis.matchMedia?.(
    RENDERING_MODE_DRILL_IN_MEDIA_QUERY,
  );
  const [renderingModeUsesDrillIn, setRenderingModeUsesDrillIn] = createSignal(
    renderingModeMedia?.matches ?? false,
  );
  const [renderingModeDrillInOpen, setRenderingModeDrillInOpen] =
    createSignal(false);
  let renderingModeBackItem: HTMLElement | undefined;
  let renderingModeDrillInPage: HTMLDivElement | undefined;
  let renderingModeTrigger: HTMLElement | undefined;
  let optionsMenuWasOpen = false;

  createEffect(() => {
    const menuOpen = props.menuOpen();
    if (menuOpen && !optionsMenuWasOpen) {
      setRenderingModeUsesDrillIn(renderingModeMedia?.matches ?? false);
    }
    optionsMenuWasOpen = menuOpen;

    const renderingMode = optionSections().renderingMode;
    if (
      !menuOpen ||
      !renderingModeUsesDrillIn() ||
      renderingMode?.disabled === true
    ) {
      setRenderingModeDrillInOpen(false);
    }
  });

  const focusRenderingModeDrillIn = (): void => {
    queueMicrotask(() => {
      const selected = renderingModeDrillInPage?.querySelector<HTMLElement>(
        '[data-slot="menu-radio-item"][data-state="checked"]:not([data-disabled])',
      );
      const firstAvailable =
        renderingModeDrillInPage?.querySelector<HTMLElement>(
          '[data-slot="menu-radio-item"]:not([data-disabled])',
        );
      (selected ?? firstAvailable ?? renderingModeBackItem)?.focus({
        preventScroll: true,
      });
    });
  };

  const openRenderingModeDrillIn = (): void => {
    setRenderingModeDrillInOpen(true);
    focusRenderingModeDrillIn();
  };

  const closeRenderingModeDrillIn = (): void => {
    setRenderingModeDrillInOpen(false);
    queueMicrotask(() => {
      renderingModeTrigger?.focus({ preventScroll: true });
    });
  };

  const handleRenderingModeDrillInKeyDown: JSX.EventHandler<
    HTMLDivElement,
    KeyboardEvent
  > = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeRenderingModeDrillIn();
  };

  const renderToggleOption = (option: TopNavToggleOptionItem) => {
    const shortcut = () =>
      formatOptionalHotkeyDisplay(
        optionHotkey(props.hotkeyBindings(), option.id),
        props.hotkeyPlatform,
      );

    return (
      <MenuCheckboxItem
        checked={option.checked}
        class="game-menu__item game-menu__option-item"
        closeOnSelect={false}
        disabled={option.disabled}
        title={shortcut() || undefined}
        onCheckedChange={option.onCheckedChange}
        value={option.id}
      >
        <span class="game-menu__option-content">
          <span class="game-menu__item-label">{option.label}</span>
          <Show when={shortcut()}>
            {(displayShortcut) => (
              <Kbd
                aria-label={displayShortcut()}
                class="game-menu__option-shortcut"
              >
                <span class="game-menu__option-shortcut-label">
                  {displayShortcut()}
                </span>
              </Kbd>
            )}
          </Show>
        </span>
      </MenuCheckboxItem>
    );
  };

  return (
    <>
      <MenuAutofocusAnchor />
      <Show when={!renderingModeDrillInOpen()}>
        <div class="game-menu__options-content">
          <div class="game-options-grid">
            <For each={optionSections().beforeRenderingMode}>
              {renderToggleOption}
            </For>
            {/* Keep the rendering-mode trigger mounted while its value changes. */}
            <Show when={optionSections().renderingMode}>
              {(option) => {
                const renderSummary = () => {
                  const current = option();
                  return (
                    <>
                      <span class="game-menu__item-label">{current.label}</span>
                      <span class="game-menu__item-value">
                        {renderingModeLabel(current.mode)}
                      </span>
                    </>
                  );
                };

                return (
                  <Show
                    when={option().disabled !== true}
                    fallback={
                      <MenuItem
                        class="game-menu__item menu__sub-trigger game-menu__sub-trigger game-menu__rendering-mode-trigger"
                        disabled
                        value={option().id}
                      >
                        {renderSummary()}
                        <Icon icon="chevron_right" class="menu__sub-icon" />
                      </MenuItem>
                    }
                  >
                    <Show
                      when={renderingModeUsesDrillIn()}
                      fallback={
                        <MenuSub
                          closeOnSelect={false}
                          positioning={{ flip: false }}
                        >
                          <MenuSubTrigger class="game-menu__item game-menu__sub-trigger game-menu__rendering-mode-trigger">
                            {renderSummary()}
                          </MenuSubTrigger>
                          <GameMenuSubContent
                            class="game-menu game-menu--rendering-modes"
                            portalMount={props.portalMount}
                          >
                            <RenderingModeMenuItems
                              hotkeyBindings={props.hotkeyBindings}
                              hotkeyPlatform={props.hotkeyPlatform}
                              option={option}
                            />
                          </GameMenuSubContent>
                        </MenuSub>
                      }
                    >
                      <MenuItem
                        ref={(element) => {
                          renderingModeTrigger = element;
                        }}
                        class="game-menu__item menu__sub-trigger game-menu__sub-trigger game-menu__rendering-mode-trigger"
                        closeOnSelect={false}
                        value={option().id}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowRight") return;
                          event.preventDefault();
                          event.stopPropagation();
                          openRenderingModeDrillIn();
                        }}
                        onSelect={openRenderingModeDrillIn}
                      >
                        {renderSummary()}
                        <Icon icon="chevron_right" class="menu__sub-icon" />
                      </MenuItem>
                    </Show>
                  </Show>
                );
              }}
            </Show>
            <For each={optionSections().afterRenderingMode}>
              {renderToggleOption}
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
              <span class="game-menu__field-heading">
                <Label class="game-menu__field-label" for="game-custom-name">
                  Custom Name
                </Label>
                <span class="game-menu__field-actions">
                  <ResetCustomValueButton
                    disabled={
                      gameInteractionDisabled() || !props.customNameConfigured()
                    }
                    label="Reset custom name"
                    onClick={props.handleResetCustomName}
                  />
                </span>
              </span>
              <Input
                disabled={gameInteractionDisabled()}
                fullWidth
                id="game-custom-name"
                size="sm"
                value={props.customName()}
                onBlur={props.handleSetCustomName}
                onKeyDown={commitMenuInputOnEnter(props.handleSetCustomName)}
                onInput={(event) =>
                  props.setCustomName(event.currentTarget.value)
                }
              />
            </div>
            <div
              class="game-menu__field game-menu__identity-field"
              data-disabled={gameInteractionDisabled() ? "" : undefined}
            >
              <span class="game-menu__field-heading">
                <Label class="game-menu__field-label" for="game-custom-guild">
                  Custom Guild
                </Label>
                <span class="game-menu__field-actions">
                  <ResetCustomValueButton
                    disabled={
                      gameInteractionDisabled() ||
                      !props.customGuildConfigured()
                    }
                    label="Reset custom guild"
                    onClick={props.handleResetCustomGuild}
                  />
                </span>
              </span>
              <Input
                disabled={gameInteractionDisabled()}
                fullWidth
                id="game-custom-guild"
                size="sm"
                value={props.customGuild()}
                onBlur={props.handleSetCustomGuild}
                onKeyDown={commitMenuInputOnEnter(props.handleSetCustomGuild)}
                onInput={(event) =>
                  props.setCustomGuild(event.currentTarget.value)
                }
              />
            </div>
          </div>
        </div>
      </Show>
      <Show
        when={
          renderingModeDrillInOpen()
            ? optionSections().renderingMode
            : undefined
        }
      >
        {(option) => (
          <div
            ref={(element) => {
              renderingModeDrillInPage = element;
            }}
            class="game-menu__rendering-mode-page"
            onKeyDown={handleRenderingModeDrillInKeyDown}
          >
            <MenuItem
              ref={(element) => {
                renderingModeBackItem = element;
              }}
              aria-label="Rendering Mode, back to Options"
              class="game-menu__item game-menu__rendering-mode-back"
              closeOnSelect={false}
              value="rendering-mode-back"
              onSelect={closeRenderingModeDrillIn}
            >
              <Icon
                aria-hidden="true"
                class="game-menu__rendering-mode-back-icon"
                icon="arrow_left"
                size="xs"
              />
              <span class="game-menu__item-label">Rendering Mode</span>
            </MenuItem>
            <MenuSeparator />
            <RenderingModeMenuItems
              hotkeyBindings={props.hotkeyBindings}
              hotkeyPlatform={props.hotkeyPlatform}
              option={option}
            />
          </div>
        )}
      </Show>
    </>
  );
}

export function TopNav(props: TopNavProps): JSX.Element {
  let autoReloginMenuContent: HTMLDivElement | undefined;
  let travelMenuContent: HTMLDivElement | undefined;
  const [menuPortalMount, setMenuPortalMount] = createSignal<HTMLDivElement>();
  const [autoReloginServerMenuOpen, setAutoReloginServerMenuOpen] =
    createSignal(false);
  const [travelHighlightedValue, setTravelHighlightedValue] = createSignal<
    string | null
  >(null);

  const handleToggleScriptClick = (): void => {
    void props.toggleScript();
  };
  const scriptToggleDisabled = (): boolean =>
    !props.scriptLoaded() ||
    props.scriptTogglePending() ||
    (!props.scriptRunning() && !props.scriptOptionsReady());

  const autoReloginNeedsAttention = (): boolean =>
    props.autoReloginLastError() !== "";
  const autoReloginAwaitingSession = (): boolean =>
    props.autoReloginEnabled() && !props.autoReloginCaptured();

  const autoReloginAttemptsRemainingLabel = (): string => {
    const remaining = props.autoReloginAttemptsRemaining();
    if (remaining === null) return "";
    if (remaining <= 0) return "final attempt";
    return `${remaining} ${remaining === 1 ? "retry" : "retries"} left`;
  };

  const autoReloginTriggerLabel = (): string => {
    if (props.autoReloginToggling()) {
      return props.autoReloginEnabled()
        ? "Auto Relogin enabling"
        : "Auto Relogin disabling";
    }

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

  const autoReloginActivity = (): "waiting" | "reconnecting" | undefined => {
    if (props.autoReloginToggling() || props.autoReloginAttempting()) {
      return "reconnecting";
    }

    return props.autoReloginWaitingDelay() || autoReloginAwaitingSession()
      ? "waiting"
      : undefined;
  };

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

  const selectedAutoAttackProfile = (): TopNavCombatProfile | undefined =>
    props
      .combatProfiles()
      .find((profile) => profile.id === props.selectedAutoAttackProfileId());

  const autoAttackProfileRole = (): string =>
    selectedAutoAttackProfile()?.role.trim() ?? "";

  const autoAttackTriggerLabel = (): string => {
    const profileLabel = autoAttackTriggerText();
    const error = props.autoAttackLastError();
    let label: string;

    if (error !== "") {
      label = `Auto Attack failed: ${error}`;
    } else if (!props.autoAttackEnabled()) {
      label =
        profileLabel === ""
          ? "Auto Attack disabled"
          : `Auto Attack disabled: ${profileLabel}`;
    } else {
      label =
        profileLabel === ""
          ? "Auto Attack enabled"
          : `Auto Attack enabled: ${profileLabel}`;
    }

    const role = autoAttackProfileRole();
    return role === "" ? label : `${label}; role: ${role}`;
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
      return "None";
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

  const setTravelMenuOpen = (details: { readonly open: boolean }): void => {
    if (details.open && props.openMenu() !== "travel") {
      props.handleRefreshTravelOptions();
    }
    if (!details.open) {
      setTravelHighlightedValue(null);
    }
    props.setOpenMenu(details.open ? "travel" : null);
  };

  const toggleTravelMenu: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (
    event,
  ) => {
    event.preventDefault();
    if (travelInteractionBlocked()) {
      return;
    }

    setTravelMenuOpen({ open: props.openMenu() !== "travel" });
  };

  const isValidPad = (pad: string) =>
    props
      .validPads()
      .some((validPad) => validPad.toLowerCase() === pad.toLowerCase());

  type TravelColumn = "cell" | "pad";

  const travelColumnValues = (column: TravelColumn): readonly string[] =>
    column === "cell"
      ? props.cells().map((cell) => `cell:${cell}`)
      : props.pads().map((pad) => `pad:${pad}`);

  const travelHighlightedColumn = (): TravelColumn | null => {
    const value = travelHighlightedValue();
    if (value?.startsWith("cell:")) return "cell";
    if (value?.startsWith("pad:")) return "pad";
    return null;
  };

  const highlightTravelItem = (value: string | null): void => {
    setTravelHighlightedValue(value);
    if (value === null) return;

    const item = Array.from(
      travelMenuContent?.querySelectorAll<HTMLElement>(
        "[data-slot='menu-item']",
      ) ?? [],
    ).find((candidate) => candidate.dataset["value"] === value);
    item?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const handleTravelMenuKeyDown: JSX.EventHandler<
    HTMLDivElement,
    KeyboardEvent
  > = (event) => {
    if (
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Tab"
    ) {
      return;
    }

    if (event.key === "Tab") {
      const values = [
        ...travelColumnValues("cell"),
        ...travelColumnValues("pad"),
      ];
      if (values.length === 0) return;

      event.preventDefault();
      event.stopPropagation();

      const currentIndex = values.indexOf(travelHighlightedValue() ?? "");
      const nextIndex =
        currentIndex === -1
          ? event.shiftKey
            ? values.length - 1
            : 0
          : (currentIndex + (event.shiftKey ? -1 : 1) + values.length) %
            values.length;
      highlightTravelItem(values[nextIndex] ?? null);
      return;
    }

    const currentColumn = travelHighlightedColumn();
    const targetColumn =
      event.key === "ArrowLeft"
        ? "cell"
        : event.key === "ArrowRight"
          ? "pad"
          : (currentColumn ?? "cell");
    const targetValues = travelColumnValues(targetColumn);
    if (targetValues.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const currentValue = travelHighlightedValue();
      const currentIndex = targetValues.indexOf(currentValue ?? "");
      const nextIndex =
        currentIndex === -1
          ? event.key === "ArrowUp"
            ? targetValues.length - 1
            : 0
          : (currentIndex +
              (event.key === "ArrowUp" ? -1 : 1) +
              targetValues.length) %
            targetValues.length;
      highlightTravelItem(targetValues[nextIndex] ?? null);
      return;
    }

    if (currentColumn === targetColumn) {
      return;
    }

    const sourceValues =
      currentColumn === null ? [] : travelColumnValues(currentColumn);
    const sourceIndex = sourceValues.indexOf(travelHighlightedValue() ?? "");
    highlightTravelItem(
      targetValues[
        Math.min(Math.max(sourceIndex, 0), targetValues.length - 1)
      ] ?? null,
    );
  };

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
            props.openMenu() !== null && props.openMenu() !== "travel"
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
              class="game-menu game-menu--windows"
              portalMount={menuPortalMount}
            >
              <For each={gameWindowItems}>
                {(item, index) => (
                  <>
                    <Show when={index() === 1}>
                      <MenuSeparator />
                    </Show>
                    <MenuItem
                      class="game-menu__item"
                      onSelect={() => props.handleOpenWindow(item.id)}
                      value={item.id}
                    >
                      <span class="game-menu__item-label">{item.label}</span>
                      <Show
                        when={formatOptionalHotkeyDisplay(
                          windowHotkey(props.hotkeyBindings(), item.id),
                          props.hotkeyPlatform,
                        )}
                      >
                        {(shortcut) => <Kbd>{shortcut()}</Kbd>}
                      </Show>
                    </MenuItem>
                  </>
                )}
              </For>
            </GameMenuContent>
          </Menu>

          <Button
            class="game-topnav__trigger"
            onClick={() => props.openScripts()}
            size="sm"
            variant="ghost"
          >
            Scripts
          </Button>

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
              <TopNavOptionsMenuContent
                {...props}
                menuOpen={() => props.openMenu() === "options"}
                portalMount={menuPortalMount}
              />
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
                class="game-menu__item game-menu__switch-item"
                closeOnSelect={false}
                onClick={props.handleToggleAutoZone}
                value="toggle-autozone"
              >
                <span class="game-menu__item-label">Auto Zone</span>
                <span
                  aria-hidden="true"
                  class="game-menu__switch-visual"
                  data-checked={props.autoZoneEnabled() ? "" : undefined}
                >
                  <span class="game-menu__switch-thumb" />
                </span>
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
                aria-hidden="true"
                class="game-topnav__relogin-indicator"
                data-phase={autoReloginActivity()}
              >
                <Show when={autoReloginActivity()}>
                  {(activity) => (
                    <Icon
                      class="game-topnav__relogin-indicator-icon"
                      icon={
                        activity() === "waiting" ? "clock" : "loader_circle"
                      }
                      size="xs"
                    />
                  )}
                </Show>
              </span>
              <span class="game-topnav__relogin-label">Auto Relogin</span>
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
                class="game-menu__item game-menu__switch-item"
                closeOnSelect={false}
                disabled={props.autoReloginToggling()}
                onClick={props.handleToggleAutoRelogin}
                value="toggle-autorelogin"
              >
                <span class="game-menu__item-label">Auto Relogin</span>
                <span
                  aria-hidden="true"
                  class="game-menu__switch-visual"
                  data-checked={props.autoReloginEnabled() ? "" : undefined}
                >
                  <span class="game-menu__switch-thumb" />
                </span>
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
            props.openMenu() === "combat" || props.openMenu() === "travel"
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
              <Show when={autoAttackProfileRole()}>
                {(role) => (
                  <span class="game-topnav__trigger-detail">{role()}</span>
                )}
              </Show>
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
                >
                  <span class="game-menu__switch-thumb" />
                </span>
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
                class="game-menu__profile-list"
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
                      <span class="game-menu__item-label game-menu__profile-heading">
                        <span class="game-menu__profile-label">
                          {profile.label}
                        </span>
                        <span class="game-menu__profile-role">
                          {combatProfileRole(profile)}
                        </span>
                      </span>
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
            highlightedValue={travelHighlightedValue()}
            open={props.openMenu() === "travel"}
            onHighlightChange={(details) =>
              setTravelHighlightedValue(details.highlightedValue)
            }
            onOpenChange={setTravelMenuOpen}
          >
            <TopNavMenuTrigger
              aria-label={`Travel, cell ${props.selectedCell() || "unknown"}, pad ${props.selectedPad() || "unknown"}`}
              aria-busy={props.travelBusy() ? "true" : undefined}
              class="game-topnav__select-trigger game-topnav__select-trigger--travel"
              disabled={travelUnavailable()}
              expanded={props.openMenu() === "travel"}
              onClick={toggleTravelMenu}
              variant="secondary"
            >
              <span class="game-topnav__select-label game-topnav__travel-label">
                {props.selectedCell() || "Cell"}
              </span>
              <span aria-hidden="true" class="game-topnav__travel-divider" />
              <span class="game-topnav__trigger-detail game-topnav__travel-label">
                {props.selectedPad() || "Pad"}
              </span>
              <Icon
                icon="chevron_down"
                aria-hidden="true"
                class="game-topnav__select-chevron"
              />
            </TopNavMenuTrigger>
            <GameMenuContent
              ref={(element) => {
                travelMenuContent = element;
              }}
              class="game-menu game-menu--travel"
              onKeyDown={handleTravelMenuKeyDown}
              portalMount={menuPortalMount}
            >
              <div class="game-menu__travel-columns">
                <MenuGroup class="game-menu__travel-column">
                  <MenuLabel class="game-menu__travel-heading">Cell</MenuLabel>
                  <div class="game-menu__travel-options">
                    <Show
                      when={props.cells().length > 0}
                      fallback={
                        <MenuItem
                          class="game-menu__item"
                          disabled
                          value="cell:none"
                        >
                          No cells found
                        </MenuItem>
                      }
                    >
                      <For each={props.cells()}>
                        {(cell) => (
                          <MenuItem
                            class="game-menu__item"
                            onSelect={() => props.handleSelectCell(cell)}
                            value={`cell:${cell}`}
                          >
                            {cell}
                          </MenuItem>
                        )}
                      </For>
                    </Show>
                  </div>
                </MenuGroup>
                <MenuGroup class="game-menu__travel-column">
                  <MenuLabel class="game-menu__travel-heading">Pad</MenuLabel>
                  <div class="game-menu__travel-options">
                    <Show
                      when={props.pads().length > 0}
                      fallback={
                        <MenuItem
                          class="game-menu__item"
                          disabled
                          value="pad:none"
                        >
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
                            value={`pad:${pad}`}
                          >
                            <span class="game-menu__pad-name">{pad}</span>
                          </MenuItem>
                        )}
                      </For>
                    </Show>
                  </div>
                </MenuGroup>
              </div>
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
