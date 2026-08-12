import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { SETTINGS_COMMANDS, type HotkeysPatch } from "@lucent/core/hotkeys";
import {
  DEFAULT_APP_SETTINGS,
  THEME_TOKEN_NAMES,
  type AppSettings,
  type AppearancePatch,
  type PreferencesPatch,
  type ThemeProfile,
  type ThemeProfilePatch,
} from "@lucent/core/settings";
import { UpdateReleaseInfo } from "../../../shared/updates";
import { SettingsView, type SettingsViewProps } from "./App";

const updateChecksEnabledSettings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  preferences: {
    ...DEFAULT_APP_SETTINGS.preferences,
    checkForUpdates: true,
  },
};

const cursorPointersEnabledSettings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  appearance: {
    ...DEFAULT_APP_SETTINGS.appearance,
    useCursorPointers: true,
  },
};

const applyThemeProfilePatch = (
  current: ThemeProfile,
  defaults: ThemeProfile,
  patch: ThemeProfilePatch,
): ThemeProfile => {
  const tokens = { ...current.tokens };
  for (const name of THEME_TOKEN_NAMES) {
    const value = patch.tokens?.[name];
    if (value === null) {
      tokens[name] = defaults.tokens[name];
    } else if (value !== undefined) {
      tokens[name] = value;
    }
  }

  return {
    monoFont: patch.monoFont ?? current.monoFont,
    monoFontSize: patch.monoFontSize ?? current.monoFontSize,
    rounding: patch.rounding ?? current.rounding,
    sansFont: patch.sansFont ?? current.sansFont,
    sansFontSize: patch.sansFontSize ?? current.sansFontSize,
    tokens,
  };
};

const applyAppearancePatch = (
  current: AppSettings,
  patch: AppearancePatch,
): AppSettings => {
  const themes = { ...current.appearance.themes };
  for (const variant of ["light", "dark"] as const) {
    const profilePatch = patch.themes?.[variant];
    if (profilePatch !== undefined) {
      themes[variant] = applyThemeProfilePatch(
        themes[variant],
        DEFAULT_APP_SETTINGS.appearance.themes[variant],
        profilePatch,
      );
    }
  }

  return {
    ...current,
    appearance: {
      ...current.appearance,
      reduceMotion: patch.reduceMotion ?? current.appearance.reduceMotion,
      themeMode: patch.themeMode ?? current.appearance.themeMode,
      themes,
      useCursorPointers:
        patch.useCursorPointers ?? current.appearance.useCursorPointers,
    },
  };
};

const applyHotkeysPatch = (
  current: AppSettings,
  patch: HotkeysPatch,
): AppSettings => {
  const values = new Map(
    current.hotkeys.bindings.map((binding) => [binding.id, binding.value]),
  );
  for (const binding of patch.bindings ?? []) {
    const definition = SETTINGS_COMMANDS.find(
      (command) => command.id === binding.id,
    );
    values.set(binding.id, binding.value ?? definition?.defaultHotkey ?? "");
  }

  return {
    ...current,
    hotkeys: {
      bindings: SETTINGS_COMMANDS.map((command) => ({
        id: command.id,
        value: values.get(command.id) ?? command.defaultHotkey,
      })),
    },
  };
};

const applyPreferencesPatch = (
  current: AppSettings,
  patch: PreferencesPatch,
): AppSettings => ({
  ...current,
  preferences: { ...current.preferences, ...patch },
});

function InteractiveSettingsStory(props: SettingsViewProps) {
  let currentSettings = props.fixture.settings;
  const commit = (next: AppSettings): Promise<AppSettings> => {
    currentSettings = next;
    return Promise.resolve(next);
  };

  return (
    <SettingsView
      {...props}
      onAppearancePatch={
        props.onAppearancePatch ??
        ((patch) => commit(applyAppearancePatch(currentSettings, patch)))
      }
      onCheckForUpdates={
        props.onCheckForUpdates ??
        (() =>
          Promise.resolve({
            checkedAt: "2026-08-12T07:00:00.000Z",
            currentVersion:
              props.fixture.updateState?.currentVersion ?? "0.8.2",
            latestVersion: props.fixture.updateState?.currentVersion ?? "0.8.2",
            status: "current",
          }))
      }
      onHotkeysPatch={
        props.onHotkeysPatch ??
        ((patch) => commit(applyHotkeysPatch(currentSettings, patch)))
      }
      onOpenReleasePage={
        props.onOpenReleasePage ?? (() => Promise.resolve(true))
      }
      onPreferencesPatch={
        props.onPreferencesPatch ??
        ((patch) => commit(applyPreferencesPatch(currentSettings, patch)))
      }
      onResetHotkeys={
        props.onResetHotkeys ??
        (() =>
          commit({
            ...currentSettings,
            hotkeys: DEFAULT_APP_SETTINGS.hotkeys,
          }))
      }
    />
  );
}

const meta = {
  args: {
    fixture: { settings: DEFAULT_APP_SETTINGS },
    platform: "mac",
  },
  component: SettingsView,
  globals: {
    viewport: { isRotated: false, value: "settings" },
  },
  render: (args) => <InteractiveSettingsStory {...args} />,
  title: "Renderers/Settings",
} satisfies Meta<typeof SettingsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const General: Story = {};

export const UpdateAvailable: Story = {
  args: {
    fixture: {
      settings: updateChecksEnabledSettings,
      updateState: {
        checkedAt: "2026-08-11T19:42:00.000Z",
        currentVersion: "0.8.2",
        latestVersion: "0.9.0",
        release: new UpdateReleaseInfo({
          body: "Renderer polish, scripting fixes, and faster startup.",
          htmlUrl: "https://github.com/toommyliu/lucent/releases/tag/v0.9.0",
          name: "Lucent 0.9.0",
          publishedAt: "2026-08-10T18:00:00.000Z",
          tagName: "v0.9.0",
          version: "0.9.0",
        }),
        status: "available",
      },
    },
  },
};

export const UpdateCheckError: Story = {
  args: {
    fixture: {
      error: "GitHub could not be reached. Check your connection and retry.",
      settings: updateChecksEnabledSettings,
      updateState: {
        checkedAt: "2026-08-11T19:42:00.000Z",
        currentVersion: "0.8.2",
        message: "Update service unavailable",
        status: "error",
      },
    },
  },
};

export const Hotkeys: Story = {
  args: {
    fixture: {
      activeTab: "hotkeys",
      settings: DEFAULT_APP_SETTINGS,
    },
  },
};

export const Appearance: Story = {
  args: {
    fixture: {
      activeTab: "appearance",
      settings: cursorPointersEnabledSettings,
    },
  },
};

export const CustomLightTheme: Story = {
  args: {
    fixture: {
      activeTab: "appearance",
      settings: {
        ...DEFAULT_APP_SETTINGS,
        appearance: {
          ...DEFAULT_APP_SETTINGS.appearance,
          themeMode: "light",
          useCursorPointers: true,
          themes: {
            ...DEFAULT_APP_SETTINGS.appearance.themes,
            light: {
              ...DEFAULT_APP_SETTINGS.appearance.themes.light,
              monoFontSize: 14,
              rounding: 1.5,
              sansFontSize: 16,
            },
          },
        },
      },
    },
  },
  globals: { theme: "light" },
};
