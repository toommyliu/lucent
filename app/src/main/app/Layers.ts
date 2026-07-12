import { Layer } from "effect";

import * as DesktopEnvironment from "./DesktopEnvironment";
import * as DesktopLifecycle from "./DesktopLifecycle";
import * as DesktopObservability from "./DesktopObservability";
import * as GameConsoleObservability from "./GameConsoleObservability";
import * as ArmyConfigRepository from "../army/ArmyConfigRepository";
import * as ArmyCoordinator from "../army/ArmyCoordinator";
import * as DesktopAccounts from "../accounts/DesktopAccounts";
import * as DesktopCombatProfiles from "../combat-profiles/DesktopCombatProfiles";
import * as DesktopIpc from "../ipc/DesktopIpc";
import * as DesktopSettings from "../settings/DesktopSettings";
import * as ScriptInputRepository from "../scripting/ScriptInputRepository";
import * as ScriptInputsExtractor from "../scripting/ScriptInputsExtractor";
import * as ScriptLibrary from "../scripting/ScriptLibrary";
import * as DesktopUpdates from "../updates/DesktopUpdates";
import * as DesktopApplicationMenu from "../window/DesktopApplicationMenu";
import * as DesktopWindows from "../window/DesktopWindows";
import * as ElectronApp from "../electron/ElectronApp";
import * as ElectronDialog from "../electron/ElectronDialog";
import * as ElectronSession from "../electron/ElectronSession";
import * as ElectronShell from "../electron/ElectronShell";
import * as ElectronTheme from "../electron/ElectronTheme";
import * as ElectronWindow from "../electron/ElectronWindow";
import * as FlashTrust from "../flash/FlashTrust";

export const makeDesktopLayer = (
  envConfig: DesktopEnvironment.DesktopEnvironmentConfig,
) => {
  const environmentLayer = DesktopEnvironment.layer(envConfig);
  const electronSessionLayer = ElectronSession.layer.pipe(
    Layer.provideMerge(environmentLayer),
  );
  const electronLayer = Layer.mergeAll(
    DesktopLifecycle.layer,
    ElectronApp.layer,
    ElectronDialog.layer,
    DesktopIpc.layer,
    electronSessionLayer,
    ElectronShell.layer,
    ElectronTheme.layer,
    ElectronWindow.layer,
    FlashTrust.layer,
  );

  const observabilityLayer = DesktopObservability.layer.pipe(
    Layer.provideMerge(environmentLayer),
  );

  const settingsLayer = DesktopSettings.layer.pipe(
    Layer.provideMerge(environmentLayer),
  );

  const combatProfilesLayer = DesktopCombatProfiles.layer.pipe(
    Layer.provideMerge(environmentLayer),
  );

  const scriptingLayer = Layer.mergeAll(
    ScriptInputsExtractor.layer,
    ScriptInputRepository.layer.pipe(Layer.provideMerge(environmentLayer)),
    ScriptLibrary.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          ElectronDialog.layer,
          ElectronShell.layer,
          environmentLayer,
          ScriptInputsExtractor.layer,
        ),
      ),
    ),
  );

  const updatesLayer = DesktopUpdates.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ElectronApp.layer,
        ElectronShell.layer,
        environmentLayer,
        observabilityLayer,
        combatProfilesLayer,
        settingsLayer,
      ),
    ),
  );

  const windowsLayer = DesktopWindows.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ElectronApp.layer,
        electronSessionLayer,
        ElectronTheme.layer,
        ElectronWindow.layer,
        environmentLayer,
        observabilityLayer,
        settingsLayer,
      ),
    ),
  );

  const accountsLayer = DesktopAccounts.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(environmentLayer, observabilityLayer, windowsLayer),
    ),
  );

  const gameConsoleObservabilityLayer = GameConsoleObservability.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(accountsLayer, observabilityLayer, windowsLayer),
    ),
  );

  const applicationMenuLayer = DesktopApplicationMenu.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ElectronApp.layer,
        ElectronDialog.layer,
        environmentLayer,
        observabilityLayer,
        settingsLayer,
        scriptingLayer,
        updatesLayer,
        windowsLayer,
        accountsLayer,
      ),
    ),
  );

  const armyLayer = Layer.mergeAll(
    ArmyCoordinator.layer.pipe(Layer.provideMerge(DesktopIpc.layer)),
    ArmyConfigRepository.layer.pipe(Layer.provideMerge(environmentLayer)),
  );

  return Layer.mergeAll(
    armyLayer,
    electronLayer,
    environmentLayer,
    accountsLayer,
    combatProfilesLayer,
    gameConsoleObservabilityLayer,
    observabilityLayer,
    settingsLayer,
    scriptingLayer,
    updatesLayer,
    windowsLayer,
    applicationMenuLayer,
  );
};
