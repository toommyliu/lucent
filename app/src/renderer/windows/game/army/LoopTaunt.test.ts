import { describe, expect, it } from "@effect/vitest";
import {
  exhaustLoopTauntParticipant,
  makeLoopTauntTurnState,
  matchesLoopTauntFocusAuraAdd,
  matchesLoopTauntMessage,
  normalizeLoopTauntOptions,
  resolveLoopTauntTurn,
} from "./LoopTaunt";

describe("LoopTaunt domain", () => {
  it("requires explicit non-empty participants", () => {
    expect(() =>
      normalizeLoopTauntOptions(
        {
          participants: [],
          target: "UltraBoss",
          trigger: { type: "focus" },
        } as never,
        ["Alice", "Bob"],
      ),
    ).toThrow("participants must contain at least one army player");
  });

  it("normalizes participants and derives ids from target, trigger, and participants", () => {
    const normalized = normalizeLoopTauntOptions(
      {
        participants: [1, "Bob"],
        target: "UltraBoss",
        trigger: { message: "prepares a lethal strike", type: "message" },
      },
      ["Alice", "Bob", "Cora"],
    );

    expect(normalized.participants).toEqual([
      { name: "Alice", number: 1 },
      { name: "Bob", number: 2 },
    ]);
    expect(normalized.id).toBe(
      "loop-taunt:UltraBoss:message:prepares a lethal strike:1:Alice,2:Bob",
    );
  });

  it("matches Focus only when the Scroll of Enrage icon is present", () => {
    expect(matchesLoopTauntFocusAuraAdd("Focus", { icon: "iwd1,ied1" })).toBe(
      true,
    );
    expect(matchesLoopTauntFocusAuraAdd("Focus", { icon: "other-icon" })).toBe(
      false,
    );
    expect(matchesLoopTauntFocusAuraAdd("Other", { icon: "iwd1,ied1" })).toBe(
      false,
    );
  });

  it("matches update messages case-insensitively with normalized whitespace", () => {
    expect(
      matchesLoopTauntMessage(" lethal   strike ", "Boss uses LEThal strike"),
    ).toBe(true);
  });

  it("selects the next non-exhausted participant", () => {
    const participants = [
      { name: "Alice", number: 1 },
      { name: "Bob", number: 2 },
    ];
    const state = exhaustLoopTauntParticipant(
      makeLoopTauntTurnState(),
      participants[0]!.number,
    );

    expect(resolveLoopTauntTurn(participants, state).selected).toEqual({
      name: "Bob",
      number: 2,
    });
  });

  it("throws when every participant is exhausted", () => {
    const participants = [
      { name: "Alice", number: 1 },
      { name: "Bob", number: 2 },
    ];
    const state = exhaustLoopTauntParticipant(
      exhaustLoopTauntParticipant(makeLoopTauntTurnState(), 1),
      2,
    );

    expect(() => resolveLoopTauntTurn(participants, state)).toThrow(
      "Loop Taunt found no eligible participant",
    );
  });
});
