import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { matchesPacketSelector } from "./PacketSelectors";
import { parseFlashPacket } from "./PacketParser";

describe("Flash packet parsing", () => {
  it("parses client xt packets", () => {
    const packet = parseFlashPacket(
      "client",
      "[Sending - STR]: %xt%zm%equipItem%1%123%",
    );

    expect(Option.isSome(packet)).toBe(true);
    if (Option.isSome(packet) && packet.value.direction === "client") {
      expect(packet.value.command).toBe("equipItem");
      expect(packet.value.params).toEqual([
        "xt",
        "zm",
        "equipItem",
        "1",
        "123",
      ]);
    }
  });

  it("parses server xt json packets", () => {
    const packet = parseFlashPacket(
      "server",
      JSON.stringify({ b: { o: { ItemID: 7, cmd: "buyItem" } }, t: "xt" }),
    );

    expect(Option.isSome(packet)).toBe(true);
    if (Option.isSome(packet)) {
      expect(packet.value.command).toBe("buyItem");
      expect(packet.value.direction).toBe("server");
      expect(packet.value.wireType).toBe("json");
    }
  });

  it("parses extension string and json packets", () => {
    const strPacket = parseFlashPacket(
      "extension",
      JSON.stringify({ dataObj: ["moveToArea", "battleon"], type: "str" }),
    );
    const jsonPacket = parseFlashPacket(
      "extension",
      JSON.stringify({
        dataObj: { cmd: "loadShop", shopinfo: {} },
        type: "json",
      }),
    );

    expect(Option.isSome(strPacket) ? strPacket.value.command : null).toBe(
      "moveToArea",
    );
    expect(Option.isSome(jsonPacket) ? jsonPacket.value.command : null).toBe(
      "loadShop",
    );
  });

  it("matches packet selectors by direction, command, and wire type", () => {
    const packet = parseFlashPacket(
      "server",
      JSON.stringify({ cmd: "dropItem", items: {} }),
    );

    expect(Option.isSome(packet)).toBe(true);
    if (Option.isSome(packet)) {
      expect(
        matchesPacketSelector(packet.value, {
          command: "dropItem",
          direction: "server",
          wireType: "json",
        }),
      ).toBe(true);
      expect(
        matchesPacketSelector(packet.value, {
          command: "equipItem",
          direction: "server",
        }),
      ).toBe(false);
    }
  });
});
