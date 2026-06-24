import { Option, Schema } from "effect";

export type SettingsCommandCategory =
  | "General"
  | "Scripts"
  | "Options"
  | "Tools"
  | "Packets";
export type HotkeyDisplayPlatform = "linux" | "mac" | "windows";

export const SETTINGS_COMMAND_IDS = [
  "toggleTopBar",
  "loadScript",
  "toggleScript",
  "toggleOptionsMenu",
  "openEnvironment",
  "openFastTravels",
  "openLoaderGrabber",
  "openFollower",
  "openPackets",
  "toggleAutoattack",
  "toggleFollower",
  "toggleBank",
  "toggleInfiniteRange",
  "toggleProvokeCell",
  "toggleEnemyMagnet",
  "toggleLagKiller",
  "toggleHidePlayers",
  "toggleSkipCutscenes",
  "toggleAntiCounter",
  "toggleDisableFx",
  "toggleCollisions",
  "toggleDeathAds",
] as const;

export const SETTING_COMMAND_CATEGORIES = [
  "General",
  "Scripts",
  "Options",
  "Tools",
  "Packets",
] as const satisfies readonly SettingsCommandCategory[];

export type SettingsCommandId = (typeof SETTINGS_COMMAND_IDS)[number];

export interface SettingsCommandDefinition {
  readonly category: SettingsCommandCategory;
  readonly defaultHotkey: string;
  readonly description?: string;
  readonly id: SettingsCommandId;
  readonly label: string;
}

export interface HotkeyBinding {
  readonly id: SettingsCommandId;
  readonly value: string;
}

export interface HotkeyBindingPatch {
  readonly id: SettingsCommandId;
  readonly value: string | null;
}

export interface HotkeysSettings {
  readonly bindings: readonly HotkeyBinding[];
}

export interface HotkeysPatch {
  readonly bindings?: readonly HotkeyBindingPatch[];
}

export const SettingsCommandIdSchema = Schema.Literals(SETTINGS_COMMAND_IDS);

export const HotkeyBindingSchema = Schema.Struct({
  id: SettingsCommandIdSchema,
  value: Schema.String,
});

export const HotkeyBindingPatchSchema = Schema.Struct({
  id: SettingsCommandIdSchema,
  value: Schema.NullOr(Schema.String),
});

export const HotkeysSettingsSchema = Schema.Struct({
  bindings: Schema.Array(HotkeyBindingSchema),
});

export const HotkeysPatchSchema = Schema.Struct({
  bindings: Schema.optionalKey(Schema.Array(HotkeyBindingPatchSchema)),
});

export const SETTINGS_COMMANDS: readonly SettingsCommandDefinition[] = [
  {
    id: "toggleTopBar",
    category: "General",
    label: "Toggle Top Bar",
    defaultHotkey: "Mod+Shift+T",
  },
  {
    id: "loadScript",
    category: "Scripts",
    label: "Load Script",
    defaultHotkey: "Mod+O",
  },
  {
    id: "toggleScript",
    category: "Scripts",
    label: "Start/Stop Script",
    defaultHotkey: "Mod+Shift+X",
  },
  {
    id: "toggleOptionsMenu",
    category: "Options",
    label: "Toggle Options Menu",
    defaultHotkey: "Mod+Shift+,",
  },
  {
    id: "openEnvironment",
    category: "Tools",
    label: "Open Environment",
    defaultHotkey: "Alt+E",
  },
  {
    id: "openFastTravels",
    category: "Tools",
    label: "Open Fast Travels",
    defaultHotkey: "",
  },
  {
    id: "openLoaderGrabber",
    category: "Tools",
    label: "Open Loader/Grabber",
    defaultHotkey: "",
  },
  {
    id: "openFollower",
    category: "Tools",
    label: "Open Follower Window",
    defaultHotkey: "Alt+F",
  },
  {
    id: "openPackets",
    category: "Packets",
    label: "Open Packets",
    defaultHotkey: "",
  },
  {
    id: "toggleAutoattack",
    category: "General",
    label: "Toggle Auto Attack",
    defaultHotkey: "Alt+A",
  },
  {
    id: "toggleFollower",
    category: "General",
    label: "Toggle Follower Feature",
    defaultHotkey: "Alt+Shift+F",
  },
  {
    id: "toggleBank",
    category: "General",
    label: "Toggle Bank",
    defaultHotkey: "Mod+B",
  },
  {
    id: "toggleInfiniteRange",
    category: "Options",
    label: "Toggle Infinite Range",
    defaultHotkey: "Alt+I",
  },
  {
    id: "toggleProvokeCell",
    category: "Options",
    label: "Toggle Provoke Cell",
    defaultHotkey: "",
  },
  {
    id: "toggleEnemyMagnet",
    category: "Options",
    label: "Toggle Enemy Magnet",
    defaultHotkey: "",
  },
  {
    id: "toggleLagKiller",
    category: "Options",
    label: "Toggle Lag Killer",
    defaultHotkey: "Alt+L",
  },
  {
    id: "toggleHidePlayers",
    category: "Options",
    label: "Toggle Hide Players",
    defaultHotkey: "",
  },
  {
    id: "toggleSkipCutscenes",
    category: "Options",
    label: "Toggle Skip Cutscenes",
    defaultHotkey: "",
  },
  {
    id: "toggleAntiCounter",
    category: "Options",
    label: "Toggle Anti-Counter",
    defaultHotkey: "",
  },
  {
    id: "toggleDisableFx",
    category: "Options",
    label: "Toggle Disable FX",
    defaultHotkey: "",
  },
  {
    id: "toggleCollisions",
    category: "Options",
    label: "Toggle Collisions",
    defaultHotkey: "",
  },
  {
    id: "toggleDeathAds",
    category: "Options",
    label: "Toggle Death Ads",
    defaultHotkey: "",
  },
] as const;

const commandIds = new Set<string>(SETTINGS_COMMAND_IDS);
const commandDefinitions = new Map<
  SettingsCommandId,
  SettingsCommandDefinition
>(SETTINGS_COMMANDS.map((command) => [command.id, command]));

const modifierAliases: ReadonlyMap<string, string> = new Map([
  ["alt", "Alt"],
  ["option", "Alt"],
  ["control", "Control"],
  ["ctrl", "Control"],
  ["command", "Meta"],
  ["cmd", "Meta"],
  ["meta", "Meta"],
  ["mod", "Mod"],
  ["shift", "Shift"],
]);

const modifierOrder = new Map([
  ["Mod", 0],
  ["Control", 1],
  ["Alt", 2],
  ["Shift", 3],
  ["Meta", 4],
]);

const normalizeKey = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const alias = modifierAliases.get(trimmed.toLowerCase());
  if (alias !== undefined) {
    return alias;
  }

  return /^[a-z]$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
};

export const isSettingsCommandId = (
  value: unknown,
): value is SettingsCommandId =>
  typeof value === "string" && commandIds.has(value);

export const getSettingsCommandDefinition = (
  id: SettingsCommandId,
): SettingsCommandDefinition => {
  const definition = commandDefinitions.get(id);
  if (definition === undefined) {
    throw new Error(`Unknown settings command: ${id}`);
  }
  return definition;
};

export const createDefaultHotkeyBindings = (): readonly HotkeyBinding[] =>
  SETTINGS_COMMANDS.map((command) => ({
    id: command.id,
    value: command.defaultHotkey,
  }));

export const DEFAULT_HOTKEYS: HotkeysSettings = {
  bindings: createDefaultHotkeyBindings(),
};

export const normalizeHotkeyBindingValue = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const rawParts = trimmed.includes("+")
    ? trimmed.split("+")
    : trimmed.split(/\s+/);
  const parts = rawParts
    .map(normalizeKey)
    .filter((part): part is string => part !== null);

  if (parts.length === 0) {
    return null;
  }

  const uniqueParts = new Set(parts.map((part) => part.toLowerCase()));
  if (uniqueParts.size !== parts.length) {
    return null;
  }

  const nonModifiers = parts.filter((part) => !modifierOrder.has(part));
  if (nonModifiers.length !== 1) {
    return null;
  }

  const modifiers = [...modifierOrder.keys()].filter((modifier) =>
    parts.includes(modifier),
  );

  return [...modifiers, nonModifiers[0]].join("+");
};

export const normalizeHotkeySettings = (value: unknown): HotkeysSettings => {
  const defaultValues = new Map<SettingsCommandId, string>(
    DEFAULT_HOTKEYS.bindings.map((binding) => [binding.id, binding.value]),
  );
  const decoded = Schema.decodeUnknownOption(HotkeysSettingsSchema)(value);
  if (Option.isSome(decoded)) {
    for (const binding of decoded.value.bindings) {
      const normalizedValue = normalizeHotkeyBindingValue(binding.value);
      if (normalizedValue !== null) {
        defaultValues.set(binding.id, normalizedValue);
      }
    }
  }

  return {
    bindings: SETTINGS_COMMANDS.map((command) => ({
      id: command.id,
      value: defaultValues.get(command.id) ?? command.defaultHotkey,
    })),
  };
};

export const readHotkeyBinding = (
  bindings: readonly HotkeyBinding[],
  id: SettingsCommandId,
): string =>
  bindings.find((binding) => binding.id === id)?.value ??
  getSettingsCommandDefinition(id).defaultHotkey;

export const hotkeyConflictKey = (value: string): string | null => {
  const normalized = normalizeHotkeyBindingValue(value);
  return normalized === null || normalized.length === 0
    ? null
    : normalized.toLowerCase();
};

export const findDuplicateHotkeyBinding = (
  bindings: readonly HotkeyBinding[],
): HotkeyBinding | null => {
  const seen = new Set<string>();
  for (const binding of bindings) {
    const key = hotkeyConflictKey(binding.value);
    if (key === null) {
      continue;
    }
    if (seen.has(key)) {
      return binding;
    }
    seen.add(key);
  }
  return null;
};

const macDisplayAliases: Readonly<Record<string, string>> = {
  alt: "⌥",
  cmd: "⌘",
  command: "⌘",
  control: "⌃",
  ctrl: "⌃",
  meta: "⌘",
  mod: "⌘",
  option: "⌥",
  shift: "⇧",
  "⌃": "⌃",
  "⌘": "⌘",
  "⌥": "⌥",
  "⇧": "⇧",
};

const nonMacDisplayAliases: Readonly<Record<string, string>> = {
  alt: "Alt",
  control: "Ctrl",
  ctrl: "Ctrl",
  meta: "Win",
  mod: "Ctrl",
  option: "Alt",
  shift: "Shift",
};

const splitHotkeyParts = (value: string): readonly string[] => {
  const trimmed = value.trim();
  return trimmed.includes("+") ? trimmed.split("+") : trimmed.split(/\s+/);
};

const formatHotkeyPart = (
  part: string,
  platform: HotkeyDisplayPlatform,
): string => {
  const trimmed = part.trim();
  const aliases = platform === "mac" ? macDisplayAliases : nonMacDisplayAliases;
  const alias = aliases[trimmed.toLowerCase()];
  if (alias !== undefined) {
    return alias;
  }

  return /^[a-z]$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
};

export const formatHotkeyDisplayParts = (
  value: string,
  platform: HotkeyDisplayPlatform,
  emptyLabel = "Unbound",
): readonly string[] => {
  if (value.length === 0) {
    return [emptyLabel];
  }

  return splitHotkeyParts(value)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => formatHotkeyPart(part, platform));
};

export const formatHotkeyDisplay = (
  value: string,
  platform: HotkeyDisplayPlatform,
  emptyLabel = "Unbound",
): string => {
  if (value.length === 0) {
    return emptyLabel;
  }

  const separator = platform === "mac" ? " " : "+";
  return formatHotkeyDisplayParts(value, platform, emptyLabel).join(separator);
};
