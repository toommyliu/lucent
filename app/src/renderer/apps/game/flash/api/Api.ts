import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Bridge } from "../bridge/Bridge";
import { Gateway } from "../bridge/Gateway";
import { makePipeline } from "../protocol/Pipeline";
import { makeStore } from "../state/Store";
import { makeAuth } from "./Auth";
import { makeAntiCounter } from "./internal/AntiCounter";
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
import { makeProjectionReadiness } from "./ProjectionReadiness";
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
  const house = makeHouse(bridge, store);
  const bank = yield* makeBank(bridge, store, auth, inventory, house, wait);
  const drops = yield* makeDrops(bridge, store, auth, wait);
  const map = makeMap(bridge, store, wait);
  const monsterServices = yield* makeMonsters(bridge, store, events, wait);
  const monsters = monsterServices.api;
  const players = makePlayers(store);
  const player = makePlayer(bridge, store, auth, inventory, map, wait);
  const projectionReadiness = makeProjectionReadiness(store);
  const quests = makeQuests(bridge, store, wait);
  const settings = yield* makeSettings(bridge, store);
  const antiCounter = makeAntiCounter(bridge, settings.isAntiCounterEnabled);
  const shops = makeShops(bridge, store, inventory, wait);
  const tempInventory = makeTempInventory(store);
  const debug = typeof window !== "undefined" && window.desktop.debug;
  const combat = makeCombat(
    bridge,
    antiCounter,
    store,
    drops,
    events,
    inventory,
    map,
    monsterServices.lookup,
    player,
    players,
    settings,
    tempInventory,
    wait,
  );
  const pipeline = makePipeline(
    store,
    {
      handleEvent: antiCounter.handleEvent,
      publishEvent: gateway.publishEvent,
      ...(debug
        ? {
            reportDiagnostic: gateway.reportDiagnostic,
            reportProjectionTrace: gateway.reportProjectionTrace,
          }
        : {}),
    },
    bridge,
  );

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
    projectionReadiness,
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
