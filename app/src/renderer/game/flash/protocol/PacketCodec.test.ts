import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import {
  parseClientPacket,
  parseExtensionPacket,
  parseServerPacket,
} from "./PacketCodec";

describe("PacketCodec", () => {
  it("parses supported envelopes and rejects malformed input", () => {
    expect(
      Option.getOrNull(parseClientPacket("%xt%zm%mv%1%2%3%"))?.command,
    ).toBe("mv");
    expect(
      Option.getOrNull(
        parseServerPacket(JSON.stringify({ t: "xt", b: { o: { cmd: "ct" } } })),
      )?.command,
    ).toBe("ct");
    expect(
      Option.getOrNull(parseServerPacket("%xt%uotls%Hero%intHP:100%"))?.command,
    ).toBe("uotls");
    expect(
      Option.getOrNull(
        parseServerPacket(
          '[Sending - JSON]: {"t":"sys","b":{"o":{"cmd":"joinOK"}}}',
        ),
      )?.command,
    ).toBe("joinOK");
    expect(
      Option.getOrNull(
        parseExtensionPacket(
          JSON.stringify({ type: "json", dataObj: { cmd: "loadShop" } }),
        ),
      )?.command,
    ).toBe("loadShop");
    expect(Option.isNone(parseExtensionPacket("not-json"))).toBe(true);
  });
});
