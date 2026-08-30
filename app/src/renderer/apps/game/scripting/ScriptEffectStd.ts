import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { pipe } from "effect/Function";

import type {
  ScriptDurationModule,
  ScriptEffectModule,
  ScriptEffectStd,
  ScriptOptionModule,
} from "./ScriptApi";

const scriptDurationModule: ScriptDurationModule = {
  days: Duration.days,
  hours: Duration.hours,
  millis: Duration.millis,
  minutes: Duration.minutes,
  seconds: Duration.seconds,
  toMillis: Duration.toMillis,
};
Object.freeze(scriptDurationModule);

const scriptEffectModule: ScriptEffectModule = {
  all: Effect.all,
  as: Effect.as,
  asVoid: Effect.asVoid,
  catch: Effect.catch,
  fail: Effect.fail,
  flatMap: Effect.flatMap,
  forEach: (values, transform) => Effect.forEach(values, transform),
  map: Effect.map,
  mapError: Effect.mapError,
  sleep: Effect.sleep,
  succeed: Effect.succeed,
  sync: Effect.sync,
  tap: Effect.tap,
  timeoutOption: Effect.timeoutOption,
  try: Effect.try,
  tryPromise: Effect.tryPromise,
  void: Effect.void,
};
Object.freeze(scriptEffectModule);

const scriptOptionModule: ScriptOptionModule = {
  getOrElse: Option.getOrElse,
  isNone: Option.isNone,
  isSome: Option.isSome,
  map: Option.map,
  match: Option.match,
  none: Option.none,
  some: Option.some,
};
Object.freeze(scriptOptionModule);

export const scriptEffectStd: ScriptEffectStd = Object.freeze({
  Duration: scriptDurationModule,
  Effect: scriptEffectModule,
  Option: scriptOptionModule,
  pipe,
});
