import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";

import type {
  ArmyLoopTauntCommandPayload,
  ArmyLoopTauntReport,
  ArmyLoopTauntReportPayload,
} from "@lucent/core/army";
import type { PlayerSnapshot } from "@lucent/game";
import type { DesktopArmyBridge } from "../../../../shared/desktopBridge";
import type { ApiService } from "../flash/api/Api";
import type { Event } from "../flash/contract/Event";
import {
  type ArmyLoopTauntRuntimePlan,
  makeArmyLoopTauntRuntime,
} from "./ArmyLoopTaunt";

const playerSnapshot = (name: string, playerNumber: number): PlayerSnapshot =>
  ({
    alive: true,
    entityId: playerNumber,
    username: name,
  }) as PlayerSnapshot;

interface Harness {
  readonly casts: readonly number[];
  readonly emitEvent: (event: Event) => Effect.Effect<void>;
  readonly emitTaunt: (assignmentId?: number, monsterMapId?: number) => void;
  readonly nextCommandResult: Effect.Effect<
    Extract<ArmyLoopTauntReport, { readonly type: "command-result" }>
  >;
}

const makeHarness = Effect.fn("ArmyLoopTaunt.test.makeHarness")(function* (
  plan: ArmyLoopTauntRuntimePlan,
  initialAlive: Readonly<Record<number, boolean>> = {},
): Effect.fn.Return<Harness, unknown, Scope.Scope> {
  const players = ["Alice", "Bob"];
  const casts: number[] = [];
  const commandResults =
    yield* Queue.unbounded<
      Extract<ArmyLoopTauntReport, { readonly type: "command-result" }>
    >();
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  let commandListener:
    | ((payload: ArmyLoopTauntCommandPayload) => void)
    | undefined;
  let eventListener: ((event: Event) => Effect.Effect<void>) | undefined;

  const bridge = {
    loopTauntAwait: () => new Promise<never>(() => undefined),
    loopTauntLeave: () => Promise.resolve(),
    loopTauntReady: () => Promise.resolve(),
    loopTauntRegister: () => Promise.resolve({ runId: "run-1" }),
    loopTauntReport: (payload: ArmyLoopTauntReportPayload) => {
      if (payload.report.type === "command-result") {
        runFork(Queue.offer(commandResults, payload.report));
      }
      return Promise.resolve();
    },
    onLoopTauntCommand: (
      listener: (payload: ArmyLoopTauntCommandPayload) => void,
    ) => {
      commandListener = listener;
      return () => {
        commandListener = undefined;
      };
    },
  } as unknown as DesktopArmyBridge;

  const api = {
    combat: {
      castConsumableOnMonster: (monsterMapId: number) =>
        Effect.sync(() => {
          casts.push(monsterMapId);
          return { monsterMapId, success: true };
        }),
      getConsumableSkillItem: () => Effect.succeed({ itemId: 12_917 }),
      getSkillCooldownRemaining: () => Effect.succeed(0),
      target: {
        get: () => Effect.succeed(null),
      },
    },
    events: {
      on: (
        _selector: unknown,
        listener: (event: Event) => Effect.Effect<void>,
      ) =>
        Effect.sync(() => {
          eventListener = listener;
          return () => {
            eventListener = undefined;
          };
        }),
      once: (
        _selector: unknown,
        waitOptions?: { readonly trigger?: Effect.Effect<boolean, unknown> },
      ) =>
        (waitOptions?.trigger ?? Effect.succeed(true)).pipe(
          Effect.flatMap((expected) =>
            expected ? Effect.never : Effect.succeed(null),
          ),
        ),
    },
    map: {
      getId: () => Effect.succeed(100),
      getName: () => Effect.succeed("ultra"),
      getRoomNumber: () => Effect.succeed(1_234),
    },
    monsters: {
      get: (query: number) =>
        Effect.succeed({
          alive: initialAlive[query] ?? true,
          auras: [],
          monsterMapId: query,
        }),
    },
    player: {
      isAlive: () => Effect.succeed(true),
    },
    players: {
      get: (name: string) => {
        const playerNumber = players.indexOf(name) + 1;
        return Effect.succeed(
          playerNumber === 0
            ? null
            : { toJSON: () => playerSnapshot(name, playerNumber) },
        );
      },
    },
  } as unknown as ApiService;

  const runtime = yield* makeArmyLoopTauntRuntime(api, bridge, () =>
    Effect.succeed({
      playerNumber: 1,
      players,
      sessionId: "session-1",
    }),
  );
  const handle = yield* runtime.loopTaunt(plan, () => Effect.void);
  yield* Effect.addFinalizer(() => handle.stop());

  return {
    casts,
    emitEvent: (event) =>
      eventListener === undefined
        ? Effect.die("Loop Taunt event listener was not registered")
        : eventListener(event).pipe(Effect.asVoid),
    emitTaunt: (assignmentId = 0, monsterMapId = 42) => {
      if (commandListener === undefined) {
        throw new Error("Loop Taunt command listener was not registered");
      }
      commandListener({
        command: {
          assignmentId,
          expiresAt: Number.MAX_SAFE_INTEGER,
          lifeRevision: 0,
          monsterMapId,
          type: "taunt",
        },
        commandId: 1,
        runId: "run-1",
        sessionId: "session-1",
      });
    },
    nextCommandResult: Queue.take(commandResults),
  };
});

describe("Army Loop Taunt renderer", () => {
  it.effect(
    "evaluates skipWhen for the selected member with participant snapshots",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const contexts: unknown[] = [];
          const harness = yield* makeHarness([
            {
              assignments: [
                {
                  players: [1, 2],
                  skipWhen: (context) =>
                    Effect.sync(() => {
                      contexts.push(context);
                      return true;
                    }),
                  strategy: { type: "focus" },
                  target: 42,
                },
              ],
            },
          ]);

          expect(contexts).toHaveLength(0);
          harness.emitTaunt();
          expect(yield* harness.nextCommandResult).toEqual({
            commandId: 1,
            outcome: "skipped",
            type: "command-result",
          });
          expect(harness.casts).toHaveLength(0);
          expect(contexts).toHaveLength(1);
          const context = contexts[0] as {
            readonly participants: readonly { readonly playerNumber: number }[];
            readonly self: { readonly playerNumber: number };
          };
          expect(context.self.playerNumber).toBe(1);
          expect(
            context.participants.map(({ playerNumber }) => playerNumber),
          ).toEqual([1, 2]);
        }),
      ),
  );

  it.effect("revalidates the target after skipWhen before dispatching", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let emitEvent: Harness["emitEvent"] | undefined;
        const harness = yield* makeHarness([
          {
            assignments: [
              {
                players: [1, 2],
                skipWhen: () =>
                  emitEvent!({
                    icon: "iwd1,ied1",
                    name: "focus",
                    targetId: 42,
                    targetType: "monster",
                    type: "aura-added",
                  }).pipe(Effect.as(false)),
                strategy: { type: "focus" },
                target: 42,
              },
            ],
          },
        ]);
        emitEvent = harness.emitEvent;

        harness.emitTaunt();

        expect(yield* harness.nextCommandResult).toEqual({
          commandId: 1,
          outcome: "target-unavailable",
          type: "command-result",
        });
        expect(harness.casts).toHaveLength(0);
      }),
    ),
  );

  it.effect(
    "rejects a lower-priority command after an earlier target respawns",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* makeHarness(
            [
              {
                assignments: [
                  {
                    players: [1],
                    strategy: { type: "focus" },
                    target: 41,
                  },
                ],
              },
              {
                assignments: [
                  {
                    players: [1],
                    strategy: { type: "focus" },
                    target: 42,
                  },
                ],
              },
            ],
            { 41: false },
          );

          yield* harness.emitEvent({
            monsterMapId: 41,
            type: "monster-respawn",
          });
          harness.emitTaunt(1, 42);

          expect(yield* harness.nextCommandResult).toEqual({
            commandId: 1,
            outcome: "target-unavailable",
            type: "command-result",
          });
          expect(harness.casts).toHaveLength(0);
        }),
      ),
  );
});
