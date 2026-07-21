import { Duration, Effect, Option, pipe } from "effect";

import type { ScriptEffectStd } from "./ScriptApi";

const freezeModuleFacade = <Module extends object>(module: Module): Module =>
  Object.freeze({ ...module }) as Module;

export const scriptEffectStd: ScriptEffectStd = Object.freeze({
  Duration: freezeModuleFacade(Duration),
  Effect: freezeModuleFacade(Effect),
  Option: freezeModuleFacade(Option),
  pipe,
});
