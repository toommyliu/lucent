import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect } from "effect";

import type { EventsApiShape } from "../flash/api/Events";
import type { PacketApiShape } from "../flash/api/Packet";
import type { PlayerApiShape } from "../flash/api/Player";
import type { SettingsApiShape } from "../flash/api/Settings";
import {
  makeScriptLucentStd,
  type ScriptRuntimeServices,
} from "./ScriptRuntimeStd";
import type { ScriptRuntimeApi } from "./ScriptApi";
import { makeScriptAsyncScope } from "./scriptAsyncScope";

const makeScript = (usePrivateRooms: boolean): ScriptRuntimeApi =>
  ({
    options: {
      getUsePrivateRooms: () => Effect.succeed(usePrivateRooms),
    },
  }) as ScriptRuntimeApi;

describe("ScriptRuntimeStd", () => {
  it.effect("coerces explicit nonnumeric room suffixes for script joins", () =>
    Effect.gen(function* () {
      const calls: Array<{
        readonly cell?: string;
        readonly map: string;
        readonly pad?: string;
      }> = [];
      const player = {
        joinMap: (map, cell, pad) =>
          Effect.sync(() => {
            calls.push({
              ...(cell === undefined ? {} : { cell }),
              map,
              ...(pad === undefined ? {} : { pad }),
            });
            return true;
          }),
      } as PlayerApiShape;
      const events = {
        on: () => Effect.succeed(() => {}),
      } as unknown as EventsApiShape;
      const packet = {
        on: () => Effect.succeed(() => {}),
      } as unknown as PacketApiShape;
      const settings = {
        isAntiCounterEnabled: () => Effect.succeed(false),
        setAntiCounterEnabled: () => Effect.void,
      } as unknown as SettingsApiShape;

      const lucent = makeScriptLucentStd({
        failCause: (_cause: Cause.Cause<unknown>) => Effect.void,
        features: {} as never,
        scope: makeScriptAsyncScope(),
        script: makeScript(true),
        services: {
          events,
          packet,
          player,
          settings,
        } as ScriptRuntimeServices,
      });

      const joined = yield* lucent.api.player.joinMap("doomvaultb-1e99", "r26");

      expect(joined).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.cell).toBe("r26");
      expect(calls[0]?.map).toMatch(/^doomvaultb-\d+$/);
      expect(calls[0]?.map).not.toBe("doomvaultb-1e99");
    }),
  );
});
