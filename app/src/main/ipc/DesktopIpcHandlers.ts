import * as Effect from "effect/Effect";

import { DesktopIpc } from "./DesktopIpc";
import * as AccountsIpcMethods from "./methods/accounts";
import * as AccountSettingsIpcMethods from "./methods/accountSettings";
import * as ArmyIpcMethods from "./methods/army";
import * as CombatProfilesIpcMethods from "./methods/combatProfiles";
import * as EnvironmentIpcMethods from "./methods/environment";
import * as FollowerIpcMethods from "./methods/follower";
import * as FileSystemIpcMethods from "./methods/filesystem";
import * as GameRendererIpcMethods from "./methods/gameRenderer";
import * as GameViewsIpcMethods from "./methods/gameViews";
import * as LoaderGrabberIpcMethods from "./methods/loaderGrabber";
import * as PacketsIpcMethods from "./methods/packets";
import * as ScriptingIpcMethods from "./methods/scripting";
import * as SettingsIpcMethods from "./methods/settings";
import * as UpdatesIpcMethods from "./methods/updates";
import * as WindowsIpcMethods from "./methods/windows";

export const installDesktopIpcHandlers = Effect.fn(
  "desktop.ipc.installHandlers",
)(function* () {
  const ipc = yield* DesktopIpc;

  yield* AccountsIpcMethods.installEventForwarding();
  yield* ArmyIpcMethods.installLifecycle();
  yield* CombatProfilesIpcMethods.installEventForwarding();
  yield* SettingsIpcMethods.installEventForwarding();
  yield* ScriptingIpcMethods.installEventForwarding();
  yield* UpdatesIpcMethods.installEventForwarding();

  for (const method of WindowsIpcMethods.methods) {
    yield* ipc.handle(method);
  }
  for (const method of AccountsIpcMethods.methods) {
    yield* ipc.handle(method);
  }
  for (const method of AccountSettingsIpcMethods.methods) {
    yield* ipc.handle(method);
  }
  for (const method of ArmyIpcMethods.methods) {
    yield* ipc.handle(method);
  }
  for (const method of CombatProfilesIpcMethods.methods) {
    yield* ipc.handle(method);
  }
  for (const method of EnvironmentIpcMethods.methods) {
    yield* ipc.handle(method);
  }
  for (const method of FollowerIpcMethods.methods) {
    yield* ipc.handle(method);
  }
  for (const method of FileSystemIpcMethods.methods) {
    yield* ipc.handle(method);
  }
  yield* ipc.handle(GameRendererIpcMethods.beginScriptExecution);
  yield* ipc.handle(GameRendererIpcMethods.finishScriptExecution);
  yield* ipc.handle(GameRendererIpcMethods.getGeneration);
  yield* ipc.handle(GameRendererIpcMethods.ready);
  for (const method of GameViewsIpcMethods.methods) {
    yield* ipc.handle(method);
  }
  for (const method of LoaderGrabberIpcMethods.methods) {
    yield* ipc.handle(method);
  }
  yield* ipc.handle(PacketsIpcMethods.getStatus);
  yield* ipc.handle(PacketsIpcMethods.startCapture);
  yield* ipc.handle(PacketsIpcMethods.stopCapture);
  yield* ipc.handle(PacketsIpcMethods.send);
  yield* ipc.handle(PacketsIpcMethods.startQueue);
  yield* ipc.handle(PacketsIpcMethods.stopQueue);
  yield* ipc.handle(PacketsIpcMethods.publishCaptured);
  yield* ipc.handle(PacketsIpcMethods.publishStatus);
  yield* ipc.handle(PacketsIpcMethods.respond);
  for (const method of SettingsIpcMethods.methods) {
    yield* ipc.handle(method);
  }
  for (const method of ScriptingIpcMethods.libraryMethods) {
    yield* ipc.handle(method);
  }
  for (const method of ScriptingIpcMethods.inputMethods) {
    yield* ipc.handle(method);
  }
  for (const method of ScriptingIpcMethods.credentialMethods) {
    yield* ipc.handle(method);
  }
  for (const method of ScriptingIpcMethods.packageMethods) {
    yield* ipc.handle(method);
  }
  for (const method of UpdatesIpcMethods.methods) {
    yield* ipc.handle(method);
  }
});

export const desktopIpcMethods = [
  ...WindowsIpcMethods.methods,
  ...AccountsIpcMethods.methods,
  ...AccountSettingsIpcMethods.methods,
  ...ArmyIpcMethods.methods,
  ...CombatProfilesIpcMethods.methods,
  ...EnvironmentIpcMethods.methods,
  ...FollowerIpcMethods.methods,
  ...FileSystemIpcMethods.methods,
  ...GameRendererIpcMethods.methods,
  ...GameViewsIpcMethods.methods,
  ...LoaderGrabberIpcMethods.methods,
  ...PacketsIpcMethods.methods,
  ...SettingsIpcMethods.methods,
  ...ScriptingIpcMethods.methods,
  ...UpdatesIpcMethods.methods,
] as const;
