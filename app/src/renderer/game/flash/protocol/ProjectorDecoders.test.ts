import { describe, expect, it } from "@effect/vitest";

import { EntityState } from "@lucent/game";
import type { FlashPacket } from "../Types";
import {
  decodeCombatPacket,
  decodeMonsterUpdate,
  decodePlayerUpdate,
  decodeRespawnMonsterIds,
  decodeStringMonsterUpdate,
  decodeStringPlayerUpdate,
  normalizeUpdateMessage,
  parseAuraTargets,
  parseCombatEntityRefs,
} from "./ProjectorDecoders";

const extensionPacket = (
  command: string,
  data: unknown,
  wireType: FlashPacket["wireType"] = "json",
): FlashPacket => ({
  command,
  data,
  direction: "extension",
  raw: "",
  wireType,
});

const serverPacket = (command: string, data: unknown): FlashPacket => ({
  command,
  data,
  direction: "server",
  raw: "",
  wireType: "json",
});

describe("Flash projector decoders", () => {
  it("decodes combat entity references defensively", () => {
    expect(parseCombatEntityRefs("p:1,m:7,bad,m:0,m:nope")).toEqual([
      { id: 1, type: "p" },
      { id: 7, type: "m" },
    ]);
    expect(parseCombatEntityRefs("cast>m:9")).toEqual([{ id: 9, type: "m" }]);
    expect(parseAuraTargets("p:1,m:7")).toEqual([
      { targetId: 1, targetType: "player" },
      { targetId: 7, targetType: "monster" },
    ]);
  });

  it("decodes sparse player and monster patches without inventing values", () => {
    expect(
      decodePlayerUpdate("Hero", {
        afk: "1",
        intHP: "0",
        intState: "0",
        strFrame: "r2",
        tx: "25",
      }),
    ).toEqual({
      afk: true,
      location: { cell: "r2", x: 25 },
      patch: {
        afk: true,
        cell: "r2",
        hp: 0,
        state: EntityState.Dead,
      },
      username: "Hero",
    });
    expect(decodePlayerUpdate("Hero", null)).toBeNull();

    expect(
      decodeMonsterUpdate("7", {
        intHP: "-2",
        intHPMax: "200",
        strFrame: "branch-a",
      }),
    ).toEqual({
      monsterMapId: 7,
      patch: { cell: "branch-a", hp: -2, maxHp: 200 },
    });
    expect(decodeMonsterUpdate("0", {})).toBeNull();
  });

  it("decodes active and passive aura changes and animation endpoints", () => {
    const decoded = decodeCombatPacket(
      serverPacket("ct", {
        a: [
          {
            auras: [
              {
                dur: 5,
                isNew: true,
                msgOn: "Applied",
                nam: "Focus",
              },
            ],
            cInf: "p:1",
            cmd: "aura+",
            tInf: "p:1,m:7",
          },
          {
            auras: [{ dur: 30, nam: "Trait" }],
            cmd: "aura+p",
            tInf: "p:1",
          },
          {
            aura: { msgOff: "Gone", nam: "Focus" },
            cmd: "aura-",
            tInf: "m:7",
          },
        ],
        anims: [
          {
            cInf: "p:1",
            msg: ["Hero", "attacks <mon>"],
            tInf: "m:7",
          },
        ],
      }),
    );

    expect(decoded?.auraChanges).toHaveLength(3);
    expect(decoded?.auraChanges[0]).toMatchObject({
      command: "aura+",
      operation: "add",
      source: { id: 1, type: "p" },
      targets: [
        { targetId: 1, targetType: "player" },
        { targetId: 7, targetType: "monster" },
      ],
    });
    expect(
      decoded?.auraChanges[0]?.operation === "add"
        ? decoded.auraChanges[0].auras[0]
        : null,
    ).toMatchObject({ kind: "active", messageOn: "Applied", name: "Focus" });
    expect(
      decoded?.auraChanges[1]?.operation === "add"
        ? decoded.auraChanges[1].auras[0]?.kind
        : null,
    ).toBe("passive");
    expect(decoded?.auraChanges[2]).toMatchObject({
      command: "aura-",
      operation: "remove",
    });
    expect(decoded?.animations).toEqual([
      {
        message: "Hero...  attacks <mon>",
        targetMonsterMapId: 7,
      },
    ]);
  });

  it("uses reported origin coordinates for cross-cell string updates", () => {
    const player = decodeStringPlayerUpdate(
      extensionPacket(
        "uotls",
        [
          "uotls",
          "unused",
          "Hero",
          "px:150,py:260,tx:0,ty:0,strFrame:r4,strPad:Spawn",
        ],
        "str",
      ),
    );
    expect(player).toMatchObject({
      location: { cell: "r4", pad: "Spawn", x: 150, y: 260 },
      username: "Hero",
    });

    expect(
      decodeStringMonsterUpdate(
        extensionPacket(
          "mtls",
          ["mtls", "unused", "7", "intHP:-2,intMP:0,intState:0"],
          "str",
        ),
      ),
    ).toEqual({
      monsterMapId: 7,
      patch: { hp: -2, mp: 0, state: EntityState.Dead },
    });

    expect(
      decodeRespawnMonsterIds(
        extensionPacket(
          "respawnMon",
          ["respawnMon", "unused", "7, 8,bad,0"],
          "str",
        ),
      ),
    ).toEqual([7, 8]);
  });

  it("normalizes update messages without emitting empty text", () => {
    expect(normalizeUpdateMessage("  message  ")).toBe("message");
    expect(normalizeUpdateMessage(["First", "", "Second"])).toBe(
      "First...  Second",
    );
    expect(normalizeUpdateMessage([])).toBeUndefined();
  });
});
