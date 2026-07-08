import type {
  AppSettings,
  AppearancePatch,
  PreferencesPatch,
} from "./settings";
import type { HotkeysPatch } from "./hotkeys";
import type { CombatProfile, CombatProfileLibrary } from "./combat-profiles";
import type {
  ArmyConfigPayload,
  ArmyFailPayload,
  ArmyLeavePayload,
  ArmyProgressPayload,
  ArmyProgressResult,
  ArmySessionPayload,
  ArmyStartPayload,
  ArmySyncPayload,
} from "./army";
import type { ScriptFile, ScriptOpenFileResult } from "./ipc/scripting";
import type { ScriptInputsDefinition, ScriptInputValues } from "./scriptInputs";
import type { UpdateCheckState } from "./updates";
import type {
  AccountGameLaunchPayload,
  AccountGameServerPingsResult,
  AccountGameServersResult,
  AccountGameWindowTargetRequest,
  AccountLaunchRequest,
  AccountLaunchResult,
  AccountManagerState,
  AccountScriptStatusUpdate,
  ManagedAccountDraft,
  ManagedAccountGroupDraft,
  ManagedAccountGroupPatch,
  ManagedAccountPatch,
} from "./accounts";

export type AppPlatform = "linux" | "mac" | "windows";
export type DesktopBridgeView =
  | "account-manager"
  | "combat-profiles"
  | "game"
  | "settings";
export type DesktopBridgeWindowKind =
  | "account-manager"
  | "combat-profiles"
  | "game"
  | "settings";

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

export interface DesktopScriptingBridge {
  readonly getInputValues: (
    definition: ScriptInputsDefinition,
  ) => Promise<ScriptInputValues>;
  readonly openFile: () => Promise<ScriptOpenFileResult>;
  readonly openPath: (path: string) => Promise<boolean>;
  readonly readFile: (path: string) => Promise<ScriptFile>;
  readonly saveInputValues: (
    definition: ScriptInputsDefinition,
    values: ScriptInputValues,
  ) => Promise<ScriptInputValues>;
}

export interface DesktopCombatProfilesBridge {
  readonly deleteProfile: (profileId: string) => Promise<CombatProfileLibrary>;
  readonly getState: () => Promise<CombatProfileLibrary>;
  readonly onChanged: (
    listener: (library: CombatProfileLibrary) => void,
  ) => () => void;
  readonly saveProfile: (
    profile: CombatProfile,
  ) => Promise<CombatProfileLibrary>;
}

export interface DesktopAccountsBridge {
  readonly closeGameWindow: (
    request: AccountGameWindowTargetRequest,
  ) => Promise<AccountManagerState>;
  readonly createAccount: (
    draft: ManagedAccountDraft,
  ) => Promise<AccountManagerState>;
  readonly createGroup: (
    draft: ManagedAccountGroupDraft,
  ) => Promise<AccountManagerState>;
  readonly deleteAccount: (username: string) => Promise<AccountManagerState>;
  readonly deleteGroup: (name: string) => Promise<AccountManagerState>;
  readonly focusGameWindow: (
    request: AccountGameWindowTargetRequest,
  ) => Promise<AccountManagerState>;
  readonly getServerPings: () => Promise<AccountGameServerPingsResult>;
  readonly getServers: () => Promise<AccountGameServersResult>;
  readonly getState: () => Promise<AccountManagerState>;
  readonly launch: (
    request: AccountLaunchRequest,
  ) => Promise<AccountLaunchResult>;
  readonly onChanged: (
    listener: (state: AccountManagerState) => void,
  ) => () => void;
  readonly refreshServers: () => Promise<AccountGameServersResult>;
  readonly updateAccount: (
    username: string,
    patch: ManagedAccountPatch,
  ) => Promise<AccountManagerState>;
  readonly updateGroup: (
    name: string,
    patch: ManagedAccountGroupPatch,
  ) => Promise<AccountManagerState>;
}

export interface DesktopGameAccountsBridge {
  readonly getGameLaunch: () => Promise<AccountGameLaunchPayload | null>;
  readonly updateScriptStatus: (
    update: AccountScriptStatusUpdate,
  ) => Promise<void>;
}

export interface DesktopWindowsBridge {
  readonly open: (kind: DesktopBridgeWindowKind) => Promise<string>;
}

export interface DesktopArmyBridge {
  readonly fail: (payload: ArmyFailPayload) => Promise<void>;
  readonly leave: (payload: ArmyLeavePayload) => Promise<void>;
  readonly loadConfig: (configName: string) => Promise<ArmyConfigPayload>;
  readonly progress: (
    payload: ArmyProgressPayload,
  ) => Promise<ArmyProgressResult>;
  readonly start: (payload: ArmyStartPayload) => Promise<ArmySessionPayload>;
  readonly sync: (payload: ArmySyncPayload) => Promise<void>;
}

export interface DesktopBridge {
  readonly accounts?: DesktopAccountsBridge;
  readonly army?: DesktopArmyBridge;
  readonly combatProfiles?: DesktopCombatProfilesBridge;
  readonly gameAccounts?: DesktopGameAccountsBridge;
  readonly platform: {
    readonly os: AppPlatform;
  };
  readonly settings: DesktopSettingsBridge;
  readonly scripting?: DesktopScriptingBridge;
  readonly updates?: DesktopUpdatesBridge;
  readonly windows?: DesktopWindowsBridge;
}
