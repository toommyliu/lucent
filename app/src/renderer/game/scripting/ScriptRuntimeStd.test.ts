import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect } from "effect";
import { EntityState, LivePlayer } from "@lucent/game";

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
      const self = new LivePlayer({
        afk: false,
        cell: "Enter",
        entityId: 1,
        entityType: "player",
        hp: 100,
        level: 1,
        maxHp: 100,
        maxMp: 100,
        mp: 100,
        name: "Hero",
        pad: "Spawn",
        position: { x: 0, y: 0 },
        state: EntityState.Idle,
        username: "Hero",
      });
      const player = {
        get: () => Effect.succeed(self),
        joinMap: (map: string, cell?: string, pad?: string) =>
          Effect.sync(() => {
            calls.push({
              ...(cell === undefined ? {} : { cell }),
              map,
              ...(pad === undefined ? {} : { pad }),
            });
            return true;
          }),
      } as unknown as PlayerApiShape;
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
          players: {
            getMe: () => Effect.succeed(null),
          },
          settings,
        } as ScriptRuntimeServices,
      });

      const joined = yield* lucent.api.player.joinMap("doomvaultb-1e99", "r26");
      const projectedSelf = yield* lucent.api.players.getMe();

      expect(joined).toBe(true);
      expect(projectedSelf).toBe(self);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.cell).toBe("r26");
      expect(calls[0]?.map).toMatch(/^doomvaultb-\d+$/);
      expect(calls[0]?.map).not.toBe("doomvaultb-1e99");
    }),
  );
});
