import type { ScriptRecipesApi } from "../ScriptApi";
import type { ScriptRecipeDependencies } from "../recipes/Dependencies";
import { ensureLifeSteal, ensureScrollOfEnrage } from "../recipes/Supplies";
import { doWheelOfDoom } from "../recipes/WheelOfDoom";
import type { ScriptRuntimeServices } from "./Services";

export const makeScriptRecipesApi = (
  services: ScriptRuntimeServices,
): ScriptRecipesApi => {
  const dependencies: ScriptRecipeDependencies = {
    bank: services.bank,
    drops: services.drops,
    inventory: services.inventory,
    player: services.player,
    quests: services.quests,
    shops: services.shops,
    wait: services.wait,
  };

  const recipes: ScriptRecipesApi = {
    doWheelOfDoom: (toBank) => doWheelOfDoom(dependencies, toBank),
    ensureLifeSteal: (quantity) => ensureLifeSteal(dependencies, quantity),
    ensureScrollOfEnrage: (quantity) =>
      ensureScrollOfEnrage(dependencies, quantity),
  };
  return Object.freeze(recipes);
};
