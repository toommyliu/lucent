import {
  SETTINGS_COMMANDS,
  hotkeyBindingMatchKey,
  readHotkeyBinding,
  type HotkeyBinding,
  type HotkeyDisplayPlatform,
  type SettingsCommandDefinition,
  type SettingsCommandId,
} from "@lucent/core/hotkeys";

export type CommandsByShortcut = ReadonlyMap<
  string,
  readonly SettingsCommandDefinition[]
>;

export const groupCommandsByShortcut = (
  bindings: readonly HotkeyBinding[],
  platform: HotkeyDisplayPlatform,
): CommandsByShortcut => {
  const byShortcut = new Map<string, SettingsCommandDefinition[]>();
  for (const command of SETTINGS_COMMANDS) {
    const key = hotkeyBindingMatchKey(
      readHotkeyBinding(bindings, command.id),
      platform,
    );
    if (key === null) {
      continue;
    }

    const commands = byShortcut.get(key);
    if (commands === undefined) {
      byShortcut.set(key, [command]);
    } else {
      commands.push(command);
    }
  }
  return byShortcut;
};

export const findConflictingCommands = (
  byShortcut: CommandsByShortcut,
  id: SettingsCommandId,
  value: string,
  platform: HotkeyDisplayPlatform,
): readonly SettingsCommandDefinition[] => {
  const key = hotkeyBindingMatchKey(value, platform);
  if (key === null) {
    return [];
  }

  return (byShortcut.get(key) ?? []).filter((command) => command.id !== id);
};
