import "../shared/polyfills";

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import {
  applyAppearanceSnapshotToDocument,
  readDesktopViewArgument,
  readAppearanceSnapshotArgument,
  readSettingsSnapshotArgument,
} from "../shared/appearance";
import type { DesktopBridge, AppPlatform } from "../shared/desktopBridge";
import {
  AccountsIpc,
  ArmyIpc,
  CombatProfilesIpc,
  ScriptingIpc,
  SettingsIpc,
  UpdatesIpc,
  WindowsIpc,
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

const windowsBridge: NonNullable<DesktopBridge["windows"]> = {
  open: (kind) => invoke(WindowsIpc.open, { kind }),
};

const bridge: DesktopBridge = {
  platform: {
    os: platform,
  },
  settings: settingsBridge,
  ...(bridgeView === "game"
    ? {
        army: {
          fail: (payload) => invoke(ArmyIpc.fail, payload),
          leave: (payload) => invoke(ArmyIpc.leave, payload),
          loadConfig: (configName) =>
            invoke(ArmyIpc.loadConfig, { configName }),
          progress: (payload) => invoke(ArmyIpc.progress, payload),
          start: (payload) => invoke(ArmyIpc.start, payload),
          sync: (payload) => invoke(ArmyIpc.sync, payload),
        },
        combatProfiles: combatProfilesBridge,
        gameAccounts: gameAccountsBridge,
        scripting: {
          getInputValues: (definition) =>
            invoke(ScriptingIpc.getInputValues, definition),
          openFile: () => invoke(ScriptingIpc.openFile, undefined),
          openPath: (path) => invoke(ScriptingIpc.openPath, { path }),
          readFile: (path) => invoke(ScriptingIpc.readFile, { path }),
          saveInputValues: (definition, values) =>
            invoke(ScriptingIpc.saveInputValues, { definition, values }),
        },
        windows: windowsBridge,
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
