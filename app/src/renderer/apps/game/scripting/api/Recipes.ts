import type { ScriptRecipesApi } from "../ScriptApi";
import type { ScriptRecipeDependencies } from "../recipes/Dependencies";
import { ensureLifeSteal, ensureScrollOfEnrage } from "../recipes/Supplies";
import { doWheelOfDoom } from "../recipes/WheelOfDoom";

export const makeScriptRecipesApi = (
  dependencies: ScriptRecipeDependencies,
): ScriptRecipesApi => {
  const recipes: ScriptRecipesApi = {
    doWheelOfDoom: (toBank) => doWheelOfDoom(dependencies, toBank),
    ensureLifeSteal: (quantity) => ensureLifeSteal(dependencies, quantity),
    ensureScrollOfEnrage: (quantity) =>
      ensureScrollOfEnrage(dependencies, quantity),
  };
  return Object.freeze(recipes);
};
