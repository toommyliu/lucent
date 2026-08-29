import { describe, expect, it } from "@effect/vitest";
import { LiveItem } from "@lucent/game";
import * as Effect from "effect/Effect";

import { makeBridge } from "../bridge/Bridge";
import { makeStore } from "../state/Store";
import type { Auth } from "./Auth";
import { makeDrops } from "./Drops";
import type { Wait } from "./Wait";

const drop = new LiveItem({
  category: "Item",
  coins: false,
  context: "drop",
  cost: 0,
  description: "",
  equipped: false,
  equipmentSlot: "",
  file: "",
  houseItem: false,
  itemId: 1,
  link: "",
  memberOnly: false,
  meta: "",
  name: "Drop",
  quantity: 1,
  temporaryItem: false,
});

const auth = {
  isLoggedIn: () => Effect.succeed(true),
} as unknown as Auth;
const wait = {} as Wait;

describe("Drops", () => {
  it.effect(
    "removes a rejected drop only after Flash confirms the action",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let outcome: "failure" | boolean = false;
          const target = {
            swf: {
              "drops.reject": () => {
                if (outcome === "failure") {
                  throw new Error("Flash rejection failed");
                }
                return outcome;
              },
            },
          } as unknown as Window;
          const bridge = yield* makeBridge(target);
          const store = yield* makeStore;
          const drops = yield* makeDrops(bridge, store, auth, wait);
          yield* store.items.upsert("drop", drop);

          expect((yield* drops.get("Drop"))?.itemId).toBe(drop.itemId);
          expect(yield* drops.reject(drop.itemId)).toBe(false);
          expect(yield* drops.contains(drop.itemId)).toBe(true);

          outcome = "failure";
          expect(yield* drops.reject(drop.itemId)).toBe(false);
          expect(yield* drops.contains(drop.itemId)).toBe(true);

          outcome = true;
          expect(yield* drops.reject(drop.itemId)).toBe(true);
          expect(yield* drops.contains(drop.itemId)).toBe(false);
        }),
      ),
  );
});
