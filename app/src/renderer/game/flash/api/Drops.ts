import { Context, Effect, Layer } from "effect";

import type { DropRecord, ItemSelector } from "../Types";
import { SwfBridge } from "../SwfBridge";
import { normalizeItemSelector } from "../selectors";
import { DropsState } from "../state/Drops";
import { AuthApi } from "./Auth";

export interface DropsApiShape {
  readonly accept: (selector: ItemSelector) => Effect.Effect<boolean>;
  readonly contains: (selector: ItemSelector) => Effect.Effect<boolean>;
  readonly getAll: () => Effect.Effect<readonly DropRecord[]>;
  readonly isCustomUiEnabled: () => Effect.Effect<boolean>;
  readonly reject: (selector: ItemSelector) => Effect.Effect<boolean>;
  readonly toggleUi: () => Effect.Effect<void>;
}

export class DropsApi extends Context.Service<DropsApi, DropsApiShape>()(
  "lucent/game/flash/api/Drops",
) {}

export const layer = Layer.effect(
  DropsApi,
  Effect.gen(function* () {
    const auth = yield* AuthApi;
    const bridge = yield* SwfBridge;
    const drops = yield* DropsState;

    const resolveDrop = (selector: ItemSelector) =>
      Effect.gen(function* () {
        const normalized = normalizeItemSelector(selector);
        if (normalized === null) {
          return null;
        }
        return yield* drops.get(selector);
      });

    return DropsApi.of({
      accept: (selector) =>
        Effect.gen(function* () {
          if (!(yield* auth.isLoggedIn())) {
            return false;
          }

          const drop = yield* resolveDrop(selector);
          if (drop === null) {
            return false;
          }

          yield* bridge.call("drops.acceptDrop", [drop.itemId]);
          yield* drops.remove(drop.itemId);
          return true;
        }),
      contains: drops.contains,
      getAll: drops.getAll,
      isCustomUiEnabled: () => bridge.call("drops.isUsingCustomDrops"),
      reject: (selector) =>
        Effect.gen(function* () {
          if (!(yield* auth.isLoggedIn())) {
            return false;
          }

          const drop = yield* resolveDrop(selector);
          if (drop === null) {
            return false;
          }

          yield* bridge.call("drops.rejectDrop", [drop.itemId]);
          yield* drops.remove(drop.itemId);
          return true;
        }),
      toggleUi: () => bridge.call("drops.toggleUi"),
    });
  }),
);
