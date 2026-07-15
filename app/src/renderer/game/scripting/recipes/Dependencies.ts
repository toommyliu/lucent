import type { ApiService } from "../../flash/api/Api";
import type { BridgeService } from "../../flash/bridge/Bridge";

export interface ScriptRecipeDependencies {
  readonly bank: ApiService["bank"];
  readonly bridge: BridgeService;
  readonly drops: ApiService["drops"];
  readonly inventory: ApiService["inventory"];
  readonly player: ApiService["player"];
  readonly quests: ApiService["quests"];
  readonly shops: ApiService["shops"];
  readonly wait: ApiService["wait"];
}
