import { Effect } from "effect";

import type { FlashRuntimeEvent } from "../../Types";
import type { DropsStateShape } from "../../state/Drops";
import type { ItemsStateShape } from "../../state/Items";
import type { QuestsStateShape } from "../../state/Quests";
import type { ShopsStateShape } from "../../state/Shops";
import type { WorldStateShape } from "../../state/World";
import type { TargetRelations } from "./TargetRelations";

export const projectRuntimeEvent = (
  event: FlashRuntimeEvent,
  items: ItemsStateShape,
  drops: DropsStateShape,
  shops: ShopsStateShape,
  quests: QuestsStateShape,
  world: WorldStateShape,
  relations: TargetRelations,
): Effect.Effect<void> => {
  if (
    event.type !== "connection" ||
    (event.payload.status !== "OnConnectionLost" &&
      event.payload.status !== "OnConnectionFailed")
  ) {
    return Effect.void;
  }

  return Effect.gen(function* () {
    yield* items.clear();
    yield* drops.clear();
    yield* shops.clear();
    yield* quests.clear();
    yield* world.clear();
    relations.reset();
  });
};
