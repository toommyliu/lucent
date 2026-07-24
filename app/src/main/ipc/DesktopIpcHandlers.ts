import { Effect } from "effect";

import { DesktopIpc } from "./DesktopIpc";
import * as AccountsIpcMethods from "./methods/accounts";
import * as AccountSettingsIpcMethods from "./methods/accountSettings";
import * as ArmyIpcMethods from "./methods/army";
import * as CombatProfilesIpcMethods from "./methods/combatProfiles";
import * as EnvironmentIpcMethods from "./methods/environment";
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
  for (const method of SettingsIpcMethods.methods) {
    yield* ipc.handle(method);
  }
  yield* ipc.handle(ScriptingIpcMethods.openFile);
  yield* ipc.handle(ScriptingIpcMethods.readFile);
  yield* ipc.handle(ScriptingIpcMethods.resolveFile);
  yield* ipc.handle(ScriptingIpcMethods.selectFile);
  yield* ipc.handle(ScriptingIpcMethods.openPath);
  yield* ipc.handle(ScriptingIpcMethods.getInputValues);
  yield* ipc.handle(ScriptingIpcMethods.saveInputValues);
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
  ...SettingsIpcMethods.methods,
  ...ScriptingIpcMethods.methods,
  ...UpdatesIpcMethods.methods,
] as const;
