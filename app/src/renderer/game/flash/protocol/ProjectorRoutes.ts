import type { FlashPacket } from "../Types";

export type ProjectorRoute =
  | "combat"
  | "inventory"
  | "quest"
  | "shop"
  | "world";

const inventoryCommands = [
  "loadInventoryBig",
  "initInventory",
  "loadHouseInventory",
  "loadBank",
  "bankFromInv",
  "bankToInv",
  "bankSwapInv",
  "buyItem",
  "sellItem",
  "removeItem",
  "equipItem",
  "unequipItem",
  "enhanceItemShop",
  "enhanceItemLocal",
  "dropItem",
  "getDrop",
  "addItems",
  "forceAddItem",
  "Wheel",
  "turnIn",
  "removeTempItem",
] as const;

const questCommands = ["getQuests", "getQuests2", "ccqr"] as const;

const worldJsonCommands = [
  "moveToArea",
  "event",
  "initUserData",
  "initUserDatas",
  "mtls",
  "clearAuras",
  "uotls",
  "addGoldExp",
] as const;

const worldStringCommands = ["exitArea", "respawnMon", "uotls", "mtls"];
const clientWorldCommands = ["gar", "moveToCell", "mv"];

const routeKey = (
  direction: FlashPacket["direction"],
  wireType: FlashPacket["wireType"],
  command: string,
): string => `${direction}:${wireType}:${command}`;

const routes = new Map<string, ProjectorRoute>([
  ...inventoryCommands.map(
    (command) => [routeKey("extension", "json", command), "inventory"] as const,
  ),
  ...questCommands.map(
    (command) => [routeKey("extension", "json", command), "quest"] as const,
  ),
  [routeKey("extension", "json", "loadShop"), "shop"],
  ...worldJsonCommands.map(
    (command) => [routeKey("extension", "json", command), "world"] as const,
  ),
  ...worldStringCommands.map(
    (command) => [routeKey("extension", "str", command), "world"] as const,
  ),
  ...clientWorldCommands.map(
    (command) => [routeKey("client", "str", command), "world"] as const,
  ),
  // The client exposes ct through the raw-server callback and cb through the extension callback.
  [routeKey("server", "json", "ct"), "combat"],
  [routeKey("extension", "json", "cb"), "combat"],
]);

export const resolveProjectorRoute = (
  packet: Pick<FlashPacket, "command" | "direction" | "wireType">,
): ProjectorRoute | undefined =>
  routes.get(routeKey(packet.direction, packet.wireType, packet.command));
