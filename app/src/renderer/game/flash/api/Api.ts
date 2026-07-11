import { Context, Effect, Layer } from "effect";

import { Bridge } from "../bridge/Bridge";
import { Gateway } from "../bridge/Gateway";
import { makePipeline } from "../protocol/Pipeline";
import { makeStore } from "../state/Store";
import { makeAuth } from "./Auth";
import { makeBank } from "./Bank";
import { makeCombat } from "./Combat";
import { makeDrops } from "./Drops";
import { makeEvents } from "./Events";
import { makeHouse } from "./House";
import { makeInventory } from "./Inventory";
import { makeMap } from "./Map";
import { makeMonsters } from "./Monsters";
import { makePacket } from "./Packet";
import { makePlayer } from "./Player";
import { makePlayers } from "./Players";
import { makeQuests } from "./Quests";
import { makeSettings } from "./Settings";
import { makeShops } from "./Shops";
import { makeTempInventory } from "./TempInventory";
import { makeWaitApi } from "./Wait";

export const makeApi = Effect.gen(function* () {
  const bridge = yield* Bridge;
  const gateway = yield* Gateway;
  const store = yield* makeStore;
  const wait = makeWaitApi(bridge, gateway);
  const events = yield* makeEvents(gateway, wait);
  const packet = yield* makePacket(gateway, store, wait);
  const auth = makeAuth(bridge, store, wait);
  const inventory = makeInventory(bridge, store, wait);
  const bank = makeBank(bridge, store, auth, wait);
  const drops = yield* makeDrops(bridge, store, auth, wait);
  const house = makeHouse(bridge, store);
  const map = makeMap(bridge, store, wait);
  const monsters = makeMonsters(bridge, store);
  const players = makePlayers(store);
  const player = makePlayer(bridge, store, auth, inventory, map, wait);
  const quests = makeQuests(bridge, store, wait);
  const settings = yield* makeSettings(bridge, store);
  const shops = makeShops(bridge, store, inventory, wait);
  const tempInventory = makeTempInventory(store);
  const combat = makeCombat(
    bridge,
    store,
    inventory,
    map,
    monsters,
    player,
    settings,
    tempInventory,
    wait,
  );
  const pipeline = makePipeline(store, gateway);

  yield* gateway.start(pipeline.packet, pipeline.runtime);

  return {
    auth,
    bank,
    combat,
    drops,
    events,
    house,
    inventory,
    map,
    monsters,
    packet,
    player,
    players,
    quests,
    settings,
    shops,
    tempInventory,
    wait,
  };
});

export type ApiService = Effect.Success<typeof makeApi>;

export class Api extends Context.Service<Api, ApiService>()(
  "lucent/renderer/flash/Api",
) {}

export const layer = Layer.effect(Api, makeApi);
