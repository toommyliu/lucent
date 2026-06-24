import "../shared/polyfills";

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import {
  applyAppearanceSnapshotToDocument,
  readDesktopViewArgument,
  readAppearanceSnapshotArgument,
  readSettingsSnapshotArgument,
} from "../shared/appearance";
import type { DesktopBridge, AppPlatform } from "../shared/desktopBridge";
import { SettingsIpc, UpdatesIpc } from "../shared/ipc";
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

const bridge: DesktopBridge = {
  platform: {
    os: platform,
  },
  settings: settingsBridge,
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
