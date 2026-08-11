import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "./DesktopEnvironment";
import * as DesktopLifecycle from "./DesktopLifecycle";
import * as DesktopObservability from "./DesktopObservability";
import * as DesktopPerformanceTrace from "./DesktopPerformanceTrace";
import * as GameConsoleObservability from "./GameConsoleObservability";
import * as ArmyConfigRepository from "../internal/army/ArmyConfigRepository";
import * as ArmyCoordinator from "../internal/army/ArmyCoordinator";
import * as ArmyLoopTauntOrchestrator from "../internal/army/ArmyLoopTauntOrchestrator";
import * as AccountRepository from "../internal/accounts/AccountRepository";
import * as AccountSettingsRepository from "../internal/account-settings/AccountSettingsRepository";
import * as Accounts from "../internal/accounts/Accounts";
import * as AccountServers from "../internal/accounts/AccountServers";
import * as AccountSessions from "../internal/accounts/AccountSessions";
import * as CombatProfiles from "../internal/combat-profiles/CombatProfiles";
import * as GameEnvironments from "../internal/environment/GameEnvironments";
import * as GameFollowers from "../internal/follower/GameFollowers";
import * as GameLoaderGrabbers from "../internal/loader-grabber/GameLoaderGrabbers";
import * as GamePackets from "../internal/packets/GamePackets";
import * as GitHubApiClient from "../github/GitHubApiClient";
import * as DesktopHttpClient from "../http/DesktopHttpClient";
import * as DesktopIpc from "../ipc/DesktopIpc";
import * as DesktopIpcSenders from "../ipc/DesktopIpcSenders";
import * as DesktopSettings from "../settings/DesktopSettings";
import * as ScriptFiles from "../internal/scripting/ScriptFiles";
import * as ScriptInputRepository from "../internal/scripting/ScriptInputRepository";
import * as DesktopScriptLibrary from "../scripting/DesktopScriptLibrary";
import * as GitHubCredentials from "../scripting/GitHubCredentials";
import * as GitHubScriptPackageClient from "../scripting/GitHubScriptPackageClient";
import * as ScriptPackageCatalog from "../scripting/ScriptPackageCatalog";
import * as ScriptPackageManager from "../scripting/ScriptPackageManager";
import * as ScriptPackageState from "../scripting/ScriptPackageState";
import * as ScriptSourceRegistry from "../scripting/ScriptSourceRegistry";
import * as ScriptWorkspace from "../scripting/ScriptWorkspace";
import * as DesktopUpdates from "../updates/DesktopUpdates";
import * as DesktopApplicationMenu from "../window/DesktopApplicationMenu";
import * as DesktopAccountGameWindows from "../window/DesktopAccountGameWindows";
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

  const performanceTraceLayer = DesktopPerformanceTrace.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(ElectronApp.layer, environmentLayer, observabilityLayer),
    ),
  );

  const combatProfilesLayer = CombatProfiles.layer.pipe(
    Layer.provideMerge(environmentLayer),
  );

  const scriptFilesLayer = ScriptFiles.layer;
  const httpClientLayer = Layer.succeed(
    DesktopHttpClient.DesktopHttpClient,
    DesktopHttpClient.DesktopHttpClient.of(
      DesktopHttpClient.makeDesktopHttpClient(),
    ),
  );
  const scriptPackageStateLayer = ScriptPackageState.layer.pipe(
    Layer.provideMerge(environmentLayer),
  );
  const scriptPackageCatalogLayer = ScriptPackageCatalog.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ElectronApp.layer,
        environmentLayer,
        scriptPackageStateLayer,
      ),
    ),
  );
  const gitHubCredentialsLayer = GitHubCredentials.layer.pipe(
    Layer.provideMerge(environmentLayer),
  );
  const gitHubApiClientLayer = GitHubApiClient.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(ElectronApp.layer, httpClientLayer)),
  );
  const gitHubScriptPackageClientLayer = GitHubScriptPackageClient.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(gitHubApiClientLayer, gitHubCredentialsLayer),
    ),
  );
  const scriptPackageManagerLayer = ScriptPackageManager.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        environmentLayer,
        gitHubScriptPackageClientLayer,
        scriptPackageCatalogLayer,
        scriptPackageStateLayer,
      ),
    ),
  );
  const scriptSourceRegistryLayer = ScriptSourceRegistry.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(scriptFilesLayer, scriptPackageCatalogLayer),
    ),
  );

  const scriptingLayer = Layer.mergeAll(
    ScriptWorkspace.layer.pipe(Layer.provideMerge(environmentLayer)),
    gitHubCredentialsLayer,
    gitHubScriptPackageClientLayer,
    scriptPackageCatalogLayer,
    scriptPackageManagerLayer,
    scriptPackageStateLayer,
    scriptSourceRegistryLayer,
    ScriptInputRepository.layer.pipe(Layer.provideMerge(environmentLayer)),
    scriptFilesLayer,
    DesktopScriptLibrary.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          ElectronDialog.layer,
          ElectronShell.layer,
          environmentLayer,
          scriptFilesLayer,
          scriptPackageCatalogLayer,
          scriptSourceRegistryLayer,
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
        gitHubApiClientLayer,
        observabilityLayer,
        settingsLayer,
      ),
    ),
  );

  const windowsLayer = DesktopWindows.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ElectronApp.layer,
        electronSessionLayer,
        ElectronShell.layer,
        ElectronTheme.layer,
        ElectronWindow.layer,
        environmentLayer,
        observabilityLayer,
        settingsLayer,
      ),
    ),
  );

  const gameEnvironmentsLayer = GameEnvironments.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(DesktopIpc.layer, windowsLayer)),
  );
  const gameFollowersLayer = GameFollowers.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(DesktopIpc.layer, windowsLayer)),
  );
  const gameLoaderGrabbersLayer = GameLoaderGrabbers.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(DesktopIpc.layer, windowsLayer)),
  );
  const gamePacketsLayer = GamePackets.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(DesktopIpc.layer, windowsLayer)),
  );

  const accountRepositoryLayer = AccountRepository.layer.pipe(
    Layer.provideMerge(environmentLayer),
  );
  const accountSettingsRepositoryLayer = AccountSettingsRepository.layer.pipe(
    Layer.provideMerge(environmentLayer),
  );
  const accountServersLayer = AccountServers.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(environmentLayer, observabilityLayer)),
  );
  const accountGameWindowsLayer = DesktopAccountGameWindows.layer.pipe(
    Layer.provideMerge(windowsLayer),
  );
  const accountsLayer = Accounts.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        accountGameWindowsLayer,
        accountRepositoryLayer,
        accountServersLayer,
        AccountSessions.layer,
      ),
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
        ElectronShell.layer,
        environmentLayer,
        observabilityLayer,
        performanceTraceLayer,
        settingsLayer,
        updatesLayer,
        windowsLayer,
      ),
    ),
  );

  // IPC authentication and Loop Taunt cleanup must observe the same Army
  // session state machine, so both services share one coordinator layer.
  const armyCoordinatorLayer = ArmyCoordinator.layer;
  const armyLayer = Layer.mergeAll(
    ArmyLoopTauntOrchestrator.layer.pipe(
      Layer.provideMerge(armyCoordinatorLayer),
    ),
    ArmyConfigRepository.layer.pipe(Layer.provideMerge(environmentLayer)),
  );

  const ipcSendersLayer = DesktopIpcSenders.layer.pipe(
    Layer.provideMerge(windowsLayer),
  );

  return Layer.mergeAll(
    armyLayer,
    ipcSendersLayer,
    electronLayer,
    environmentLayer,
    accountsLayer,
    accountSettingsRepositoryLayer,
    combatProfilesLayer,
    gameConsoleObservabilityLayer,
    gameEnvironmentsLayer,
    gameFollowersLayer,
    gameLoaderGrabbersLayer,
    gamePacketsLayer,
    httpClientLayer,
    observabilityLayer,
    settingsLayer,
    scriptingLayer,
    updatesLayer,
    windowsLayer,
    applicationMenuLayer,
  );
};
