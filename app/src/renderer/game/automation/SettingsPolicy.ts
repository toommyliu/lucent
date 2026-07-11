import { Effect, FiberMap, Layer } from "effect";

import { Api } from "../flash/api/Api";
import { Automation } from "./Automation";

export const hasRecurringSettingActions = (state: {
  readonly enemyMagnetEnabled: boolean;
  readonly infiniteRangeEnabled: boolean;
  readonly provokeCellEnabled: boolean;
  readonly skipCutscenesEnabled: boolean;
}): boolean =>
  state.enemyMagnetEnabled ||
  state.infiniteRangeEnabled ||
  state.provokeCellEnabled ||
  state.skipCutscenesEnabled;

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const api = yield* Api;
    yield* Automation;
    const fibers = yield* FiberMap.make<string>();
    const reapply = Effect.forever(
      api.player.isReady().pipe(
        Effect.flatMap((ready) =>
          ready
            ? api.settings.get().pipe(Effect.flatMap(api.settings.apply))
            : Effect.void,
        ),
        Effect.andThen(Effect.sleep("1 second")),
      ),
    );
    const actions = Effect.forever(
      api.settings.get().pipe(
        Effect.flatMap((state) =>
          hasRecurringSettingActions(state)
            ? api.settings.apply({
                enemyMagnetEnabled: state.enemyMagnetEnabled,
                infiniteRangeEnabled: state.infiniteRangeEnabled,
                provokeCellEnabled: state.provokeCellEnabled,
                skipCutscenesEnabled: state.skipCutscenesEnabled,
              })
            : Effect.void,
        ),
        Effect.andThen(Effect.sleep("500 millis")),
      ),
    );
    yield* FiberMap.run(fibers, "settings-reapply", reapply);
    yield* FiberMap.run(fibers, "settings-actions", actions);
  }),
);
