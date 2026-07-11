import { Effect, Layer } from "effect";

import { AuthApi } from "../api/Auth";
import type { FlashPacket, FlashProjectionEvent } from "../Types";
import { DropsState } from "../state/Drops";
import { ItemsState } from "../state/Items";
import { QuestsState } from "../state/Quests";
import { ShopsState } from "../state/Shops";
import { WorldState } from "../state/World";
import { FlashProtocol } from "./FlashProtocol";
import { resolveProjectorRoute } from "./ProjectorRoutes";
import { projectCombatPacket } from "./projectors/CombatProjector";
import { projectInventoryPacket } from "./projectors/InventoryProjector";
import { projectQuestPacket } from "./projectors/QuestProjector";
import { projectRuntimeEvent } from "./projectors/RuntimeProjector";
import { projectShopPacket } from "./projectors/ShopProjector";
import { makeTargetRelations } from "./projectors/TargetRelations";
import { projectWorldPacket } from "./projectors/WorldProjector";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const auth = yield* AuthApi;
    const drops = yield* DropsState;
    const items = yield* ItemsState;
    const protocol = yield* FlashProtocol;
    const quests = yield* QuestsState;
    const shops = yield* ShopsState;
    const world = yield* WorldState;
    const relations = makeTargetRelations();

    const projectPacket = (
      packet: FlashPacket,
    ): Effect.Effect<readonly FlashProjectionEvent[]> => {
      switch (resolveProjectorRoute(packet)) {
        case "combat":
          return projectCombatPacket(packet, world, relations);
        case "inventory":
          return projectInventoryPacket(packet, items, shops, drops, world);
        case "quest":
          return projectQuestPacket(packet, quests);
        case "shop":
          return projectShopPacket(packet, shops);
        case "world":
          return projectWorldPacket(packet, auth, world, relations);
        default:
          return Effect.succeed([]);
      }
    };

    const disposePacketProjector =
      yield* protocol.installPacketProjector(projectPacket);
    yield* Effect.addFinalizer(() => Effect.sync(disposePacketProjector));

    const disposeRuntimeProjector = yield* protocol.installRuntimeProjector(
      (event) =>
        projectRuntimeEvent(
          event,
          items,
          drops,
          shops,
          quests,
          world,
          relations,
        ),
    );
    yield* Effect.addFinalizer(() => Effect.sync(disposeRuntimeProjector));

    yield* protocol.start();
  }),
);
