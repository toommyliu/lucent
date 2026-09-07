import type { ScriptRecipesApi } from "../ScriptApi";
import type { ScriptRecipeDependencies } from "../recipes/Dependencies";
import { ensureLifeSteal, ensureScrollOfEnrage } from "../recipes/Supplies";

export const makeScriptRecipesApi = (
  dependencies: ScriptRecipeDependencies,
): ScriptRecipesApi => {
  const recipes: ScriptRecipesApi = {
    ensureLifeSteal: (quantity) => ensureLifeSteal(dependencies, quantity),
    ensureScrollOfEnrage: (quantity) =>
      ensureScrollOfEnrage(dependencies, quantity),
  };
  return Object.freeze(recipes);
};
