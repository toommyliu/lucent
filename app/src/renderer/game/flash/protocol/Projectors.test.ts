import { describe, expect, it } from "@effect/vitest";

import type { FlashPacket } from "../Types";
import { resolveProjectorRoute, type ProjectorRoute } from "./ProjectorRoutes";

type RouteInput = Pick<FlashPacket, "command" | "direction" | "wireType">;

const route = (
  direction: FlashPacket["direction"],
  wireType: FlashPacket["wireType"],
  command: string,
): RouteInput => ({ command, direction, wireType });

describe("Flash projector routing", () => {
  it.each([
    [route("server", "json", "ct"), "combat"],
    [route("extension", "json", "cb"), "combat"],
    [route("extension", "json", "initInventory"), "inventory"],
    [route("extension", "json", "getDrop"), "inventory"],
    [route("extension", "json", "ccqr"), "quest"],
    [route("extension", "json", "loadShop"), "shop"],
    [route("extension", "json", "moveToArea"), "world"],
    [route("extension", "str", "uotls"), "world"],
    [route("client", "str", "mv"), "world"],
  ] satisfies readonly (readonly [RouteInput, ProjectorRoute])[])(
    "routes $0 to $1",
    (packet, expected) => {
      expect(resolveProjectorRoute(packet)).toBe(expected);
    },
  );

  it.each([
    route("extension", "json", "ct"),
    route("server", "json", "cb"),
    route("server", "json", "getDrop"),
    route("extension", "str", "getDrop"),
    route("extension", "json", "mv"),
    route("client", "json", "mv"),
    route("extension", "xml", "moveToArea"),
    route("extension", "json", "unknownCommand"),
  ])("rejects the wrong callback or wire shape for $command", (packet) => {
    expect(resolveProjectorRoute(packet)).toBeUndefined();
  });
});
