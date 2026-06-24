import type {
  AppSettings,
  AppearancePatch,
  PreferencesPatch,
} from "./settings";
import type { HotkeysPatch } from "./hotkeys";
import type { UpdateCheckState } from "./updates";

export type AppPlatform = "linux" | "mac" | "windows";
export type DesktopBridgeView = "game" | "settings";

export interface DesktopSettingsBridge {
  readonly initial: AppSettings | null;
  readonly get: () => Promise<AppSettings>;
  readonly onChanged: (listener: (settings: AppSettings) => void) => () => void;
  readonly resetAppearance?: () => Promise<AppSettings>;
  readonly resetHotkeys?: () => Promise<AppSettings>;
  readonly updateAppearance?: (patch: AppearancePatch) => Promise<AppSettings>;
  readonly updateHotkeys?: (patch: HotkeysPatch) => Promise<AppSettings>;
  readonly updatePreferences?: (
    patch: PreferencesPatch,
  ) => Promise<AppSettings>;
}

export interface DesktopUpdatesBridge {
  readonly checkNow: (options?: {
    readonly force?: boolean;
  }) => Promise<UpdateCheckState>;
  readonly getState: () => Promise<UpdateCheckState>;
  readonly onChanged: (
    listener: (state: UpdateCheckState) => void,
  ) => () => void;
  readonly openReleasePage: () => Promise<boolean>;
}

export interface DesktopBridge {
  readonly platform: {
    readonly os: AppPlatform;
  };
  readonly settings: DesktopSettingsBridge;
  readonly updates?: DesktopUpdatesBridge;
}
