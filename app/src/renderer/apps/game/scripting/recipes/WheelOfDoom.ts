import { Effect, Option, Schema } from "effect";

import type { Packet } from "../../flash/contract/Packet";
import type { ScriptRecipeDependencies } from "./Dependencies";

const GEAR_OF_DOOM = "Gear of Doom";
const DAILY_XP_BOOST_ITEM_ID = 19_189;
const WHEEL_OF_DOOM_QUEST_ID = 3_076;

const WheelReward = Schema.Struct({ sName: Schema.String });
const WheelResponse = Schema.Struct({
  Item: Schema.optionalKey(Schema.Unknown),
  dropItems: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
const decodeWheelReward = Schema.decodeUnknownOption(WheelReward);
const decodeWheelResponse = Schema.decodeUnknownOption(WheelResponse);

const rewardNames = (packet: Packet): readonly string[] => {
  if (packet.direction === "client") return [];
  const response = decodeWheelResponse(packet.data);
  if (Option.isNone(response)) return [];
  const rewards = new Set<string>();
  const addReward = (value: unknown) => {
    const reward = decodeWheelReward(value);
    if (Option.isSome(reward)) rewards.add(reward.value.sName);
  };
  if (response.value.dropItems !== undefined) {
    addReward(response.value.dropItems[String(DAILY_XP_BOOST_ITEM_ID)]);
  }
  addReward(response.value.Item);
  return Array.from(rewards);
};

export const doWheelOfDoom = Effect.fn("ScriptRecipes.doWheelOfDoom")(
  function* (deps: ScriptRecipeDependencies, toBank = false) {
    if (!(yield* deps.inventory.contains(GEAR_OF_DOOM, 3))) {
      yield* deps.bank.withdraw(GEAR_OF_DOOM);
    }
    if (!(yield* deps.inventory.contains(GEAR_OF_DOOM, 3))) return false;
    if (!(yield* deps.player.joinMap("doom"))) return false;
    if (!(yield* deps.quests.accept(WHEEL_OF_DOOM_QUEST_ID))) return false;
    if (!(yield* deps.quests.canComplete(WHEEL_OF_DOOM_QUEST_ID))) return false;

    if (!toBank) return yield* deps.quests.complete(WHEEL_OF_DOOM_QUEST_ID);

    const response = yield* deps.wait.forPacket(
      { command: "Wheel", direction: "extension", wireType: "json" },
      {
        timeout: "5 seconds",
        trigger: deps.quests.complete(WHEEL_OF_DOOM_QUEST_ID),
      },
    );
    if (response === null) return false;

    const rewards = rewardNames(response);
    if (rewards.length === 0) return true;

    const toDeposit: string[] = [];
    for (const reward of rewards) {
      if ((yield* deps.inventory.get(reward)) !== null) {
        toDeposit.push(reward);
      } else if (!(yield* deps.bank.contains(reward))) {
        return false;
      }
    }
    return (
      toDeposit.length === 0 ||
      (yield* deps.bank.depositBatch(toDeposit)).every(Boolean)
    );
  },
);
