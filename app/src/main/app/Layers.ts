import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "./DesktopEnvironment";
import * as DesktopGameRendererRecovery from "./DesktopGameRendererRecovery";
import * as DesktopLifecycle from "./DesktopLifecycle";
import * as DesktopChromiumPerformanceRecording from "./observability/DesktopChromiumPerformanceRecording";
import * as DesktopEffectTracing from "./observability/DesktopEffectTracing";
import * as DesktopObservability from "./observability/DesktopObservability";
import * as DesktopObservabilityServer from "./observability/DesktopObservabilityServer";
import * as DesktopPerformanceTrace from "./observability/DesktopPerformanceTrace";
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
import * as GamePackets from "../internal/packets/GamePackets";
import * as GameRendererRpc from "../internal/game-renderer/GameRendererRpc";
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
import * as ScriptFileSystem from "../scripting/ScriptFileSystem";
import * as ScriptHttp from "../scripting/ScriptHttp";
import * as DesktopUpdates from "../updates/DesktopUpdates";
import * as DesktopApplicationMenu from "../window/DesktopApplicationMenu";
import * as DesktopAccountGameWindows from "../window/DesktopAccountGameWindows";
import * as DesktopWindows from "../window/DesktopWindows";
import * as ElectronApp from "../electron/ElectronApp";
import * as ElectronChromiumPerformance from "../electron/ElectronChromiumPerformance";
import * as ElectronDialog from "../electron/ElectronDialog";
import * as ElectronGameView from "../electron/ElectronGameView";
import * as ElectronSession from "../electron/ElectronSession";
import * as ElectronShell from "../electron/ElectronShell";
import * as ElectronTheme from "../electron/ElectronTheme";
import * as ElectronWindow from "../electron/ElectronWindow";
import * as RuffleSocketProxy from "../ruffle/RuffleSocketProxy";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";

export const makeDesktopLayer = (
  envConfig: DesktopEnvironment.DesktopEnvironmentConfig,
) => {
  const diagnostics = DesktopObservability.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(NodeFileSystem.layer, DesktopEnvironment.layer(envConfig)),
    ),
  );
  const tracing = (
    envConfig.debug === true ? DesktopEffectTracing.layer : Layer.empty
  ).pipe(Layer.provideMerge(diagnostics));
  const platform = Layer.mergeAll(
    DesktopLifecycle.layer,
    ElectronApp.layer,
    ElectronChromiumPerformance.layer,
    ElectronDialog.layer,
    ElectronGameView.layer,
    ElectronShell.layer,
    ElectronTheme.layer,
    ElectronWindow.layer,
    Layer.succeed(
      DesktopIpc.DesktopIpc,
      DesktopIpc.makeElectronDesktopIpc(envConfig.debug === true),
    ),
    DesktopHttpClient.layer,
    RuffleSocketProxy.layer,
    AccountSessions.layer,
    ScriptFiles.layer,
  ).pipe(Layer.provideMerge(tracing));

  const storage = Layer.mergeAll(
    DesktopSettings.layer,
    ElectronSession.layer,
    AccountRepository.layer,
    AccountSettingsRepository.layer,
    ArmyConfigRepository.layer,
    CombatProfiles.layer,
    GitHubCredentials.layer,
    ScriptPackageState.layer,
    ScriptInputRepository.layer,
    ScriptWorkspace.layer,
    GitHubApiClient.layer,
  ).pipe(Layer.provideMerge(platform));

  const services = Layer.mergeAll(
    DesktopPerformanceTrace.layer,
    DesktopWindows.layer,
    AccountServers.layer,
    ArmyCoordinator.layer,
    DesktopUpdates.layer,
    ScriptPackageCatalog.layer,
    GitHubScriptPackageClient.layer,
  ).pipe(Layer.provideMerge(storage));

  const game = Layer.mergeAll(
    DesktopAccountGameWindows.layer,
    DesktopChromiumPerformanceRecording.layer,
    DesktopIpcSenders.layer,
    GameRendererRpc.layer,
    GamePackets.layer,
    ArmyLoopTauntOrchestrator.layer,
    ScriptFileSystem.layer,
    ScriptHttp.layer,
    ScriptSourceRegistry.layer,
    ScriptPackageManager.layer,
  ).pipe(Layer.provideMerge(services));

  const application = Layer.mergeAll(
    Accounts.layer,
    DesktopApplicationMenu.layer,
    GameEnvironments.layer,
    GameFollowers.layer,
    DesktopScriptLibrary.layer,
  ).pipe(Layer.provideMerge(game));

  return Layer.mergeAll(
    DesktopObservabilityServer.layer,
    DesktopGameRendererRecovery.layer,
  ).pipe(Layer.provideMerge(application));
};
