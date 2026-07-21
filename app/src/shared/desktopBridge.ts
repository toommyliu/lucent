import type {
  AppSettings,
  AppearancePatch,
  PreferencesPatch,
} from "@lucent/core/settings";
import type {
  EnvironmentAutomationCapability,
  EnvironmentItemRules,
  EnvironmentQuestAutoRegisterOptions,
  EnvironmentQuestRegistration,
  EnvironmentState,
} from "@lucent/core/environment";
import type { HotkeysPatch } from "@lucent/core/hotkeys";
import type {
  CombatProfile,
  CombatProfileLibrary,
} from "@lucent/core/combatProfiles";
import type {
  ArmyConfigPayload,
  ArmyFailPayload,
  ArmyLeavePayload,
  ArmyLoopTauntCommandPayload,
  ArmyLoopTauntLeavePayload,
  ArmyLoopTauntRegisterPayload,
  ArmyLoopTauntRegisterResult,
  ArmyLoopTauntReportPayload,
  ArmyLoopTauntRunPayload,
  ArmyLoopTauntTerminalResult,
  ArmyProgressPayload,
  ArmyProgressResult,
  ArmySessionEndedPayload,
  ArmySessionPayload,
  ArmyStartPayload,
  ArmySyncPayload,
} from "@lucent/core/army";
import type {
  ScriptFile,
  ScriptFileResolution,
  ScriptOpenFileResult,
  ScriptSelectFileResult,
} from "./ipc/scripting";
import type { EnvironmentBoostDiscovery } from "./ipc/environment";
import type {
  ScriptInputsDefinition,
  ScriptInputValues,
} from "@lucent/core/scriptInputs";
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
} from "@lucent/core/accounts";

export type AppPlatform = "linux" | "mac" | "windows";
export type DesktopBridgeView =
  | "account-manager"
  | "combat-profiles"
  | "environment"
  | "game"
  | "settings";
export type DesktopBridgeWindowKind =
  | "account-manager"
  | "combat-profiles"
  | "environment"
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
  readonly resolveFile: (path: string) => Promise<ScriptFileResolution>;
  readonly selectFile: () => Promise<ScriptSelectFileResult>;
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

export interface DesktopGameConsoleObservabilityBridge {
  readonly message: (message: string) => void;
}

export interface DesktopWindowsBridge {
  readonly open: (kind: DesktopBridgeWindowKind) => Promise<string>;
}

export interface DesktopEnvironmentBridge {
  readonly addBoost: (name: string) => Promise<EnvironmentState>;
  readonly addBoosts: (names: readonly string[]) => Promise<EnvironmentState>;
  readonly addItem: (name: string) => Promise<EnvironmentState>;
  readonly addItems: (names: readonly string[]) => Promise<EnvironmentState>;
  readonly addQuest: (
    questId: number | string,
    rewardItemId?: number | string,
  ) => Promise<EnvironmentState>;
  readonly addQuests: (
    quests: readonly EnvironmentQuestRegistration[],
  ) => Promise<EnvironmentState>;
  readonly clear: () => Promise<EnvironmentState>;
  readonly clearBoosts: () => Promise<EnvironmentState>;
  readonly clearItems: () => Promise<EnvironmentState>;
  readonly clearQuestReward: (
    questId: number | string,
  ) => Promise<EnvironmentState>;
  readonly clearQuests: () => Promise<EnvironmentState>;
  readonly fetchBoosts: () => Promise<EnvironmentBoostDiscovery>;
  readonly getState: () => Promise<EnvironmentState>;
  readonly onChanged: (
    listener: (state: EnvironmentState) => void,
  ) => () => void;
  readonly onFetchBoostsRequest: (
    listener: () =>
      | Promise<EnvironmentBoostDiscovery>
      | EnvironmentBoostDiscovery,
  ) => () => void;
  readonly onWithdrawBoostsRequest: (
    listener: (
      itemIds: readonly number[],
    ) => Promise<readonly number[]> | readonly number[],
  ) => () => void;
  readonly removeBoost: (name: string) => Promise<EnvironmentState>;
  readonly removeItem: (name: string) => Promise<EnvironmentState>;
  readonly removeQuest: (questId: number | string) => Promise<EnvironmentState>;
  readonly setAutomationEnabled: (
    capability: EnvironmentAutomationCapability,
    enabled: boolean,
  ) => Promise<EnvironmentState>;
  readonly setItemNotification: (
    name: string,
    enabled: boolean,
  ) => Promise<EnvironmentState>;
  readonly setItemRules: (
    rules: EnvironmentItemRules,
  ) => Promise<EnvironmentState>;
  readonly setQuestAutoRegister: (
    options: EnvironmentQuestAutoRegisterOptions,
  ) => Promise<EnvironmentState>;
  readonly setQuestReward: (
    questId: number | string,
    rewardItemId: number | string,
  ) => Promise<EnvironmentState>;
  readonly syncToAll: () => Promise<EnvironmentState>;
  readonly withdrawBoosts: (
    itemIds: readonly number[],
  ) => Promise<readonly number[]>;
}

export interface DesktopArmyBridge {
  readonly fail: (payload: ArmyFailPayload) => Promise<void>;
  readonly leave: (payload: ArmyLeavePayload) => Promise<void>;
  readonly loadConfig: (configName: string) => Promise<ArmyConfigPayload>;
  readonly loopTauntAwait: (
    payload: ArmyLoopTauntRunPayload,
  ) => Promise<ArmyLoopTauntTerminalResult>;
  readonly loopTauntLeave: (
    payload: ArmyLoopTauntLeavePayload,
  ) => Promise<void>;
  readonly loopTauntRegister: (
    payload: ArmyLoopTauntRegisterPayload,
  ) => Promise<ArmyLoopTauntRegisterResult>;
  readonly loopTauntReport: (
    payload: ArmyLoopTauntReportPayload,
  ) => Promise<void>;
  readonly loopTauntReady: (payload: ArmyLoopTauntRunPayload) => Promise<void>;
  readonly onEnded: (
    listener: (payload: ArmySessionEndedPayload) => void,
  ) => () => void;
  readonly onLoopTauntCommand: (
    listener: (payload: ArmyLoopTauntCommandPayload) => void,
  ) => () => void;
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
  readonly debug: boolean;
  readonly environment?: DesktopEnvironmentBridge;
  readonly gameAccounts?: DesktopGameAccountsBridge;
  readonly gameConsoleObservability?: DesktopGameConsoleObservabilityBridge;
  readonly platform: {
    readonly os: AppPlatform;
  };
  readonly settings: DesktopSettingsBridge;
  readonly scripting?: DesktopScriptingBridge;
  readonly updates?: DesktopUpdatesBridge;
  readonly windows?: DesktopWindowsBridge;
}
