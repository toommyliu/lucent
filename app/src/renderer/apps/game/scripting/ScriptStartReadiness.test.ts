import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { ProjectionReadinessSnapshot } from "../flash/api/ProjectionReadiness";
import { makeWait } from "../flash/protocol/Wait";
import { ScriptNotReadyError } from "./ScriptRunnerErrors";
import { makeScriptStartReadiness } from "./ScriptStartReadiness";

const incompleteProjection = () =>
  ({
    epoch: 1,
    failures: {
      houseInventory: "loadInventoryBig omitted hitems",
    },
    missing: ["houseInventory", "inventory", "map", "player"],
    state: {
      houseInventory: false,
      inventory: false,
      map: false,
      player: false,
    },
  }) satisfies ProjectionReadinessSnapshot;

const completeProjection = () =>
  ({
    epoch: 1,
    failures: {},
    missing: [],
    state: {
      houseInventory: true,
      inventory: true,
      map: true,
      player: true,
    },
  }) satisfies ProjectionReadinessSnapshot;

describe("ScriptStartReadiness", () => {
  it.effect(
    "does not invoke bridge-backed checks before packet projections complete",
    () =>
      Effect.gen(function* () {
        let bridgeReads = 0;
        let projection: ProjectionReadinessSnapshot = incompleteProjection();
        const readiness = makeScriptStartReadiness({
          auth: {
            getUsername: () =>
              Effect.sync(() => {
                bridgeReads += 1;
                return "Hero";
              }),
            isLoggedIn: () =>
              Effect.sync(() => {
                bridgeReads += 1;
                return true;
              }),
          },
          player: {
            isReady: () =>
              Effect.sync(() => {
                bridgeReads += 1;
                return true;
              }),
          },
          projectionReadiness: {
            inspect: () =>
              Effect.sync(() => ({
                ...projection,
                failures: { ...projection.failures },
                missing: [...projection.missing],
                state: { ...projection.state },
              })),
          },
          wait: makeWait({} as never),
        });

        expect((yield* readiness.get()).missing).toEqual([
          "houseInventory",
          "inventory",
          "map",
          "player",
        ]);
        expect(bridgeReads).toBe(0);

        projection = completeProjection();
        expect((yield* readiness.get()).ready).toBe(true);
        expect(bridgeReads).toBe(3);
      }),
  );

  it.effect("reports exact projection failures after the bounded wait", () =>
    Effect.gen(function* () {
      const readiness = makeScriptStartReadiness({
        auth: {
          getUsername: () => Effect.succeed("Hero"),
          isLoggedIn: () => Effect.succeed(true),
        },
        player: { isReady: () => Effect.succeed(true) },
        projectionReadiness: {
          inspect: () =>
            Effect.succeed({
              ...incompleteProjection(),
              missing: [...incompleteProjection().missing],
            }),
        },
        wait: {
          untilSome: <A>() => Effect.succeed<A | null>(null),
        },
      });

      const error = yield* readiness
        .awaitReady({ interval: "1 millis", timeout: "5 millis" })
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(ScriptNotReadyError);
      expect(error.missing).toEqual([
        "houseInventory",
        "inventory",
        "map",
        "player",
      ]);
      expect(error.message).toContain(
        "house inventory projection (loadInventoryBig omitted hitems)",
      );
    }),
  );
});
