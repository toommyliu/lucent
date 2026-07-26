import "../shared/polyfills";

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import {
  applyAppearanceSnapshotToDocument,
  readDesktopViewArgument,
  readAppearanceSnapshotArgument,
  readSettingsSnapshotArgument,
} from "../shared/appearance";
import {
  readDebugModeArgument,
  readGameConsoleObservabilityArgument,
} from "../shared/rendererBootstrapArguments";
import type { DesktopBridge, AppPlatform } from "../shared/desktopBridge";
import {
  AccountSettingsIpc,
  AccountsIpc,
  ArmyIpc,
  CombatProfilesIpc,
  EnvironmentIpc,
  FollowerIpc,
  ScriptingIpc,
  SettingsIpc,
  UpdatesIpc,
  WindowsIpc,
  GameConsoleIpc,
  LoaderGrabberIpc,
  PacketsIpc,
} from "../shared/ipc";
import { createInvoke, createSubscribe } from "./preloadIpcClient";

const applyBootstrapAppearance = (): void => {
  try {
    const snapshot = readAppearanceSnapshotArgument(process.argv);
    if (snapshot !== null) {
      applyAppearanceSnapshotToDocument(document.documentElement, snapshot);
    }
  } catch {}
};

applyBootstrapAppearance();

const initialSettings = readSettingsSnapshotArgument(process.argv);
const bridgeView = readDesktopViewArgument(process.argv);
const debug = readDebugModeArgument(process.argv);
const gameConsoleObservabilityEnabled = readGameConsoleObservabilityArgument(
  process.argv,
);

const platform: AppPlatform =
  process.platform === "darwin"
    ? "mac"
    : process.platform === "win32"
      ? "windows"
      : "linux";

const invoke = createInvoke((channel, payload) =>
  ipcRenderer.invoke(channel, payload),
);
const eventWrappers = new WeakMap<
  (rawPayload: unknown) => void,
  (event: IpcRendererEvent, rawPayload: unknown) => void
>();
const subscribe = createSubscribe({
  on: (channel, listener) => {
    const wrapper = (_event: IpcRendererEvent, rawPayload: unknown) =>
      listener(rawPayload);
    eventWrappers.set(listener, wrapper);
    ipcRenderer.on(channel, wrapper);
  },
  removeListener: (channel, listener) => {
    const wrapper = eventWrappers.get(listener);
    if (wrapper !== undefined) {
      ipcRenderer.removeListener(channel, wrapper);
      eventWrappers.delete(listener);
    }
  },
});

const settingsBridge: DesktopBridge["settings"] = {
  initial: initialSettings,
  get: () => invoke(SettingsIpc.get, undefined),
  onChanged: (listener) => subscribe(SettingsIpc.changed, listener),
  ...(bridgeView === "settings"
    ? {
        resetAppearance: () => invoke(SettingsIpc.resetAppearance, undefined),
        resetHotkeys: () => invoke(SettingsIpc.resetHotkeys, undefined),
        updateAppearance: (patch) =>
          invoke(SettingsIpc.updateAppearance, patch),
        updateHotkeys: (patch) => invoke(SettingsIpc.updateHotkeys, patch),
        updatePreferences: (patch) =>
          invoke(SettingsIpc.updatePreferences, patch),
      }
    : {}),
};

const combatProfilesBridge: NonNullable<DesktopBridge["combatProfiles"]> = {
  deleteProfile: (profileId) =>
    invoke(CombatProfilesIpc.deleteProfile, { profileId }),
  getState: () => invoke(CombatProfilesIpc.getState, undefined),
  onChanged: (listener) => subscribe(CombatProfilesIpc.changed, listener),
  saveProfile: (profile) => invoke(CombatProfilesIpc.saveProfile, profile),
};

const accountsBridge: NonNullable<DesktopBridge["accounts"]> = {
  closeGameWindow: (request) => invoke(AccountsIpc.closeGameWindow, request),
  createAccount: (draft) => invoke(AccountsIpc.createAccount, draft),
  createGroup: (draft) => invoke(AccountsIpc.createGroup, draft),
  deleteAccount: (username) => invoke(AccountsIpc.deleteAccount, { username }),
  deleteGroup: (name) => invoke(AccountsIpc.deleteGroup, { name }),
  focusGameWindow: (request) => invoke(AccountsIpc.focusGameWindow, request),
  getServerPings: () => invoke(AccountsIpc.getServerPings, undefined),
  getServers: () => invoke(AccountsIpc.getServers, undefined),
  getState: () => invoke(AccountsIpc.getState, undefined),
  launch: (request) => invoke(AccountsIpc.launch, request),
  onChanged: (listener) => subscribe(AccountsIpc.changed, listener),
  refreshServers: () => invoke(AccountsIpc.refreshServers, undefined),
  updateAccount: (username, patch) =>
    invoke(AccountsIpc.updateAccount, { username, patch }),
  updateGroup: (name, patch) =>
    invoke(AccountsIpc.updateGroup, { name, patch }),
};

const gameAccountsBridge: NonNullable<DesktopBridge["gameAccounts"]> = {
  getGameLaunch: () => invoke(AccountsIpc.getGameLaunch, undefined),
  updateScriptStatus: (update) =>
    invoke(AccountsIpc.updateScriptStatus, update),
};

const accountSettingsBridge: NonNullable<DesktopBridge["accountSettings"]> = {
  get: (username) => invoke(AccountSettingsIpc.get, { username }),
  update: (username, patch) =>
    invoke(AccountSettingsIpc.update, { patch, username }),
};

const gameConsoleObservabilityBridge: NonNullable<
  DesktopBridge["gameConsoleObservability"]
> = {
  message: (message) => {
    ipcRenderer.send(GameConsoleIpc.rendererMessage.channel, { message });
  },
};

const windowsBridge: NonNullable<DesktopBridge["windows"]> = {
  open: (kind) => invoke(WindowsIpc.open, { kind }),
};

const loaderGrabberBridge: DesktopBridge["loaderGrabber"] = {
  grab: (payload) => invoke(LoaderGrabberIpc.grab, payload),
  load: (payload) => invoke(LoaderGrabberIpc.load, payload),
  onRequest: (listener) => subscribe(LoaderGrabberIpc.request, listener),
  respond: (response) => invoke(LoaderGrabberIpc.respond, response),
};

const packetsBridge: NonNullable<DesktopBridge["packets"]> = {
  onCaptured: (listener) => subscribe(PacketsIpc.captured, listener),
  onRequest: (listener) => subscribe(PacketsIpc.request, listener),
  onStatus: (listener) => subscribe(PacketsIpc.status, listener),
  publishCaptured: (payload) => invoke(PacketsIpc.publishCaptured, payload),
  publishStatus: (payload) => invoke(PacketsIpc.publishStatus, payload),
  respond: (response) => invoke(PacketsIpc.respond, response),
  send: (payload) => invoke(PacketsIpc.send, payload),
  startCapture: () => invoke(PacketsIpc.startCapture, undefined),
  startQueue: (payload) => invoke(PacketsIpc.startQueue, payload),
  stopCapture: () => invoke(PacketsIpc.stopCapture, undefined),
  stopQueue: () => invoke(PacketsIpc.stopQueue, undefined),
};

const followerBridge: NonNullable<DesktopBridge["follower"]> = {
  configure: (payload) => invoke(FollowerIpc.configure, payload),
  getPlayers: () => invoke(FollowerIpc.getPlayers, undefined),
  getState: () => invoke(FollowerIpc.getState, undefined),
  me: () => invoke(FollowerIpc.me, undefined),
  onChanged: (listener) => subscribe(FollowerIpc.changed, listener),
  onPlayersChanged: (listener) =>
    subscribe(FollowerIpc.playersChanged, listener),
  start: (payload) => invoke(FollowerIpc.start, payload),
  stop: () => invoke(FollowerIpc.stop, undefined),
};

const followerErrorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : "Follower request failed";

const gameFollowerBridge: NonNullable<DesktopBridge["gameFollower"]> = {
  onCommand: (listener) =>
    subscribe(FollowerIpc.command, (command) => {
      void Promise.resolve()
        .then(() => listener(command))
        .then((outcome) => {
          if (outcome.kind !== command.kind) {
            throw new Error(
              `Follower returned ${outcome.kind} for ${command.kind}`,
            );
          }
          return {
            ok: true as const,
            outcome,
            requestId: command.requestId,
          };
        })
        .catch((cause: unknown) => ({
          error: followerErrorMessage(cause),
          ok: false as const,
          requestId: command.requestId,
        }))
        .then((response) => invoke(FollowerIpc.respond, response))
        .catch((cause: unknown) => {
          console.error("Failed to respond to follower command:", cause);
        });
    }),
  publishPlayers: (players) => invoke(FollowerIpc.publishPlayers, players),
  publishState: (state) => invoke(FollowerIpc.publishState, state),
};

const environmentBridge: NonNullable<DesktopBridge["environment"]> = {
  addBoost: (name) => invoke(EnvironmentIpc.addBoost, { name }),
  addBoosts: (names) => invoke(EnvironmentIpc.addBoosts, { names }),
  addItem: (name) => invoke(EnvironmentIpc.addItem, { name }),
  addItems: (names) => invoke(EnvironmentIpc.addItems, { names }),
  addQuest: (questId, rewardItemId) =>
    invoke(EnvironmentIpc.addQuest, {
      questId,
      ...(rewardItemId === undefined ? {} : { rewardItemId }),
    }),
  addQuests: (quests) => invoke(EnvironmentIpc.addQuests, { quests }),
  clear: () => invoke(EnvironmentIpc.clear, undefined),
  clearBoosts: () => invoke(EnvironmentIpc.clearBoosts, undefined),
  clearItems: () => invoke(EnvironmentIpc.clearItems, undefined),
  clearQuestReward: (questId) =>
    invoke(EnvironmentIpc.clearQuestReward, { questId }),
  clearQuests: () => invoke(EnvironmentIpc.clearQuests, undefined),
  fetchBoosts: () => invoke(EnvironmentIpc.fetchBoosts, undefined),
  getState: () => invoke(EnvironmentIpc.getState, undefined),
  onChanged: (listener) => subscribe(EnvironmentIpc.changed, listener),
  onFetchBoostsRequest: (listener) =>
    subscribe(EnvironmentIpc.fetchBoostsRequest, ({ requestId }) => {
      void Promise.resolve()
        .then(listener)
        .catch(() => ({ bank: [], bankLoaded: false, inventory: [] }))
        .then((discovery) =>
          invoke(EnvironmentIpc.fetchBoostsResponse, {
            discovery,
            requestId,
          }),
        )
        .catch(() => undefined);
    }),
  onWithdrawBoostsRequest: (listener) =>
    subscribe(
      EnvironmentIpc.withdrawBoostsRequest,
      ({ itemIds, requestId }) => {
        void Promise.resolve()
          .then(() => listener(itemIds))
          .catch(() => [])
          .then((withdrawnItemIds) =>
            invoke(EnvironmentIpc.withdrawBoostsResponse, {
              itemIds: withdrawnItemIds,
              requestId,
            }),
          )
          .catch(() => undefined);
      },
    ),
  removeBoost: (name) => invoke(EnvironmentIpc.removeBoost, { name }),
  removeItem: (name) => invoke(EnvironmentIpc.removeItem, { name }),
  removeQuest: (questId) => invoke(EnvironmentIpc.removeQuest, { questId }),
  setAutomationEnabled: (capability, enabled) =>
    invoke(EnvironmentIpc.setAutomationEnabled, { capability, enabled }),
  setItemNotification: (name, enabled) =>
    invoke(EnvironmentIpc.setItemNotification, { enabled, name }),
  setItemRules: (rules) => invoke(EnvironmentIpc.setItemRules, rules),
  setQuestAutoRegister: (options) =>
    invoke(EnvironmentIpc.setQuestAutoRegister, options),
  setQuestReward: (questId, rewardItemId) =>
    invoke(EnvironmentIpc.setQuestReward, { questId, rewardItemId }),
  syncToAll: () => invoke(EnvironmentIpc.syncToAll, undefined),
  withdrawBoosts: (itemIds) =>
    invoke(EnvironmentIpc.withdrawBoosts, { itemIds }),
};

const bridge: DesktopBridge = {
  debug,
  loaderGrabber: loaderGrabberBridge,
  platform: {
    os: platform,
  },
  settings: settingsBridge,
  ...(bridgeView === "game"
    ? {
        accountSettings: accountSettingsBridge,
        army: {
          fail: (payload) => invoke(ArmyIpc.fail, payload),
          leave: (payload) => invoke(ArmyIpc.leave, payload),
          loadConfig: (configName) =>
            invoke(ArmyIpc.loadConfig, { configName }),
          loopTauntAwait: (payload) => invoke(ArmyIpc.loopTauntAwait, payload),
          loopTauntLeave: (payload) => invoke(ArmyIpc.loopTauntLeave, payload),
          loopTauntRegister: (payload) =>
            invoke(ArmyIpc.loopTauntRegister, payload),
          loopTauntReport: (payload) =>
            invoke(ArmyIpc.loopTauntReport, payload),
          loopTauntReady: (payload) => invoke(ArmyIpc.loopTauntReady, payload),
          onEnded: (listener) => subscribe(ArmyIpc.ended, listener),
          onLoopTauntCommand: (listener) =>
            subscribe(ArmyIpc.loopTauntCommand, listener),
          progress: (payload) => invoke(ArmyIpc.progress, payload),
          start: (payload) => invoke(ArmyIpc.start, payload),
          sync: (payload) => invoke(ArmyIpc.sync, payload),
        },
        combatProfiles: combatProfilesBridge,
        environment: environmentBridge,
        gameAccounts: gameAccountsBridge,
        gameFollower: gameFollowerBridge,
        packets: packetsBridge,
        ...(gameConsoleObservabilityEnabled
          ? { gameConsoleObservability: gameConsoleObservabilityBridge }
          : {}),
        scripting: {
          getInputValues: (definition) =>
            invoke(ScriptingIpc.getInputValues, definition),
          openFile: () => invoke(ScriptingIpc.openFile, undefined),
          openPath: (path) => invoke(ScriptingIpc.openPath, { path }),
          readFile: (path) => invoke(ScriptingIpc.readFile, { path }),
          resolveFile: (path) => invoke(ScriptingIpc.resolveFile, { path }),
          selectFile: () => invoke(ScriptingIpc.selectFile, undefined),
          saveInputValues: (definition, values) =>
            invoke(ScriptingIpc.saveInputValues, { definition, values }),
        },
        windows: windowsBridge,
      }
    : {}),
  ...(bridgeView === "environment"
    ? {
        environment: environmentBridge,
      }
    : {}),
  ...(bridgeView === "follower"
    ? {
        combatProfiles: combatProfilesBridge,
        follower: followerBridge,
        windows: windowsBridge,
      }
    : {}),
  ...(bridgeView === "packets"
    ? {
        packets: packetsBridge,
      }
    : {}),
  ...(bridgeView === "account-manager"
    ? {
        accounts: accountsBridge,
        scripting: {
          getInputValues: (definition) =>
            invoke(ScriptingIpc.getInputValues, definition),
          openFile: () => invoke(ScriptingIpc.openFile, undefined),
          openPath: (path) => invoke(ScriptingIpc.openPath, { path }),
          readFile: (path) => invoke(ScriptingIpc.readFile, { path }),
          resolveFile: (path) => invoke(ScriptingIpc.resolveFile, { path }),
          selectFile: () => invoke(ScriptingIpc.selectFile, undefined),
          saveInputValues: (definition, values) =>
            invoke(ScriptingIpc.saveInputValues, { definition, values }),
        },
      }
    : {}),
  ...(bridgeView === "combat-profiles"
    ? {
        combatProfiles: combatProfilesBridge,
      }
    : {}),
  ...(bridgeView === "settings"
    ? {
        updates: {
          checkNow: (options) => invoke(UpdatesIpc.checkNow, options ?? {}),
          getState: () => invoke(UpdatesIpc.getState, undefined),
          onChanged: (listener) => subscribe(UpdatesIpc.changed, listener),
          openReleasePage: () => invoke(UpdatesIpc.openReleasePage, undefined),
        },
      }
    : {}),
};

contextBridge.exposeInMainWorld("desktop", bridge);
