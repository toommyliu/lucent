import { Effect } from "effect";

import {
  CombatProfilesIpc,
  ScriptingIpc,
  SettingsIpc,
  UpdatesIpc,
  WindowsIpc,
} from "../../shared/ipc";
import { ScriptInputRepository } from "../scripting/ScriptInputRepository";
import { ScriptLibrary } from "../scripting/ScriptLibrary";
import { DesktopCombatProfiles } from "../combat-profiles/DesktopCombatProfiles";
import { DesktopSettings } from "../settings/DesktopSettings";
import { DesktopUpdates } from "../updates/DesktopUpdates";
import { installArmyIpcHandlers } from "../army/ArmyIpcHandlers";
import { DesktopWindows } from "../window/DesktopWindows";
import { DesktopIpc } from "./DesktopIpc";

export const installDesktopIpcHandlers = Effect.gen(function* () {
  const ipc = yield* DesktopIpc;
  const scriptInputs = yield* ScriptInputRepository;
  const scripts = yield* ScriptLibrary;
  const combatProfiles = yield* DesktopCombatProfiles;
  const settings = yield* DesktopSettings;
  const updates = yield* DesktopUpdates;
  const windows = yield* DesktopWindows;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);

  yield* installArmyIpcHandlers;

  // Windows
  yield* ipc.handle(WindowsIpc.open, (payload) => windows.open(payload.kind));

  // Combat Profiles
  yield* ipc.handle(CombatProfilesIpc.getState, () => combatProfiles.get);
  yield* ipc.handle(CombatProfilesIpc.saveProfile, (profile) =>
    combatProfiles.saveProfile(profile),
  );
  yield* ipc.handle(CombatProfilesIpc.deleteProfile, (payload) =>
    combatProfiles.deleteProfile(payload.profileId),
  );

  // Settings
  yield* ipc.handle(SettingsIpc.get, () => settings.get);
  yield* ipc.handle(SettingsIpc.updatePreferences, (patch) =>
    settings.updatePreferences(patch),
  );
  yield* ipc.handle(SettingsIpc.updateAppearance, (patch) =>
    settings.updateAppearance(patch),
  );
  yield* ipc.handle(
    SettingsIpc.resetAppearance,
    () => settings.resetAppearance,
  );
  yield* ipc.handle(SettingsIpc.updateHotkeys, (patch) =>
    settings.updateHotkeys(patch),
  );
  yield* ipc.handle(SettingsIpc.resetHotkeys, () => settings.resetHotkeys);

  // Scripting
  yield* ipc.handle(ScriptingIpc.openFile, () => scripts.openFile);
  yield* ipc.handle(ScriptingIpc.readFile, (payload) =>
    scripts.readFile(payload.path),
  );
  yield* ipc.handle(ScriptingIpc.openPath, (payload) =>
    scripts.openPath(payload.path),
  );
  yield* ipc.handle(ScriptingIpc.getInputValues, (definition) =>
    scriptInputs.getValues(definition),
  );
  yield* ipc.handle(ScriptingIpc.saveInputValues, (payload) =>
    scriptInputs.saveValues(payload.definition, payload.values),
  );

  // Updates
  yield* ipc.handle(UpdatesIpc.getState, () => updates.getState);
  yield* ipc.handle(UpdatesIpc.checkNow, (payload) =>
    updates.checkNow({ force: payload.force === true }),
  );
  yield* ipc.handle(UpdatesIpc.openReleasePage, () => updates.openReleasePage);

  const unsubscribeSettings = yield* settings.onChanged((nextSettings) => {
    void runPromise(ipc.sendToAll(SettingsIpc.changed, nextSettings));
  });
  const unsubscribeCombatProfiles = yield* combatProfiles.onChanged(
    (library) => {
      void runPromise(ipc.sendToAll(CombatProfilesIpc.changed, library));
    },
  );
  const unsubscribeUpdates = yield* updates.onStateChanged((state) => {
    void runPromise(ipc.sendToAll(UpdatesIpc.changed, state));
  });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unsubscribeSettings();
      unsubscribeCombatProfiles();
      unsubscribeUpdates();
    }),
  );
});
