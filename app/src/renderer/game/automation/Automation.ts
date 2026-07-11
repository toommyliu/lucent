import { Context, Effect, Fiber, FiberMap, Layer, Stream } from "effect";

import { Api } from "../flash/api/Api";
import { makeAutoAttack } from "./AutoAttack";
import type { AutoAttackState } from "./AutoAttack";
import { makeAutoRelogin } from "./AutoRelogin";
import type { AutoReloginState } from "./AutoRelogin";
import { makeAutoZone } from "./AutoZone";
import type { AutoZoneState } from "./AutoZone";

export const makeAutomation = Effect.gen(function* () {
  const api = yield* Api;
  const scope = yield* Effect.scope;
  const fibers = yield* FiberMap.make<string>();
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const autoAttack = yield* makeAutoAttack(api, fibers);
  const autoRelogin = yield* makeAutoRelogin(api, fibers);
  const autoZone = yield* makeAutoZone(api, fibers);

  const observe = <S>(
    changes: Stream.Stream<S>,
    listener: (state: S) => void,
  ) =>
    changes.pipe(
      Stream.runForEach((state) => Effect.sync(() => listener(state))),
      Effect.forkIn(scope),
      Effect.map((fiber) => () => {
        runFork(Fiber.interrupt(fiber));
      }),
    );

  const observeAutoAttack = (listener: (state: AutoAttackState) => void) =>
    observe(autoAttack.changes, listener);

  const observeAutoRelogin = (listener: (state: AutoReloginState) => void) =>
    observe(autoRelogin.changes, listener);

  const observeAutoZone = (listener: (state: AutoZoneState) => void) =>
    observe(autoZone.changes, listener);

  const autoAttackApi = {
    ...autoAttack,
    onState: observeAutoAttack,
  };

  const autoReloginApi = {
    ...autoRelogin,
    onState: observeAutoRelogin,
  };

  const autoZoneApi = {
    ...autoZone,
    onState: observeAutoZone,
  };

  return {
    autoAttack: autoAttackApi,
    autoRelogin: autoReloginApi,
    autoZone: autoZoneApi,
  };
});

export type AutomationService = Effect.Success<typeof makeAutomation>;

export class Automation extends Context.Service<
  Automation,
  AutomationService
>()("lucent/renderer/automation/Automation") {}

export const layer = Layer.effect(Automation, makeAutomation);
