import type { ApiService } from "../../flash/api/Api";

export interface ScriptRecipeDependencies {
  readonly bank: ApiService["bank"];
  readonly drops: ApiService["drops"];
  readonly inventory: ApiService["inventory"];
  readonly player: ApiService["player"];
  readonly quests: ApiService["quests"];
  readonly shops: ApiService["shops"];
  readonly wait: ApiService["wait"];
}
