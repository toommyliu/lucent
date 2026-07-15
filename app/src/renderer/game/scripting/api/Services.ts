import type { ArmyApiShape } from "../../army/Army";
import type { ApiService } from "../../flash/api/Api";

export interface ScriptRuntimeServices {
  readonly army: ArmyApiShape;
  readonly auth: ApiService["auth"];
  readonly bank: ApiService["bank"];
  readonly combat: ApiService["combat"];
  readonly drops: ApiService["drops"];
  readonly events: ApiService["events"];
  readonly house: ApiService["house"];
  readonly inventory: ApiService["inventory"];
  readonly map: ApiService["map"];
  readonly monsters: ApiService["monsters"];
  readonly packet: ApiService["packet"];
  readonly player: ApiService["player"];
  readonly players: ApiService["players"];
  readonly quests: ApiService["quests"];
  readonly settings: ApiService["settings"];
  readonly shops: ApiService["shops"];
  readonly tempInventory: ApiService["tempInventory"];
  readonly wait: ApiService["wait"];
}
