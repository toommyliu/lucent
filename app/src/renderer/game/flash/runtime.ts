import { Layer, ManagedRuntime } from "effect";

import * as AuthApi from "./api/Auth";
import * as BankApi from "./api/Bank";
import * as CombatApi from "./api/Combat";
import * as DropsApi from "./api/Drops";
import * as EventsApi from "./api/Events";
import * as HouseApi from "./api/House";
import * as InventoryApi from "./api/Inventory";
import * as MapApi from "./api/Map";
import * as MonstersApi from "./api/Monsters";
import * as PacketApi from "./api/Packet";
import * as PlayerApi from "./api/Player";
import * as PlayersApi from "./api/Players";
import * as QuestsApi from "./api/Quests";
import * as SettingsApi from "./api/Settings";
import * as ShopsApi from "./api/Shops";
import * as TempInventoryApi from "./api/TempInventory";
import * as WaitApi from "./api/Wait";
import * as FlashCallbacks from "./FlashCallbacks";
import * as AutoRelogin from "./features/AutoRelogin";
import * as AutoZone from "./features/AutoZone";
import * as SwfBridge from "./SwfBridge";
import * as FlashProtocol from "./protocol/FlashProtocol";
import * as Projectors from "./protocol/Projectors";
import * as DropsState from "./state/Drops";
import * as ItemsState from "./state/Items";
import * as QuestsState from "./state/Quests";
import * as SettingsState from "./state/Settings";
import * as ShopsState from "./state/Shops";
import * as WorldState from "./state/World";

export const FlashStateLayer = Layer.mergeAll(
  DropsState.layer,
  ItemsState.layer,
  QuestsState.layer,
  SettingsState.layer,
  ShopsState.layer,
  WorldState.layer,
);

const FlashBaseLayer = Layer.mergeAll(
  FlashCallbacks.layer,
  SwfBridge.layer,
  FlashStateLayer,
);

export const FlashProtocolLayer = FlashProtocol.layer.pipe(
  Layer.provideMerge(FlashBaseLayer),
);

const FlashWaitLayer = WaitApi.layer.pipe(
  Layer.provideMerge(FlashProtocolLayer),
);

const FlashPrimaryApiLayer = Layer.mergeAll(
  EventsApi.layer,
  HouseApi.layer,
  InventoryApi.layer,
  MapApi.layer,
  MonstersApi.layer,
  PacketApi.layer,
  PlayersApi.layer,
  QuestsApi.layer,
  SettingsApi.layer,
  TempInventoryApi.layer,
  AuthApi.layer,
).pipe(Layer.provideMerge(FlashWaitLayer));

const FlashDependentApiLayer = Layer.mergeAll(
  BankApi.layer,
  DropsApi.layer,
  PlayerApi.layer,
  ShopsApi.layer,
).pipe(Layer.provideMerge(FlashPrimaryApiLayer));

export const FlashApiLayer = CombatApi.layer.pipe(
  Layer.provideMerge(FlashDependentApiLayer),
);

export const FlashFeatureLayer = Layer.mergeAll(
  AutoRelogin.layer,
  AutoZone.layer,
).pipe(Layer.provideMerge(FlashApiLayer));

export const FlashLiveLayer = Projectors.layer.pipe(
  Layer.provideMerge(FlashFeatureLayer),
);

export const flashRuntime = ManagedRuntime.make(FlashLiveLayer);
