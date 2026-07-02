import { Context, Effect, Layer } from "effect";

import type { ItemRecord, ItemSelector } from "../Types";
import { SwfBridge } from "../SwfBridge";
import { ItemsState } from "../state/Items";

export interface HouseApiShape {
  readonly get: (selector: ItemSelector) => Effect.Effect<ItemRecord | null>;
  readonly getAll: () => Effect.Effect<readonly ItemRecord[]>;
  readonly getAvailableSlots: () => Effect.Effect<number>;
  readonly getSlots: () => Effect.Effect<number>;
  readonly getUsedSlots: () => Effect.Effect<number>;
}

export class HouseApi extends Context.Service<HouseApi, HouseApiShape>()(
  "lucent/game/flash/api/House",
) {}

export const layer = Layer.effect(
  HouseApi,
  Effect.gen(function* () {
    const bridge = yield* SwfBridge;
    const items = yield* ItemsState;

    const getSlots = () => bridge.call("house.getSlots");
    const getUsedSlots = items.getUsedSlots("house");

    return HouseApi.of({
      get: (selector) => items.get("house", selector),
      getAll: () => items.getAll("house"),
      getAvailableSlots: () =>
        Effect.zipWith(getSlots(), getUsedSlots, (slots, used) =>
          Math.max(0, slots - used),
        ),
      getSlots,
      getUsedSlots: () => getUsedSlots,
    });
  }),
);
