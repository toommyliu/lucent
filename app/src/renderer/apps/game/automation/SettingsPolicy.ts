import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";

import { Api } from "../flash/api/Api";
import { Automation } from "./Automation";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const api = yield* Api;
    yield* Automation;
    const fibers = yield* FiberMap.make<string>();
    const whenPlayerReady = (effect: Effect.Effect<void>) =>
      api.player
        .isReady()
        .pipe(Effect.flatMap((ready) => (ready ? effect : Effect.void)));
    const reapply = Effect.forever(
      whenPlayerReady(api.settings.reapply()).pipe(
        Effect.andThen(Effect.sleep("1 second")),
      ),
    );
    const actions = Effect.forever(
      whenPlayerReady(api.settings.reapplyActions()).pipe(
        Effect.andThen(Effect.sleep("500 millis")),
      ),
    );
    yield* FiberMap.run(fibers, "settings-reapply", reapply);
    yield* FiberMap.run(fibers, "settings-actions", actions);
  }),
);
