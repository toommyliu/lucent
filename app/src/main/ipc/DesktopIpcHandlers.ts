import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { Effect, Schema } from "effect";

import {
  AccountsIpc,
  CombatProfilesIpc,
  ScriptingIpc,
  SettingsIpc,
  UpdatesIpc,
  WindowsIpc,
} from "../../shared/ipc";
import { ScriptInputRepository } from "../internal/scripting/ScriptInputRepository";
import { DesktopScriptLibrary } from "../scripting/DesktopScriptLibrary";
import { Accounts } from "../internal/accounts/Accounts";
import { CombatProfiles } from "../internal/combat-profiles/CombatProfiles";
import { DesktopSettings } from "../settings/DesktopSettings";
import { DesktopUpdates } from "../updates/DesktopUpdates";
import { installArmyIpcHandlers } from "./ArmyIpcHandlers";
import type { DesktopWindowKind } from "../window/DesktopWindowCatalog";
import { DesktopWindows } from "../window/DesktopWindows";
import { DesktopIpc } from "./DesktopIpc";

class DesktopIpcSenderError extends Schema.TaggedErrorClass<DesktopIpcSenderError>()(
  "DesktopIpcSenderError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const installDesktopIpcHandlers = Effect.gen(function* () {
  const ipc = yield* DesktopIpc;
  const accounts = yield* Accounts;
  const scriptInputs = yield* ScriptInputRepository;
  const scripts = yield* DesktopScriptLibrary;
  const combatProfiles = yield* CombatProfiles;
  const settings = yield* DesktopSettings;
  const updates = yield* DesktopUpdates;
  const windows = yield* DesktopWindows;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);

  yield* installArmyIpcHandlers;

  const senderWindowId = (event: IpcMainInvokeEvent) =>
    Effect.sync(() => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window === null) {
        throw new Error("IPC sender is not attached to a BrowserWindow.");
      }
      return window.id;
    });

  const requireSenderKind = (
    event: IpcMainInvokeEvent,
    allowedKinds: readonly DesktopWindowKind[],
  ) =>
    senderWindowId(event).pipe(
      Effect.flatMap((browserWindowId) =>
        windows.getBrowserWindowKind(browserWindowId).pipe(
          Effect.flatMap((kind) => {
            if (kind !== null && allowedKinds.includes(kind)) {
              return Effect.succeed({ browserWindowId, kind });
            }

            return Effect.fail(
              new DesktopIpcSenderError({
                detail: `IPC sender must be one of: ${allowedKinds.join(", ")}`,
              }),
            );
          }),
        ),
      ),
    );

  const requireAccountManager = (event: IpcMainInvokeEvent) =>
    requireSenderKind(event, ["account-manager"]);

  const requireGame = (event: IpcMainInvokeEvent) =>
    requireSenderKind(event, ["game"]);

  // Windows
  yield* ipc.handle(WindowsIpc.open, (payload) => windows.open(payload.kind));

  // Accounts
  yield* ipc.handle(AccountsIpc.getState, (_payload, event) =>
    requireAccountManager(event).pipe(Effect.flatMap(() => accounts.getState)),
  );
  yield* ipc.handle(AccountsIpc.getServers, (_payload, event) =>
    requireAccountManager(event).pipe(
      Effect.flatMap(() => accounts.getServers),
    ),
  );
  yield* ipc.handle(AccountsIpc.getServerPings, (_payload, event) =>
    requireAccountManager(event).pipe(
      Effect.flatMap(() => accounts.getServerPings),
    ),
  );
  yield* ipc.handle(AccountsIpc.refreshServers, (_payload, event) =>
    requireAccountManager(event).pipe(
      Effect.flatMap(() => accounts.refreshServers),
    ),
  );
  yield* ipc.handle(AccountsIpc.getGameLaunch, (_payload, event) =>
    requireGame(event).pipe(
      Effect.flatMap(({ browserWindowId }) =>
        accounts.getGameLaunch(browserWindowId),
      ),
    ),
  );
  yield* ipc.handle(AccountsIpc.createAccount, (draft, event) =>
    requireAccountManager(event).pipe(
      Effect.flatMap(() => accounts.createAccount(draft)),
    ),
  );
  yield* ipc.handle(AccountsIpc.updateAccount, (payload, event) =>
    requireAccountManager(event).pipe(
      Effect.flatMap(() =>
        accounts.updateAccount(payload.username, payload.patch),
      ),
    ),
  );
  yield* ipc.handle(AccountsIpc.deleteAccount, (payload, event) =>
    requireAccountManager(event).pipe(
      Effect.flatMap(() => accounts.deleteAccount(payload.username)),
    ),
  );
  yield* ipc.handle(AccountsIpc.createGroup, (draft, event) =>
    requireAccountManager(event).pipe(
      Effect.flatMap(() => accounts.createGroup(draft)),
    ),
  );
  yield* ipc.handle(AccountsIpc.updateGroup, (payload, event) =>
    requireAccountManager(event).pipe(
      Effect.flatMap(() => accounts.updateGroup(payload.name, payload.patch)),
    ),
  );
  yield* ipc.handle(AccountsIpc.deleteGroup, (payload, event) =>
    requireAccountManager(event).pipe(
      Effect.flatMap(() => accounts.deleteGroup(payload.name)),
    ),
  );
  yield* ipc.handle(AccountsIpc.launch, (request, event) =>
    requireAccountManager(event).pipe(
      Effect.flatMap(() => accounts.launch(request)),
    ),
  );
  yield* ipc.handle(AccountsIpc.focusGameWindow, (request, event) =>
    requireAccountManager(event).pipe(
      Effect.flatMap(() => accounts.focusGameWindow(request.gameWindowId)),
    ),
  );
  yield* ipc.handle(AccountsIpc.closeGameWindow, (request, event) =>
    requireAccountManager(event).pipe(
      Effect.flatMap(() => accounts.closeGameWindow(request.gameWindowId)),
    ),
  );
  yield* ipc.handle(AccountsIpc.updateScriptStatus, (update, event) =>
    requireGame(event).pipe(
      Effect.flatMap(({ browserWindowId }) =>
        accounts.updateScriptStatus(browserWindowId, update),
      ),
    ),
  );

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
  const unsubscribeAccounts = yield* accounts.onChanged((state) => {
    void runPromise(
      windows
        .getBrowserWindowIds("account-manager")
        .pipe(
          Effect.flatMap((browserWindowIds) =>
            ipc.sendToBrowserWindowIds(
              browserWindowIds,
              AccountsIpc.changed,
              state,
            ),
          ),
        ),
    );
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
      unsubscribeAccounts();
      unsubscribeCombatProfiles();
      unsubscribeUpdates();
    }),
  );
});
