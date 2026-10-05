import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  ColorPicker,
  HelpTooltip,
  Icon,
  Input,
  Slider,
  SliderValue,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipIconButton,
  TooltipTrigger,
  type IconName,
  type TooltipProps,
} from "@lucent/ui";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type JSX,
} from "solid-js";
import {
  SETTING_COMMAND_CATEGORIES,
  SETTINGS_COMMANDS,
  formatHotkeyDisplay as displayHotkey,
  normalizeHotkeyBindingValue,
  readHotkeyBinding,
  type HotkeyBinding,
  type HotkeysPatch,
  type SettingsCommandCategory as CommandCategory,
  type SettingsCommandDefinition as CommandDefinition,
  type SettingsCommandId as GameCommandId,
} from "@lucent/core/hotkeys";
import { readHotkeyInputFromEvent } from "../../../shared/hotkeys";
import { hexToRgb, rgbEquals, rgbToHex } from "@lucent/core/appearance";
import {
  selectDesktopBridge,
  type AppPlatform,
} from "../../../shared/desktopBridge";
import {
  DEFAULT_APP_SETTINGS,
  THEME_FONT_MAX_LENGTH,
  THEME_FONT_SIZE_MAX,
  THEME_FONT_SIZE_MIN,
  THEME_TOKEN_NAMES,
  type AppSettings,
  type AppearancePatch,
  type MotionMode,
  type PreferencesPatch,
  type ThemeMode,
  type ThemeProfile,
  type ThemeProfilePatch,
  type ThemeRgb,
  type ThemeTokenName,
  type ThemeVariant,
} from "@lucent/core/settings";
import type { UpdateCheckState } from "../../../shared/updates";
import { MAX_GAME_VIEWS_PER_WINDOW } from "../../../shared/gameViews";
import {
  findConflictingCommands,
  groupCommandsByShortcut,
} from "./hotkeyConflicts";
import { THEME_COLOR_ROWS, themeTokenLabel } from "./themeColors";

type HotkeyBindings = readonly HotkeyBinding[];
type HotkeyListSegment =
  | {
      readonly type: "command";
      readonly command: CommandDefinition;
    }
  | {
      readonly type: "group";
      readonly label: NonNullable<CommandDefinition["group"]>;
      readonly commands: readonly CommandDefinition[];
    };

const defaultSettings: AppSettings = DEFAULT_APP_SETTINGS;
const DEFAULT_THEME_PROFILES = DEFAULT_APP_SETTINGS.appearance.themes;
const GAME_COMMANDS = SETTINGS_COMMANDS;

const segmentHotkeyCommands = (
  commands: readonly CommandDefinition[],
): readonly HotkeyListSegment[] => {
  const segments: HotkeyListSegment[] = [];

  for (const command of commands) {
    if (command.group === undefined) {
      segments.push({ type: "command", command });
      continue;
    }

    const previous = segments.at(-1);
    if (previous?.type === "group" && previous.label === command.group) {
      segments[segments.length - 1] = {
        ...previous,
        commands: [...previous.commands, command],
      };
      continue;
    }

    segments.push({
      type: "group",
      label: command.group,
      commands: [command],
    });
  }

  return segments;
};

export type SettingsTabId = "general" | "hotkeys" | "appearance";

export interface SettingsViewFixture {
  readonly activeTab?: SettingsTabId;
  readonly error?: string;
  readonly settings: AppSettings;
  readonly updateState?: UpdateCheckState;
}

export interface SettingsViewProps {
  readonly fixture: SettingsViewFixture;
  readonly getSettings?: () => Promise<AppSettings>;
  readonly getUpdateState?: () => Promise<UpdateCheckState>;
  readonly onAppearancePatch?: (patch: AppearancePatch) => Promise<AppSettings>;
  readonly onCheckForUpdates?: () => Promise<UpdateCheckState>;
  readonly onHotkeysPatch?: (patch: HotkeysPatch) => Promise<AppSettings>;
  readonly onOpenReleasePage?: () => Promise<boolean>;
  readonly onPreferencesPatch?: (
    patch: PreferencesPatch,
  ) => Promise<AppSettings>;
  readonly onResetHotkeys?: () => Promise<AppSettings>;
  readonly onSettingsChanged?: (
    listener: (settings: AppSettings) => void,
  ) => () => void;
  readonly onUpdatesChanged?: (
    listener: (state: UpdateCheckState) => void,
  ) => () => void;
  readonly platform: AppPlatform;
}

const settingsTabs: ReadonlyArray<{
  readonly label: string;
  readonly value: SettingsTabId;
}> = [
  { label: "General", value: "general" },
  { label: "Hotkeys", value: "hotkeys" },
  { label: "Appearance", value: "appearance" },
];

const defaultTooltipProps = {
  closeDelay: 0,
  openDelay: 200,
  positioning: { placement: "top" },
} satisfies TooltipProps;

const themeModes: ReadonlyArray<{
  readonly label: string;
  readonly value: ThemeMode;
}> = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System", value: "system" },
];

const themeVariants: ReadonlyArray<{
  readonly label: string;
  readonly value: ThemeVariant;
}> = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const themeVariantForMode = (mode: ThemeMode): ThemeVariant => {
  if (mode === "light" || mode === "dark") {
    return mode;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const motionModes: ReadonlyArray<{
  readonly label: string;
  readonly value: MotionMode;
}> = [
  { label: "System", value: "system" },
  { label: "On", value: "on" },
  { label: "Off", value: "off" },
];

const launchModes = [
  { label: "Game", value: "game" },
  { label: "Account Manager", value: "account-manager" },
] as const;

const commandCategories: readonly CommandCategory[] =
  SETTING_COMMAND_CATEGORIES;

const parseFontSize = (text: string): number | undefined => {
  const size = Number(text);
  return text.trim() === "" || !Number.isFinite(size)
    ? undefined
    : clampFontSize(size);
};

const allowLineBreakAfterEachPlus = (shortcut: string): string =>
  shortcut.split("+").join("+\u200B");

const clampFontSize = (value: number): number =>
  Math.min(
    THEME_FONT_SIZE_MAX,
    Math.max(THEME_FONT_SIZE_MIN, Math.round(value)),
  );

const isThemeProfileDefault = (
  profile: ThemeProfile,
  defaults: ThemeProfile,
): boolean =>
  profile.sansFont === defaults.sansFont &&
  profile.monoFont === defaults.monoFont &&
  profile.sansFontSize === defaults.sansFontSize &&
  profile.monoFontSize === defaults.monoFontSize &&
  profile.rounding === defaults.rounding &&
  THEME_TOKEN_NAMES.every((name) =>
    rgbEquals(profile.tokens[name], defaults.tokens[name]),
  );

const initialUpdateState = (settings: AppSettings): UpdateCheckState => ({
  status: settings.preferences.checkForUpdates ? "idle" : "disabled",
  currentVersion: "0.0.0",
  reason: "Update checks are disabled.",
});

const normalizeUpdateStateForPreferences = (
  state: UpdateCheckState,
  nextSettings: AppSettings,
): UpdateCheckState => {
  if (
    !nextSettings.preferences.checkForUpdates &&
    state.status !== "disabled"
  ) {
    return {
      status: "disabled",
      currentVersion: state.currentVersion,
      reason: "Update checks are disabled.",
    };
  }

  if (nextSettings.preferences.checkForUpdates && state.status === "disabled") {
    return {
      status: "idle",
      currentVersion: state.currentVersion,
    };
  }

  return state;
};

const updateStatusText = (state: UpdateCheckState): string => {
  switch (state.status) {
    case "idle":
      return "No update check has run yet.";
    case "disabled":
      return state.reason;
    case "checking":
      return "Checking for updates…";
    case "current":
      return `Lucent ${state.currentVersion} is current.`;
    case "available":
      return `Lucent ${state.latestVersion} is available. You have ${state.currentVersion}.`;
    case "error":
      return state.message;
  }
};

const updateStatusIcon = (state: UpdateCheckState): IconName => {
  switch (state.status) {
    case "current":
      return "circle_check";
    case "available":
      return "download";
    case "error":
      return "circle_alert";
    default:
      return "info";
  }
};

const errorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback;

const isInteractiveTarget = (target: EventTarget | null): boolean =>
  !(target instanceof Element) ||
  target.closest("a, button, input, label, select, textarea") !== null;

function SettingsSection(props: {
  readonly children?: JSX.Element;
  readonly class?: string;
  readonly control?: JSX.Element;
  readonly description?: string;
  readonly id: string;
  readonly onHeadingClick?: () => void;
  readonly title: string;
  readonly titleAccessory?: JSX.Element;
}): JSX.Element {
  const headingId = () => `settings-section-${props.id}`;
  return (
    <section
      class={
        props.class ? `settings-section ${props.class}` : "settings-section"
      }
      aria-labelledby={headingId()}
    >
      <div
        class="settings-section__heading"
        data-toggle={props.onHeadingClick === undefined ? undefined : ""}
        onClick={(event) => {
          if (
            props.onHeadingClick !== undefined &&
            !isInteractiveTarget(event.target)
          ) {
            props.onHeadingClick();
          }
        }}
      >
        <div class="settings-section__label">
          <div class="settings-section__title-line">
            <h2 id={headingId()} class="settings-section__title">
              {props.title}
            </h2>
            {props.titleAccessory}
          </div>
          <Show when={props.description}>
            {(description) => (
              <p class="settings-section__description">{description()}</p>
            )}
          </Show>
        </div>
        <Show when={props.control}>
          {(control) => (
            <div class="settings-section__control">{control()}</div>
          )}
        </Show>
      </div>
      {props.children}
    </section>
  );
}

function SwitchSection(props: {
  readonly checked: boolean;
  readonly children?: JSX.Element;
  readonly description: string;
  readonly id: string;
  readonly onChange: (checked: boolean) => Promise<void>;
  readonly title: string;
  readonly titleAccessory?: JSX.Element;
}): JSX.Element {
  let input!: HTMLInputElement;

  createEffect(() => {
    input.checked = props.checked;
  });

  return (
    <SettingsSection
      id={props.id}
      title={props.title}
      titleAccessory={props.titleAccessory}
      description={props.description}
      onHeadingClick={() => input.click()}
      control={
        <Switch
          ref={(element: HTMLInputElement) => {
            input = element;
          }}
          size="sm"
          class="settings-section__switch"
          aria-label={props.title}
          onChange={(event) => void props.onChange(event.currentTarget.checked)}
        />
      }
    >
      {props.children}
    </SettingsSection>
  );
}

function FieldLabel(props: {
  readonly accessory?: JSX.Element;
  readonly children: string;
  readonly for?: string;
  readonly id?: string;
}): JSX.Element {
  return (
    <span class="settings-label">
      <label for={props.for} id={props.id}>
        {props.children}
      </label>
      {props.accessory}
    </span>
  );
}

function IssueAlert(props: { readonly message: string }): JSX.Element {
  return (
    <Alert class="settings-issue" role="alert" variant="error">
      <AlertDescription class="settings-issue__message">
        <Icon icon="circle_alert" aria-hidden="true" />
        <span>{props.message}</span>
      </AlertDescription>
    </Alert>
  );
}

function ConfirmDialog(props: {
  readonly confirmLabel: string;
  readonly description: string;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly title: string;
}): JSX.Element {
  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(details) => props.onOpenChange(details.open)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => props.onConfirm()}
          >
            {props.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function HotkeyConflictPill(props: {
  readonly conflicts: readonly string[];
}): JSX.Element {
  const count = () => props.conflicts.length;
  const label = () =>
    count() === 1 ? "Shortcut conflict" : `${count()} shortcut conflicts`;

  return (
    <Tooltip
      {...defaultTooltipProps}
      interactive={false}
      openDelay={150}
      unmountOnExit
    >
      <TooltipTrigger
        asChild={(tooltipTriggerProps) => (
          <button
            {...tooltipTriggerProps({
              "aria-label": `${label()}: ${props.conflicts.join(", ")}`,
              class: "settings-hotkey__conflict",
              type: "button",
            } as JSX.HTMLAttributes<HTMLButtonElement>)}
          >
            <Icon icon="circle_alert" size="md" class="button__icon" />
            {count()}
          </button>
        )}
      />
      <TooltipContent class="settings-hotkey__conflict-tooltip">
        <span class="settings-hotkey__conflict-tooltip-title">
          Also used by
        </span>
        <span class="settings-hotkey__conflict-tooltip-body">
          {props.conflicts.join(", ")}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function SegmentedControl<T extends string>(props: {
  readonly "aria-label": string;
  readonly options: ReadonlyArray<{
    readonly label: string;
    readonly value: T;
  }>;
  readonly value: T;
  readonly onChange: (value: T) => void;
}): JSX.Element {
  return (
    <Tabs
      class="settings-segmented"
      onValueChange={(details) => props.onChange(details.value as T)}
      value={props.value}
    >
      <TabsList
        aria-label={props["aria-label"]}
        class="settings-segmented__list"
      >
        <For each={props.options}>
          {(option) => (
            <TabsTrigger
              class="settings-segmented__trigger"
              value={option.value}
            >
              {option.label}
            </TabsTrigger>
          )}
        </For>
      </TabsList>
    </Tabs>
  );
}

function RestoreDefaultButton(props: {
  readonly "aria-label": string;
  readonly onClick: () => void;
  readonly tooltip: string;
}): JSX.Element {
  return (
    <TooltipIconButton
      aria-label={props["aria-label"]}
      class="settings-restore"
      size="icon-xs"
      onClick={() => props.onClick()}
      tooltip={props.tooltip}
    >
      <Icon icon="rotate_ccw" class="button__icon" />
    </TooltipIconButton>
  );
}

function RoundingSlider(props: {
  readonly "aria-labelledby": string;
  readonly value: number;
  readonly onCommit: (value: number) => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = createSignal(props.value);
  const [dragging, setDragging] = createSignal(false);

  createEffect(() => {
    const saved = props.value;
    if (!untrack(dragging)) {
      setDraft(saved);
    }
  });

  return (
    <Slider
      aria-labelledby={[props["aria-labelledby"]]}
      class="settings-rounding"
      max={2}
      min={0}
      onValueChange={(details) => {
        setDragging(true);
        setDraft(details.value[0] ?? draft());
      }}
      onValueChangeEnd={(details) => {
        setDragging(false);
        void props.onCommit(details.value[0] ?? draft());
      }}
      step={0.05}
      value={[draft()]}
    >
      <SliderValue>{draft().toFixed(2)}</SliderValue>
    </Slider>
  );
}

function FontInput(props: {
  readonly id: string;
  readonly value: string;
  readonly onCommit: (value: string) => Promise<void>;
}): JSX.Element {
  let input!: HTMLInputElement;
  const isEditing = () => document.activeElement === input;

  createEffect(() => {
    const saved = props.value;
    if (!isEditing()) {
      input.value = saved;
    }
  });

  const commit = (): void => {
    const font = input.value.trim();
    if (font === "") {
      input.value = props.value;
      return;
    }
    void props.onCommit(font);
  };

  return (
    <Input
      ref={(element: HTMLInputElement) => {
        input = element;
      }}
      id={props.id}
      class="settings-font-input"
      autocomplete="off"
      maxLength={THEME_FONT_MAX_LENGTH}
      spellcheck={false}
      onChange={commit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          input.value = props.value;
          input.blur();
        }
      }}
    />
  );
}

function FontSizeInput(props: {
  readonly "aria-label": string;
  readonly id: string;
  readonly value: number;
  readonly onCommit: (value: number) => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = createSignal(String(props.value));
  const [editing, setEditing] = createSignal(false);
  const [pendingSaves, setPendingSaves] = createSignal(0);

  createEffect(() => {
    const saved = String(props.value);
    if (!editing() && pendingSaves() === 0) {
      setDraft(saved);
    }
  });

  const commit = (): void => {
    const size = parseFontSize(draft());
    if (size === undefined) {
      setDraft(String(props.value));
      return;
    }
    setDraft(String(size));
    setPendingSaves((count) => count + 1);
    void props.onCommit(size).finally(() => {
      setPendingSaves((count) => count - 1);
    });
  };

  return (
    <div class="settings-number">
      <Input
        aria-label={props["aria-label"]}
        id={props.id}
        class="settings-number__input"
        max={THEME_FONT_SIZE_MAX}
        min={THEME_FONT_SIZE_MIN}
        onBlur={() => setEditing(false)}
        onChange={commit}
        onFocus={() => setEditing(true)}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setDraft(String(props.value));
            event.currentTarget.blur();
          }
        }}
        step={1}
        type="number"
        value={draft()}
      />
      <span class="settings-number__unit" aria-hidden="true">
        px
      </span>
    </div>
  );
}

function ThemeColor(props: {
  readonly defaultValue: ThemeRgb;
  readonly name: ThemeTokenName;
  readonly value: ThemeRgb;
  readonly onChange: (value: ThemeRgb) => Promise<void>;
  readonly onReset: () => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = createSignal(rgbToHex(props.value));

  createEffect(() => {
    setDraft(rgbToHex(props.value));
  });

  const commit = (hex: string): void => {
    setDraft(hex);
    const rgb = hexToRgb(hex);
    if (rgb !== null) {
      void props.onChange(rgb);
    }
  };

  return (
    <div class="settings-color">
      <ColorPicker
        aria-label={`${themeTokenLabel(props.name)} color`}
        onChange={(event) => commit(event.currentTarget.value)}
        onInput={(event) => setDraft(event.currentTarget.value)}
        value={draft()}
      />
      <Show
        when={!rgbEquals(props.value, props.defaultValue)}
        fallback={<span class="settings-color__spacer" />}
      >
        <RestoreDefaultButton
          aria-label={`Restore default ${themeTokenLabel(props.name)} color`}
          onClick={() => void props.onReset()}
          tooltip="Restore default"
        />
      </Show>
    </div>
  );
}

function UpdateStatus(props: {
  readonly checking: boolean;
  readonly onCheckForUpdates: () => void;
  readonly onOpenReleasePage: () => void;
  readonly state: UpdateCheckState;
}): JSX.Element {
  const hasReleasePage = () =>
    props.state.status === "available" &&
    props.state.release.htmlUrl.length > 0;

  return (
    <div class="settings-update" data-status={props.state.status}>
      <p class="settings-update__status" aria-live="polite">
        <Show
          when={props.checking}
          fallback={
            <Icon
              icon={updateStatusIcon(props.state)}
              aria-hidden="true"
              class="settings-update__icon"
            />
          }
        >
          <Spinner class="settings-update__icon" size="sm" />
        </Show>
        <span>{updateStatusText(props.state)}</span>
      </p>
      <Show
        when={hasReleasePage()}
        fallback={
          <Button
            class="settings-quiet-action"
            disabled={props.checking}
            onClick={() => props.onCheckForUpdates()}
            size="xs"
            variant="ghost"
          >
            Check now
          </Button>
        }
      >
        <Button onClick={() => props.onOpenReleasePage()} size="xs">
          Open release page
          <Icon icon="arrow_up_right" class="button__icon" />
        </Button>
      </Show>
    </div>
  );
}

function GeneralSettings(props: {
  readonly settings: AppSettings;
  readonly onPreferencesPatch: (patch: PreferencesPatch) => Promise<void>;
  readonly updateState: UpdateCheckState;
  readonly checking: boolean;
  readonly onCheckForUpdates: () => void;
  readonly onOpenReleasePage: () => void;
}): JSX.Element {
  return (
    <>
      <SwitchSection
        id="updates"
        title="Check for updates"
        description="Check for a new version when Lucent starts."
        checked={props.settings.preferences.checkForUpdates}
        onChange={(checkForUpdates) =>
          props.onPreferencesPatch({ checkForUpdates })
        }
      >
        <UpdateStatus
          checking={props.checking}
          onCheckForUpdates={props.onCheckForUpdates}
          onOpenReleasePage={props.onOpenReleasePage}
          state={props.updateState}
        />
      </SwitchSection>
      <SettingsSection
        id="launch-mode"
        title="Launch mode"
        description="Choose which window opens when Lucent starts."
        control={
          <SegmentedControl
            aria-label="Launch mode"
            onChange={(launchMode) =>
              void props.onPreferencesPatch({ launchMode })
            }
            options={launchModes}
            value={props.settings.preferences.launchMode}
          />
        }
      />
      <SwitchSection
        id="game-tabs"
        title="Use game tabs"
        description={`Open up to ${MAX_GAME_VIEWS_PER_WINDOW} tabs in one window. Existing windows are unchanged.`}
        titleAccessory={
          <HelpTooltip
            aria-label="About game tabs memory use"
            tooltip="Each additional tab starts another Flash process and increases memory use."
          />
        }
        checked={props.settings.preferences.useGameTabs}
        onChange={(useGameTabs) => props.onPreferencesPatch({ useGameTabs })}
      />
      <SwitchSection
        id="window-titles"
        title="Show username in game window titles"
        description="Add the logged-in username to each game window's title. With tabs, the title follows the selected tab."
        checked={props.settings.preferences.showGameUsernameInWindowTitle}
        onChange={(showGameUsernameInWindowTitle) =>
          props.onPreferencesPatch({ showGameUsernameInWindowTitle })
        }
      />
    </>
  );
}

const readHotkey = (bindings: HotkeyBindings, id: GameCommandId): string =>
  readHotkeyBinding(bindings, id);

const areHotkeysDefault = (bindings: HotkeyBindings): boolean =>
  GAME_COMMANDS.every(
    (command) => readHotkey(bindings, command.id) === command.defaultHotkey,
  );

function HotkeySettings(props: {
  readonly active: boolean;
  readonly platform: AppPlatform;
  readonly settings: AppSettings;
  readonly onHotkeysPatch: (patch: HotkeysPatch) => Promise<void>;
}): JSX.Element {
  const [recordingId, setRecordingId] = createSignal<GameCommandId | null>(
    null,
  );
  const [localError, setLocalError] = createSignal<{
    readonly commandId: GameCommandId;
    readonly id: number;
    readonly message: string;
  } | null>(null);
  let nextLocalErrorId = 0;

  const commandsByShortcut = createMemo(() =>
    groupCommandsByShortcut(props.settings.hotkeys.bindings, props.platform),
  );

  const getConflictingLabels = (
    id: GameCommandId,
    value: string,
  ): readonly string[] =>
    findConflictingCommands(
      commandsByShortcut(),
      id,
      value,
      props.platform,
    ).map((command) => command.label);

  const showLocalError = (commandId: GameCommandId, message: string): void => {
    setLocalError({ commandId, id: ++nextLocalErrorId, message });
  };

  const commitBinding = async (
    id: GameCommandId,
    value: string | null,
  ): Promise<void> => {
    const definition = GAME_COMMANDS.find((command) => command.id === id);

    if (value !== null) {
      const normalized = normalizeHotkeyBindingValue(value);
      if (normalized === null) {
        showLocalError(id, "That shortcut is not valid.");
        return;
      }

      const conflicts = getConflictingLabels(id, normalized);
      if (conflicts.length > 0) {
        showLocalError(id, `Already assigned to ${conflicts.join(", ")}.`);
        return;
      }

      await props.onHotkeysPatch({
        bindings: [{ id, value: normalized }],
      });
      setLocalError(null);
      return;
    }

    const defaultValue = definition?.defaultHotkey ?? "";
    const conflicts = getConflictingLabels(id, defaultValue);
    if (conflicts.length > 0) {
      showLocalError(
        id,
        `Default is already assigned to ${conflicts.join(", ")}.`,
      );
      return;
    }

    await props.onHotkeysPatch({
      bindings: [{ id, value: null }],
    });
    setLocalError(null);
  };

  createEffect(() => {
    if (!props.active) {
      setRecordingId(null);
    }
  });

  createEffect(() => {
    const activeId = recordingId();
    if (activeId === null) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setLocalError(null);
        setRecordingId(null);
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        setRecordingId(null);
        void commitBinding(activeId, "");
        return;
      }

      const normalized = normalizeHotkeyBindingValue(
        readHotkeyInputFromEvent(event),
      );
      if (normalized === null || normalized === "") {
        showLocalError(activeId, "Press a complete shortcut.");
        return;
      }

      setRecordingId(null);
      void commitBinding(activeId, normalized);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });

    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    });
  });

  const renderHotkeyRow = (command: CommandDefinition) => {
    const value = () => readHotkey(props.settings.hotkeys.bindings, command.id);
    const conflicts = () => getConflictingLabels(command.id, value());
    const isRecording = () => recordingId() === command.id;
    const displayValue = () => displayHotkey(value(), props.platform);
    const rowError = () => {
      const error = localError();
      return error?.commandId === command.id ? error : undefined;
    };
    const hintId = `settings-hotkey-hint-${command.id}`;

    return (
      <li
        class="settings-hotkey"
        data-conflict={conflicts().length > 0 ? "" : undefined}
      >
        <div class="settings-hotkey__main">
          <div class="settings-hotkey__title">
            <span class="settings-hotkey__label">{command.label}</span>
            <Show when={conflicts().length > 0}>
              <HotkeyConflictPill conflicts={conflicts()} />
            </Show>
          </div>
          <div class="settings-hotkey__controls">
            <button
              type="button"
              class="settings-hotkey__binding"
              aria-describedby={isRecording() ? hintId : undefined}
              aria-label={
                isRecording()
                  ? `Recording shortcut for ${command.label}`
                  : `Change shortcut for ${command.label}, currently ${
                      value() === "" ? "not set" : displayValue()
                    }`
              }
              aria-pressed={isRecording()}
              data-empty={value() === "" ? "" : undefined}
              onBlur={() => {
                if (isRecording()) {
                  setRecordingId(null);
                }
              }}
              onClick={() => {
                setLocalError(null);
                setRecordingId(isRecording() ? null : command.id);
              }}
            >
              <Show
                when={!isRecording()}
                fallback={
                  <span class="settings-hotkey__placeholder">Press keys…</span>
                }
              >
                <Show
                  when={value() !== ""}
                  fallback={
                    <span class="settings-hotkey__placeholder">Not set</span>
                  }
                >
                  <span class="settings-hotkey__value">
                    {allowLineBreakAfterEachPlus(displayValue())}
                  </span>
                </Show>
              </Show>
            </button>
            <Show
              when={
                command.defaultHotkey !== "" &&
                value() !== command.defaultHotkey
              }
              fallback={<span class="settings-hotkey__spacer" />}
            >
              <TooltipIconButton
                aria-label={`Restore default shortcut for ${command.label}`}
                class="settings-hotkey__action"
                size="icon-xs"
                onClick={() => void commitBinding(command.id, null)}
                tooltip={`Restore ${displayHotkey(
                  command.defaultHotkey,
                  props.platform,
                )}`}
              >
                <Icon icon="rotate_ccw" class="button__icon" />
              </TooltipIconButton>
            </Show>
            <TooltipIconButton
              aria-label={`Clear shortcut for ${command.label}`}
              class="settings-hotkey__action settings-hotkey__clear"
              disabled={value() === ""}
              size="icon-xs"
              onClick={() => void commitBinding(command.id, "")}
              tooltip="Clear shortcut"
            >
              <Icon icon="x" class="button__icon" />
            </TooltipIconButton>
          </div>
        </div>
        <Show when={isRecording()}>
          <p id={hintId} class="settings-hotkey__hint">
            Press a shortcut. Esc cancels, Delete clears.
          </p>
        </Show>
        <Show when={rowError()}>
          {(error) => (
            <p
              class="settings-hotkey__error"
              data-error-id={error().id}
              role="status"
              aria-live="polite"
            >
              <Icon icon="circle_alert" aria-hidden="true" size="xs" />
              {error().message}
            </p>
          )}
        </Show>
      </li>
    );
  };

  return (
    <For each={commandCategories}>
      {(category) => (
        <SettingsSection
          class="settings-section--list"
          id={`hotkeys-${category.toLowerCase()}`}
          title={category}
        >
          <ul class="settings-hotkeys">
            <For
              each={segmentHotkeyCommands(
                GAME_COMMANDS.filter(
                  (command) => command.category === category,
                ),
              )}
            >
              {(segment) => {
                if (segment.type === "command") {
                  return renderHotkeyRow(segment.command);
                }

                const labelId = `settings-hotkey-group-${segment.commands[0]?.id ?? "unknown"}`;
                return (
                  <li
                    class="settings-hotkey-group"
                    role="group"
                    aria-labelledby={labelId}
                  >
                    <span id={labelId} class="settings-label">
                      {segment.label}
                    </span>
                    <ul class="settings-hotkeys settings-hotkeys--nested">
                      <For each={segment.commands}>{renderHotkeyRow}</For>
                    </ul>
                  </li>
                );
              }}
            </For>
          </ul>
        </SettingsSection>
      )}
    </For>
  );
}

function ThemeProfileEditor(props: {
  readonly profile: ThemeProfile;
  readonly variant: ThemeVariant;
  readonly onPatch: (patch: ThemeProfilePatch) => Promise<void>;
}): JSX.Element {
  const defaults = () => DEFAULT_THEME_PROFILES[props.variant];
  const fieldId = (name: string) => `settings-${props.variant}-${name}`;

  const restore = (
    field: keyof Omit<ThemeProfile, "tokens">,
    label: string,
  ): JSX.Element => (
    <Show when={props.profile[field] !== defaults()[field]}>
      <RestoreDefaultButton
        aria-label={`Restore default ${props.variant} theme ${label}`}
        onClick={() => void props.onPatch({ [field]: defaults()[field] })}
        tooltip="Restore default"
      />
    </Show>
  );

  return (
    <>
      <div class="settings-type-fields">
        <div class="settings-field">
          <FieldLabel
            for={fieldId("sans-font")}
            accessory={restore("sansFont", "sans font")}
          >
            Sans font
          </FieldLabel>
          <FontInput
            id={fieldId("sans-font")}
            value={props.profile.sansFont}
            onCommit={(sansFont) => props.onPatch({ sansFont })}
          />
        </div>
        <div class="settings-field">
          <FieldLabel
            for={fieldId("sans-size")}
            accessory={restore("sansFontSize", "sans font size")}
          >
            Size
          </FieldLabel>
          <FontSizeInput
            aria-label="Sans font size"
            id={fieldId("sans-size")}
            value={props.profile.sansFontSize}
            onCommit={(sansFontSize) => props.onPatch({ sansFontSize })}
          />
        </div>
        <div class="settings-field">
          <FieldLabel
            for={fieldId("mono-font")}
            accessory={restore("monoFont", "mono font")}
          >
            Mono font
          </FieldLabel>
          <FontInput
            id={fieldId("mono-font")}
            value={props.profile.monoFont}
            onCommit={(monoFont) => props.onPatch({ monoFont })}
          />
        </div>
        <div class="settings-field">
          <FieldLabel
            for={fieldId("mono-size")}
            accessory={restore("monoFontSize", "mono font size")}
          >
            Size
          </FieldLabel>
          <FontSizeInput
            aria-label="Mono font size"
            id={fieldId("mono-size")}
            value={props.profile.monoFontSize}
            onCommit={(monoFontSize) => props.onPatch({ monoFontSize })}
          />
        </div>
      </div>
      <div class="settings-field settings-field--rounding">
        <FieldLabel
          id={fieldId("rounding")}
          accessory={restore("rounding", "rounding")}
        >
          Rounding
        </FieldLabel>
        <RoundingSlider
          aria-labelledby={fieldId("rounding")}
          value={props.profile.rounding}
          onCommit={(rounding) => props.onPatch({ rounding })}
        />
      </div>
      <div
        class="settings-colors"
        role="group"
        aria-labelledby={fieldId("colors")}
      >
        <div class="settings-colors__head" aria-hidden="true">
          <span class="settings-label" id={fieldId("colors")}>
            Colors
          </span>
          <span class="settings-colors__columns">
            <span class="settings-label">Base</span>
            <span class="settings-label">Foreground</span>
          </span>
        </div>
        <ul class="settings-colors__rows">
          <For each={THEME_COLOR_ROWS}>
            {(row) => {
              const color = (name: ThemeTokenName) => (
                <ThemeColor
                  defaultValue={defaults().tokens[name]}
                  name={name}
                  value={props.profile.tokens[name]}
                  onChange={(value) =>
                    props.onPatch({ tokens: { [name]: value } })
                  }
                  onReset={() => props.onPatch({ tokens: { [name]: null } })}
                />
              );
              return (
                <li class="settings-color-row">
                  <span class="settings-color-row__label">{row.label}</span>
                  <div class="settings-colors__columns">
                    {color(row.base)}
                    <Show when={row.foreground}>{(name) => color(name())}</Show>
                  </div>
                </li>
              );
            }}
          </For>
        </ul>
      </div>
    </>
  );
}

function AppearanceSettings(props: {
  readonly settings: AppSettings;
  readonly onAppearancePatch: (patch: AppearancePatch) => Promise<void>;
}): JSX.Element {
  const [activeThemeVariant, setActiveThemeVariant] =
    createSignal<ThemeVariant>(
      themeVariantForMode(props.settings.appearance.themeMode),
    );
  const [resetDialogOpen, setResetDialogOpen] = createSignal(false);
  let observedThemeMode = props.settings.appearance.themeMode;
  createEffect(() => {
    const nextThemeMode = props.settings.appearance.themeMode;
    if (nextThemeMode !== observedThemeMode) {
      observedThemeMode = nextThemeMode;
      setActiveThemeVariant(themeVariantForMode(nextThemeMode));
    }
  });

  const activeProfile = () =>
    props.settings.appearance.themes[activeThemeVariant()];
  const activeProfileIsDefault = createMemo(() =>
    isThemeProfileDefault(
      activeProfile(),
      DEFAULT_THEME_PROFILES[activeThemeVariant()],
    ),
  );

  const patchThemeProfile = (
    variant: ThemeVariant,
    patch: ThemeProfilePatch,
  ): Promise<void> => props.onAppearancePatch({ themes: { [variant]: patch } });

  const resetThemeProfile = (variant: ThemeVariant): Promise<void> => {
    const defaults = DEFAULT_THEME_PROFILES[variant];
    return patchThemeProfile(variant, {
      tokens: Object.fromEntries(THEME_TOKEN_NAMES.map((name) => [name, null])),
      sansFont: defaults.sansFont,
      monoFont: defaults.monoFont,
      sansFontSize: defaults.sansFontSize,
      monoFontSize: defaults.monoFontSize,
      rounding: defaults.rounding,
    });
  };

  return (
    <>
      <SettingsSection
        id="theme"
        title="Theme"
        description="Choose the app color mode."
        control={
          <SegmentedControl
            aria-label="Theme mode"
            onChange={(themeMode) => {
              setActiveThemeVariant(themeVariantForMode(themeMode));
              void props.onAppearancePatch({ themeMode });
            }}
            options={themeModes}
            value={props.settings.appearance.themeMode}
          />
        }
      />
      <SettingsSection
        id="motion"
        title="Reduce motion"
        description="Limit animations and transitions."
        control={
          <SegmentedControl
            aria-label="Reduce motion"
            onChange={(reduceMotion) =>
              void props.onAppearancePatch({ reduceMotion })
            }
            options={motionModes}
            value={props.settings.appearance.reduceMotion}
          />
        }
      />
      <SwitchSection
        id="cursor-pointers"
        title="Use cursor pointers"
        description="Show a pointer cursor over clickable controls."
        checked={props.settings.appearance.useCursorPointers}
        onChange={(useCursorPointers) =>
          props.onAppearancePatch({ useCursorPointers })
        }
      />
      <SettingsSection
        id="theme-profile"
        title={activeThemeVariant() === "light" ? "Light theme" : "Dark theme"}
        description="Fonts, rounding, and colors for this theme."
        control={
          <>
            <TooltipIconButton
              aria-label={`Reset ${activeThemeVariant()} theme`}
              class="settings-quiet-action"
              disabled={activeProfileIsDefault()}
              onClick={() => setResetDialogOpen(true)}
              tooltip={`Reset ${activeThemeVariant()} theme`}
            >
              <Icon icon="rotate_ccw" class="button__icon" />
            </TooltipIconButton>
            <SegmentedControl
              aria-label="Theme to customize"
              onChange={(value) => setActiveThemeVariant(value)}
              options={themeVariants}
              value={activeThemeVariant()}
            />
          </>
        }
      >
        <ThemeProfileEditor
          profile={activeProfile()}
          variant={activeThemeVariant()}
          onPatch={(patch) => patchThemeProfile(activeThemeVariant(), patch)}
        />
      </SettingsSection>
      <ConfirmDialog
        open={resetDialogOpen()}
        onOpenChange={setResetDialogOpen}
        title={`Reset ${activeThemeVariant()} theme?`}
        description="This restores the theme's fonts, font sizes, rounding, and colors."
        confirmLabel="Reset theme"
        onConfirm={() => void resetThemeProfile(activeThemeVariant())}
      />
    </>
  );
}

export function SettingsView(props: SettingsViewProps): JSX.Element {
  const [settings, setSettings] = createSignal<AppSettings>(
    props.fixture.settings,
  );
  const [liveUpdateState, setLiveUpdateState] = createSignal<UpdateCheckState>(
    props.fixture.updateState ?? initialUpdateState(settings()),
  );
  const [updateCheckPending, setUpdateCheckPending] = createSignal(false);
  const [error, setError] = createSignal<{
    readonly id: number;
    readonly message: string;
  } | null>(
    props.fixture.error === undefined
      ? null
      : { id: 1, message: props.fixture.error },
  );
  const [activeTab, setActiveTab] = createSignal<SettingsTabId>(
    props.fixture.activeTab ?? "general",
  );
  const [resetHotkeysOpen, setResetHotkeysOpen] = createSignal(false);
  const scrollPositions = new Map<SettingsTabId, number>();
  let sheet: HTMLElement | undefined;
  let tabList: HTMLElement | undefined;
  let nextErrorId = 0;

  const showError = (message: string): void => {
    setError({ id: ++nextErrorId, message });
  };

  const selectTab = (tab: SettingsTabId): void => {
    if (sheet !== undefined) {
      scrollPositions.set(activeTab(), sheet.scrollTop);
    }
    setActiveTab(tab);
    if (sheet !== undefined) {
      sheet.scrollTop = scrollPositions.get(tab) ?? 0;
    }
    const selectedTrigger = tabList?.querySelector<HTMLElement>(
      `[data-value="${tab}"]`,
    );
    selectedTrigger?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const resyncControlsWithSavedSettings = (): void => {
    setSettings((saved) => ({ ...saved }));
  };

  const runSettingsUpdate = async (
    update: Promise<AppSettings>,
  ): Promise<void> => {
    try {
      setSettings(await update);
      setError(null);
    } catch (cause) {
      console.error("Failed to update settings:", cause);
      showError(errorMessage(cause, "Settings update failed"));
      resyncControlsWithSavedSettings();
    }
  };

  const applyUpdateState = (
    state: UpdateCheckState,
    options?: { readonly allowWhenDisabled?: boolean },
  ): void => {
    setLiveUpdateState(
      options?.allowWhenDisabled === true
        ? state
        : normalizeUpdateStateForPreferences(state, settings()),
    );
  };

  createEffect(() => {
    const nextSettings = settings();
    setLiveUpdateState((current) => {
      return normalizeUpdateStateForPreferences(current, nextSettings);
    });
  });

  const checkForUpdates = (): void => {
    const current = liveUpdateState();
    if (updateCheckPending() || current.status === "checking") {
      return;
    }

    setUpdateCheckPending(true);
    setLiveUpdateState({
      status: "checking",
      currentVersion: current.currentVersion,
      startedAt: new Date().toISOString(),
    });

    const update = props.onCheckForUpdates?.();
    if (update === undefined) {
      setUpdateCheckPending(false);
      return;
    }

    void update
      .then((state) => applyUpdateState(state, { allowWhenDisabled: true }))
      .catch((cause: unknown) => {
        console.error("Failed to check for updates:", cause);
        showError(errorMessage(cause, "Update check failed"));
      })
      .finally(() => {
        setUpdateCheckPending(false);
      });
  };

  const openReleasePage = (): void => {
    void (props.onOpenReleasePage?.() ?? Promise.resolve(false)).catch(
      (cause: unknown) => {
        console.error("Failed to open release page:", cause);
        showError(errorMessage(cause, "Release page unavailable"));
      },
    );
  };

  onMount(() => {
    let disposed = false;
    const unsubscribeSettings = props.onSettingsChanged?.(setSettings);
    const unsubscribeUpdates = props.onUpdatesChanged?.(applyUpdateState);

    if (props.getSettings !== undefined) {
      void props
        .getSettings()
        .then((nextSettings) => {
          if (!disposed) {
            setSettings(nextSettings);
          }
        })
        .catch((cause: unknown) => {
          if (!disposed) {
            console.error("Failed to load settings:", cause);
            showError(errorMessage(cause, "Settings unavailable"));
          }
        });
    }

    if (props.getUpdateState !== undefined) {
      void props
        .getUpdateState()
        .then(applyUpdateState)
        .catch((cause: unknown) => {
          console.error("Failed to load update state:", cause);
        });
    }

    onCleanup(() => {
      disposed = true;
      unsubscribeSettings?.();
      unsubscribeUpdates?.();
    });
  });

  return (
    <div class="standalone-window settings-root">
      <Tabs
        class="settings-tabs"
        onValueChange={(details) => selectTab(details.value as SettingsTabId)}
        value={activeTab()}
      >
        <header class="standalone-window__header settings-header">
          <TabsList
            ref={(element: HTMLElement) => {
              tabList = element;
            }}
            aria-label="Settings sections"
            class="settings-tabs__list"
            variant="underline"
          >
            <For each={settingsTabs}>
              {(tab) => (
                <TabsTrigger value={tab.value}>{tab.label}</TabsTrigger>
              )}
            </For>
          </TabsList>
          <Show when={activeTab() === "hotkeys"}>
            <div class="settings-header__end">
              <Button
                aria-label="Reset hotkeys"
                class="settings-reset-hotkeys"
                disabled={areHotkeysDefault(settings().hotkeys.bindings)}
                onClick={() => setResetHotkeysOpen(true)}
                size="sm"
                variant="outline"
              >
                <Icon icon="rotate_ccw" class="button__icon" />
                <span class="settings-reset-hotkeys__label">Reset hotkeys</span>
              </Button>
            </div>
          </Show>
        </header>

        <Show when={error()}>
          {(notice) => <IssueAlert message={notice().message} />}
        </Show>

        <main
          ref={(element) => {
            sheet = element;
          }}
          class="settings-sheet"
        >
          <TabsContent class="settings-panel" value="general">
            <GeneralSettings
              checking={
                updateCheckPending() || liveUpdateState().status === "checking"
              }
              onCheckForUpdates={checkForUpdates}
              onOpenReleasePage={openReleasePage}
              onPreferencesPatch={(patch) =>
                runSettingsUpdate(
                  props.onPreferencesPatch?.(patch) ??
                    Promise.resolve(settings()),
                )
              }
              settings={settings()}
              updateState={liveUpdateState()}
            />
          </TabsContent>
          <TabsContent class="settings-panel" value="hotkeys">
            <HotkeySettings
              active={activeTab() === "hotkeys"}
              onHotkeysPatch={(patch) =>
                runSettingsUpdate(
                  props.onHotkeysPatch?.(patch) ?? Promise.resolve(settings()),
                )
              }
              platform={props.platform}
              settings={settings()}
            />
          </TabsContent>
          <TabsContent class="settings-panel" value="appearance">
            <AppearanceSettings
              onAppearancePatch={(patch) =>
                runSettingsUpdate(
                  props.onAppearancePatch?.(patch) ??
                    Promise.resolve(settings()),
                )
              }
              settings={settings()}
            />
          </TabsContent>
        </main>
      </Tabs>

      <ConfirmDialog
        open={resetHotkeysOpen()}
        onOpenChange={setResetHotkeysOpen}
        title="Reset all hotkeys?"
        description="This restores every game-window shortcut to its default binding."
        confirmLabel="Reset hotkeys"
        onConfirm={() =>
          void runSettingsUpdate(
            props.onResetHotkeys?.() ?? Promise.resolve(settings()),
          )
        }
      />
    </div>
  );
}

export function App(props: {
  readonly initialSettings: AppSettings | null;
  readonly platform: AppPlatform;
}): JSX.Element {
  const desktop = selectDesktopBridge(window.desktop, "settings");
  const settings = desktop.settings;
  const updates = desktop.updates;
  const initialSettings = props.initialSettings ?? defaultSettings;

  return (
    <SettingsView
      fixture={{ settings: initialSettings }}
      getSettings={() => settings.get()}
      getUpdateState={() => updates.getState()}
      onAppearancePatch={(patch) => settings.updateAppearance(patch)}
      onCheckForUpdates={() => updates.checkNow({ force: true })}
      onHotkeysPatch={(patch) => settings.updateHotkeys(patch)}
      onOpenReleasePage={() => updates.openReleasePage()}
      onPreferencesPatch={(patch) => settings.updatePreferences(patch)}
      onResetHotkeys={() => settings.resetHotkeys()}
      onSettingsChanged={(listener) => settings.onChanged(listener)}
      onUpdatesChanged={(listener) => updates.onChanged(listener)}
      platform={props.platform}
    />
  );
}
