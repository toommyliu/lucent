import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { pipe } from "effect/Function";

import type { ScriptEffectStd } from "./ScriptApi";

const freezeModuleFacade = <Module extends object>(module: Module): Module =>
  Object.freeze({ ...module }) as Module;

export const scriptEffectStd: ScriptEffectStd = Object.freeze({
  Duration: freezeModuleFacade(Duration),
  Effect: freezeModuleFacade(Effect),
  Option: freezeModuleFacade(Option),
  pipe,
});
