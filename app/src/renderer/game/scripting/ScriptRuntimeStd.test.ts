import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { normalizeScriptCallback } from "./api/Callbacks";
import { makeScriptPlayerApis } from "./api/Player";
import { ScriptExecutionError } from "./ScriptRunnerErrors";

describe("ScriptRuntimeStd", () => {
  it.effect("composes room policy and the local-player alias", () =>
    Effect.gen(function* () {
      const calls: Array<{
        readonly cell?: string;
        readonly map: string;
        readonly pad?: string;
      }> = [];
      const self = { username: "Local" } as never;
      const staleSelf = { username: "Stale" } as never;
      let usePrivateRooms = true;
      const facades = makeScriptPlayerApis(
        {
          get: () => Effect.succeed(self),
          joinMap: (map, cell, pad) =>
            Effect.sync(() => {
              calls.push({
                ...(cell === undefined ? {} : { cell }),
                map,
                ...(pad === undefined ? {} : { pad }),
              });
              return true;
            }),
        },
        {
          getMe: () => Effect.succeed(staleSelf),
        },
        {
          options: {
            getUsePrivateRooms: () => Effect.succeed(usePrivateRooms),
          },
        },
      );

      expect(yield* facades.player.joinMap("doomvaultb", "r26", "Spawn")).toBe(
        true,
      );
      usePrivateRooms = false;
      expect(yield* facades.player.joinMap("battleon")).toBe(true);

      expect(calls).toEqual([
        {
          cell: "r26",
          map: expect.stringMatching(/^doomvaultb-\d{5}$/u),
          pad: "Spawn",
        },
        { map: "battleon" },
      ]);
      expect(yield* facades.player.get()).toBe(self);
      expect(yield* facades.players.getMe()).toBe(self);
    }),
  );

  it.effect("normalizes supported callbacks and rejects plain results", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      yield* normalizeScriptCallback(
        () =>
          Effect.sync(() => {
            calls.push("effect");
          }),
        undefined,
      );
      yield* normalizeScriptCallback(function* () {
        yield* Effect.sync(() => {
          calls.push("generator");
        });
      }, undefined);
      const error = yield* normalizeScriptCallback(
        () => Promise.resolve(),
        undefined,
      ).pipe(Effect.flip);

      expect(calls).toEqual(["effect", "generator"]);
      expect(error).toBeInstanceOf(ScriptExecutionError);
    }),
  );
});
