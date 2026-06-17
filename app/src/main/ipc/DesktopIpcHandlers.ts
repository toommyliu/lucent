import { Effect, Scope } from "effect";
import type { WindowEffectRunner } from "../window/WindowService";
import { registerAccountManagerIpcHandlers } from "./methods/accounts";
import { registerArmyIpcHandlers } from "./methods/army";
import { registerCombatProfilesIpcHandlers } from "./methods/combatProfiles";
import { registerEnvironmentIpcHandlers } from "./methods/environment";
import { registerFastTravelsIpcHandlers } from "./methods/fastTravels";
import { registerFollowerIpcHandlers } from "./methods/follower";
import { registerLoaderGrabberIpcHandlers } from "./methods/loaderGrabber";
import { registerObservabilityIpcHandlers } from "./methods/observability";
import { registerPacketsIpcHandlers } from "./methods/packets";
import { registerScriptingIpcHandlers } from "./methods/scripting";
import { registerSettingsIpcHandlers } from "./methods/settings";
import { registerUpdatesIpcHandlers } from "./methods/updates";
import { registerWindowIpcHandlers } from "./methods/window";
import { AccountManagerRepository } from "../backend/accounts/AccountRepository";
import { DesktopObservability } from "../app/DesktopObservability";
import { CombatProfileRepository } from "../backend/combat-profiles/CombatProfileRepository";
import { FastTravelRepository } from "../backend/fast-travels/FastTravelRepository";
import { AccountSessions } from "../backend/accounts/AccountSessions";
import { ArmyConfigRepository } from "../backend/army/ArmyConfigRepository";
import { ArmyCoordinator } from "../backend/army/ArmyCoordinator";
import { EnvironmentStateStore } from "../backend/environment/EnvironmentStateStore";
import { FollowerStateStore } from "../backend/follower/FollowerStateStore";
import { ScriptLibrary } from "../backend/scripting/ScriptLibrary";
import { DesktopIpc } from "./DesktopIpc";
import { DesktopSettings } from "../settings/DesktopSettings";
import { UpdateChecker } from "../updates/Updates";
import { GameWindowClient } from "../window/GameWindowClient";
import { WindowService } from "../window/WindowService";

export const installDesktopIpcHandlers = (
  runWindowEffect: WindowEffectRunner,
): Effect.Effect<
  void,
  never,
  | AccountManagerRepository
  | AccountSessions
  | ArmyConfigRepository
  | ArmyCoordinator
  | CombatProfileRepository
  | EnvironmentStateStore
  | FastTravelRepository
  | FollowerStateStore
  | ScriptLibrary
  | GameWindowClient
  | DesktopIpc
  | DesktopObservability
  | Scope.Scope
  | DesktopSettings
  | UpdateChecker
  | WindowService
> =>
  Effect.gen(function* () {
    yield* registerScriptingIpcHandlers();
    yield* registerArmyIpcHandlers();
    yield* registerSettingsIpcHandlers();
    yield* registerAccountManagerIpcHandlers(runWindowEffect);
    yield* registerCombatProfilesIpcHandlers();
    yield* registerObservabilityIpcHandlers();
    yield* registerUpdatesIpcHandlers();
    yield* registerWindowIpcHandlers();
    yield* registerEnvironmentIpcHandlers(runWindowEffect);
    yield* registerFastTravelsIpcHandlers(runWindowEffect);
    yield* registerFollowerIpcHandlers(runWindowEffect);
    yield* registerPacketsIpcHandlers(runWindowEffect);
    yield* registerLoaderGrabberIpcHandlers(runWindowEffect);
  });
