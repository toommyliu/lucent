import "../shared/generated/polyfills.renderer";

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
  readGameViewLayoutArgument,
  readTraceProjectionsArgument,
} from "../shared/rendererBootstrapArguments";
import type {
  AppPlatform,
  DesktopAccountsBridge,
  DesktopAccountSettingsBridge,
  DesktopBridgeByView,
  DesktopCombatProfilesBridge,
  DesktopEnvironmentBridge,
  DesktopFollowerBridge,
  DesktopGameAccountsBridge,
  DesktopGameConsoleObservabilityBridge,
  DesktopGameFollowerBridge,
  DesktopGameLoaderGrabberBridge,
  DesktopGamePacketsBridge,
  DesktopGameViewBridge,
  DesktopGameViewHostBridge,
  DesktopLoaderGrabberWindowBridge,
  DesktopPacketsWindowBridge,
  DesktopScriptingBridge,
  DesktopSettingsBridge,
  DesktopSettingsManagementBridge,
  DesktopWindowsBridge,
} from "../shared/desktopBridge";
import {
  AccountSettingsIpc,
  AccountsIpc,
  ArmyIpc,
  CombatProfilesIpc,
  DiagnosticsIpc,
  EnvironmentIpc,
  FollowerIpc,
  GameRendererIpc,
  GameViewsIpc,
  ScriptingIpc,
  SettingsIpc,
  UpdatesIpc,
  WindowsIpc,
  GameConsoleIpc,
  LoaderGrabberIpc,
  PacketsIpc,
  type RendererDiagnosticError,
  type RendererDiagnosticPayload,
} from "../shared/ipc";
import {
  createInvoke,
  createObservedInvoke,
  createSubscribe,
  type IpcInvokeObservation,
} from "./preloadIpcClient";

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
const initialGameViewLayout = readGameViewLayoutArgument(process.argv);
const applyBootstrapGameViewLayout = (): void => {
  try {
    // Grid game views should fill their renderer before app code mounts.
    if (initialGameViewLayout === "grid") {
      document.documentElement.setAttribute("data-topnav-hidden", "");
    }
  } catch {}
};

applyBootstrapGameViewLayout();

const bridgeView = readDesktopViewArgument(process.argv);
if (bridgeView === null) {
  throw new Error("Missing or invalid desktop bridge view.");
}
const debug = readDebugModeArgument(process.argv);
const gameConsoleObservabilityEnabled = readGameConsoleObservabilityArgument(
  process.argv,
);
const traceProjections = readTraceProjectionsArgument(process.argv);

const platform: AppPlatform =
  process.platform === "darwin"
    ? "mac"
    : process.platform === "win32"
      ? "windows"
      : "linux";

const diagnosticError = (cause: unknown): RendererDiagnosticError => {
  if (cause instanceof Error) {
    return {
      message: cause.message,
      name: cause.name,
      ...(cause.stack === undefined ? {} : { stack: cause.stack }),
    };
  }

  let message: string;
  try {
    message = typeof cause === "string" ? cause : String(cause);
  } catch {
    message = "[Unprintable error]";
  }
  return { message, name: "Error" };
};

const sendRendererDiagnostic = (payload: RendererDiagnosticPayload): void => {
  try {
    ipcRenderer.send(DiagnosticsIpc.rendererRecord.channel, payload);
  } catch {}
};

const invokeTransport = (channel: string, payload: unknown) =>
  ipcRenderer.invoke(channel, payload);

const reportInvoke = (observation: IpcInvokeObservation): void => {
  const {
    cause,
    channel,
    durationMs,
    endTimeUnixNano,
    name,
    outcome,
    stage,
    startTimeUnixNano,
    trace,
  } = observation;
  const error = cause === undefined ? undefined : diagnosticError(cause);
  sendRendererDiagnostic({
    type: "trace.span",
    span: {
      attributes: {
        "ipc.channel": channel,
        "ipc.name": name,
        "ipc.outcome": outcome,
        ...(stage === undefined ? {} : { "ipc.failure_stage": stage }),
        "renderer.view": bridgeView,
      },
      durationMs,
      endTimeUnixNano,
      events: [],
      exit:
        error === undefined
          ? { _tag: "Success" }
          : {
              _tag: "Failure",
              cause: error.stack ?? `${error.name}: ${error.message}`,
            },
      kind: "client",
      links: [],
      name: `ipc.roundtrip ${name}`,
      sampled: trace.sampled,
      source: "renderer",
      spanId: trace.spanId,
      startTimeUnixNano,
      traceId: trace.traceId,
    },
    view: bridgeView,
  });
};

const invoke = debug
  ? createObservedInvoke(invokeTransport, reportInvoke)
  : createInvoke(invokeTransport);

if (debug) {
  window.addEventListener("error", (event) => {
    sendRendererDiagnostic({
      type: "renderer.error",
      ...(event.colno === 0 ? {} : { columnNumber: event.colno }),
      error: diagnosticError(event.error ?? event.message),
      ...(event.lineno === 0 ? {} : { lineNumber: event.lineno }),
      observedAt: new Date().toISOString(),
      ...(event.filename === "" ? {} : { source: event.filename }),
      view: bridgeView,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    sendRendererDiagnostic({
      type: "renderer.unhandled-rejection",
      error: diagnosticError(event.reason),
      observedAt: new Date().toISOString(),
      view: bridgeView,
    });
  });
}
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

const settingsBridge: DesktopSettingsBridge = {
  initial: initialSettings,
  get: () => invoke(SettingsIpc.get, undefined),
  onChanged: (listener) => subscribe(SettingsIpc.changed, listener),
};

const settingsManagementBridge: DesktopSettingsManagementBridge = {
  ...settingsBridge,
  resetAppearance: () => invoke(SettingsIpc.resetAppearance, undefined),
  resetHotkeys: () => invoke(SettingsIpc.resetHotkeys, undefined),
  updateAppearance: (patch) => invoke(SettingsIpc.updateAppearance, patch),
  updateHotkeys: (patch) => invoke(SettingsIpc.updateHotkeys, patch),
  updatePreferences: (patch) => invoke(SettingsIpc.updatePreferences, patch),
};

const combatProfilesBridge: DesktopCombatProfilesBridge = {
  deleteProfile: (profileId) =>
    invoke(CombatProfilesIpc.deleteProfile, { profileId }),
  getState: () => invoke(CombatProfilesIpc.getState, undefined),
  onChanged: (listener) => subscribe(CombatProfilesIpc.changed, listener),
  saveProfile: (profile) => invoke(CombatProfilesIpc.saveProfile, profile),
};

const accountsBridge: DesktopAccountsBridge = {
  closeGameWindow: (request) => invoke(AccountsIpc.closeGameWindow, request),
  closeGameWindows: (gameWindowIds) =>
    invoke(AccountsIpc.closeGameWindows, { gameWindowIds }),
  createAccount: (draft) => invoke(AccountsIpc.createAccount, draft),
  createGroup: (draft) => invoke(AccountsIpc.createGroup, draft),
  deleteAccount: (username) => invoke(AccountsIpc.deleteAccount, { username }),
  deleteAccounts: (usernames) =>
    invoke(AccountsIpc.deleteAccounts, { usernames }),
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

const gameAccountsBridge: DesktopGameAccountsBridge = {
  getGameLaunch: () => invoke(AccountsIpc.getGameLaunch, undefined),
  prepareGameLoadRecovery: () =>
    invoke(AccountsIpc.prepareGameLoadRecovery, undefined),
  reportSession: (report) => invoke(AccountsIpc.reportSession, report),
};

const accountSettingsBridge: DesktopAccountSettingsBridge = {
  get: (username) => invoke(AccountSettingsIpc.get, { username }),
  update: (username, patch) =>
    invoke(AccountSettingsIpc.update, { patch, username }),
};

const scriptingBridge: DesktopScriptingBridge = {
  checkPackageUpdate: (packageName) =>
    invoke(ScriptingIpc.checkPackageUpdate, { packageName }),
  deleteCredential: (id) => invoke(ScriptingIpc.deleteCredential, { id }),
  getCatalog: () => invoke(ScriptingIpc.getCatalog, undefined),
  getCatalogPage: (request) => invoke(ScriptingIpc.getCatalogPage, request),
  getInputValues: (definition) =>
    invoke(ScriptingIpc.getInputValues, definition),
  loadReference: (reference) => invoke(ScriptingIpc.loadReference, reference),
  installPackage: (input) => invoke(ScriptingIpc.installPackage, input),
  listCredentials: () => invoke(ScriptingIpc.listCredentials, undefined),
  onCatalogChanged: (listener) =>
    subscribe(ScriptingIpc.catalogChanged, listener),
  openFile: () => invoke(ScriptingIpc.openFile, undefined),
  openPath: (path) => invoke(ScriptingIpc.openPath, { path }),
  openRepository: (repositoryUrl) =>
    invoke(ScriptingIpc.openRepository, { repositoryUrl }),
  readFile: (path) => invoke(ScriptingIpc.readFile, { path }),
  readReference: (reference) => invoke(ScriptingIpc.readReference, reference),
  refreshCatalog: () => invoke(ScriptingIpc.refreshCatalog, undefined),
  removePackage: (input) => invoke(ScriptingIpc.removePackage, input),
  resolveFile: (path) => invoke(ScriptingIpc.resolveFile, { path }),
  resolveReference: (reference) =>
    invoke(ScriptingIpc.resolveReference, reference),
  saveInputValues: (definition, values) =>
    invoke(ScriptingIpc.saveInputValues, { definition, values }),
  saveCredential: (input) => invoke(ScriptingIpc.saveCredential, input),
  selectFile: () => invoke(ScriptingIpc.selectFile, undefined),
  updatePackage: (input) => invoke(ScriptingIpc.updatePackage, input),
};

const gameConsoleObservabilityBridge: DesktopGameConsoleObservabilityBridge = {
  message: (message) => {
    ipcRenderer.send(GameConsoleIpc.rendererMessage.channel, { message });
  },
};

const windowsBridge: DesktopWindowsBridge = {
  open: (kind) => invoke(WindowsIpc.open, { kind }),
};

const loaderGrabberWindowBridge: DesktopLoaderGrabberWindowBridge = {
  grab: (payload) => invoke(LoaderGrabberIpc.grab, payload),
  load: (payload) => invoke(LoaderGrabberIpc.load, payload),
};

const gameViewHostBridge: DesktopGameViewHostBridge = {
  add: () => invoke(GameViewsIpc.add, undefined),
  close: (id) => invoke(GameViewsIpc.close, { id }),
  dispatchGroupCommand: (request) =>
    invoke(GameViewsIpc.dispatchGroupCommand, request),
  getState: () => invoke(GameViewsIpc.getState, undefined),
  onChanged: (listener) => subscribe(GameViewsIpc.changed, listener),
  onShortcutModifierChanged: (listener) =>
    subscribe(GameViewsIpc.shortcutModifierChanged, listener),
  onTabMenuOpenChanged: (listener) =>
    subscribe(GameViewsIpc.tabMenuOpenChanged, listener),
  reorder: (ids) => invoke(GameViewsIpc.reorder, { ids }),
  select: (id, focus) => invoke(GameViewsIpc.select, { focus, id }),
  setGroupControlsOpen: (open) =>
    invoke(GameViewsIpc.setGroupControlsOpen, { open }),
  setGroupTargets: (ids) => invoke(GameViewsIpc.setGroupTargets, { ids }),
  setLayout: (layout) => invoke(GameViewsIpc.setLayout, { layout }),
  setTabMenuOpen: (open) => invoke(GameViewsIpc.setTabMenuOpen, { open }),
  syncTabBarLayout: () => invoke(GameViewsIpc.syncTabBarLayout, undefined),
};

const gameViewBridge: DesktopGameViewBridge = {
  activate: () => invoke(GameViewsIpc.activate, undefined),
  close: () => {
    void invoke(GameViewsIpc.closeCurrent, undefined).catch((cause) => {
      console.error("Failed to close the current game client.", cause);
    });
  },
  dispatchGroupOptionHotkey: (commandId) =>
    invoke(GameViewsIpc.dispatchGroupOptionHotkey, { commandId }),
  getPresentation: () => invoke(GameViewsIpc.getPresentation, undefined),
  initialLayout: initialGameViewLayout,
  onGroupCommand: (listener) => subscribe(GameViewsIpc.groupCommand, listener),
  onPresentationChanged: (listener) =>
    subscribe(GameViewsIpc.presentationChanged, listener),
};

const gameLoaderGrabberBridge: DesktopGameLoaderGrabberBridge = {
  onRequest: (listener) => subscribe(LoaderGrabberIpc.request, listener),
  respond: (response) => invoke(LoaderGrabberIpc.respond, response),
};

const packetsWindowBridge: DesktopPacketsWindowBridge = {
  getStatus: () => invoke(PacketsIpc.getStatus, undefined),
  onCaptured: (listener) => subscribe(PacketsIpc.captured, listener),
  onStatus: (listener) => subscribe(PacketsIpc.status, listener),
  send: (payload) => invoke(PacketsIpc.send, payload),
  startCapture: () => invoke(PacketsIpc.startCapture, undefined),
  startQueue: (payload) => invoke(PacketsIpc.startQueue, payload),
  stopCapture: () => invoke(PacketsIpc.stopCapture, undefined),
  stopQueue: () => invoke(PacketsIpc.stopQueue, undefined),
};

const gamePacketsBridge: DesktopGamePacketsBridge = {
  onRequest: (listener) => subscribe(PacketsIpc.request, listener),
  publishCaptured: (payload) => invoke(PacketsIpc.publishCaptured, payload),
  publishStatus: (payload) => invoke(PacketsIpc.publishStatus, payload),
  respond: (response) => invoke(PacketsIpc.respond, response),
};

const followerBridge: DesktopFollowerBridge = {
  configure: (payload) => invoke(FollowerIpc.configure, payload),
  getConfig: () => invoke(FollowerIpc.getConfig, undefined),
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

const gameFollowerBridge: DesktopGameFollowerBridge = {
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

const environmentBridge: DesktopEnvironmentBridge = {
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

const commonBridge = {
  debug,
  platform: {
    os: platform,
  },
  settings: settingsBridge,
  traceProjections,
};

const bridges = {
  "account-manager": {
    ...commonBridge,
    accounts: accountsBridge,
    scripting: scriptingBridge,
    view: "account-manager",
  },
  "combat-profiles": {
    ...commonBridge,
    combatProfiles: combatProfilesBridge,
    view: "combat-profiles",
  },
  environment: {
    ...commonBridge,
    environment: environmentBridge,
    view: "environment",
  },
  follower: {
    ...commonBridge,
    combatProfiles: combatProfilesBridge,
    follower: followerBridge,
    view: "follower",
    windows: windowsBridge,
  },
  game: {
    ...commonBridge,
    accountSettings: accountSettingsBridge,
    army: {
      fail: (payload) => invoke(ArmyIpc.fail, payload),
      leave: (payload) => invoke(ArmyIpc.leave, payload),
      loadConfig: (configName) => invoke(ArmyIpc.loadConfig, { configName }),
      loopTauntAwait: (payload) => invoke(ArmyIpc.loopTauntAwait, payload),
      loopTauntLeave: (payload) => invoke(ArmyIpc.loopTauntLeave, payload),
      loopTauntRegister: (payload) =>
        invoke(ArmyIpc.loopTauntRegister, payload),
      loopTauntReport: (payload) => invoke(ArmyIpc.loopTauntReport, payload),
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
    gameRenderer: {
      beginScriptExecution: () =>
        invoke(GameRendererIpc.beginScriptExecution, undefined),
      finishScriptExecution: (token) =>
        invoke(GameRendererIpc.finishScriptExecution, { token }),
      getGeneration: () => invoke(GameRendererIpc.getGeneration, undefined),
      ready: (generation) => invoke(GameRendererIpc.ready, { generation }),
    },
    gameView: gameViewBridge,
    loaderGrabber: gameLoaderGrabberBridge,
    packets: gamePacketsBridge,
    scripting: scriptingBridge,
    view: "game",
    windows: windowsBridge,
    ...(gameConsoleObservabilityEnabled
      ? { gameConsoleObservability: gameConsoleObservabilityBridge }
      : {}),
  },
  "game-group-controls": {
    ...commonBridge,
    gameViewHost: gameViewHostBridge,
    view: "game-group-controls",
  },
  "game-host": {
    ...commonBridge,
    gameViewHost: gameViewHostBridge,
    view: "game-host",
  },
  "loader-grabber": {
    ...commonBridge,
    loaderGrabber: loaderGrabberWindowBridge,
    view: "loader-grabber",
  },
  packets: {
    ...commonBridge,
    packets: packetsWindowBridge,
    view: "packets",
  },
  settings: {
    ...commonBridge,
    settings: settingsManagementBridge,
    updates: {
      checkNow: (options) => invoke(UpdatesIpc.checkNow, options ?? {}),
      getState: () => invoke(UpdatesIpc.getState, undefined),
      onChanged: (listener) => subscribe(UpdatesIpc.changed, listener),
      openReleasePage: () => invoke(UpdatesIpc.openReleasePage, undefined),
    },
    view: "settings",
  },
} satisfies DesktopBridgeByView;

const bridge = bridges[bridgeView];

contextBridge.exposeInMainWorld("desktop", bridge);
