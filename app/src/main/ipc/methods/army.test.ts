import { describe, expect, it } from "@effect/vitest";
import type { IpcMainInvokeEvent } from "electron";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import { makeLifetime } from "../../window/RendererLifetimeTesting";

import {
  normalizeArmyConfigName,
  type ArmyConfigPayload,
} from "@lucent/core/army";
import { ArmyIpc } from "../../../shared/ipc";
import { makeListenerRegistry } from "../../app/ListenerRegistry";
import {
  ArmyConfigRepository,
  ArmyConfigRepositoryError,
} from "../../game/army/ArmyConfigRepository";
import {
  ArmyCoordinator,
  layer as armyCoordinatorLayer,
} from "../../game/army/ArmyCoordinator";
import { ArmyLoopTauntOrchestrator } from "../../game/army/ArmyLoopTauntOrchestrator";
import {
  DesktopWindows,
  type DesktopRendererEvent,
} from "../../window/DesktopWindows";
import { DesktopIpc, makeDesktopIpc, type DesktopIpcMain } from "../DesktopIpc";
import { installLifecycle, start } from "./army";

const rendererId = 7;

const soloConfig: ArmyConfigPayload = {
  configName: "solo",
  items: {},
  players: ["Alice"],
  raw: { players: ["Alice"], room: "1234" },
  room: 1234,
  sets: {},
};

const farmConfig: ArmyConfigPayload = {
  ...soloConfig,
  configName: "farm",
  players: ["Alice", "Bob"],
  raw: { players: ["Alice", "Bob"], room: "1234" },
};

const makeGameWindows = () => {
  const lifetimes = new Map([
    [rendererId, makeLifetime(rendererId)],
    [8, makeLifetime(8)],
  ]);
  const events = makeListenerRegistry<DesktopRendererEvent>();
  const describe: DesktopWindows["Service"]["describe"] = (id) =>
    Effect.sync(() => {
      const lifetime = lifetimes.get(id);
      return lifetime === undefined
        ? undefined
        : {
            rendererId: id,
            kind: "game",
            windowId: id,
            ownerId: undefined,
            lifetime,
            ready: true,
          };
    });
  const observe: DesktopWindows["Service"]["observe"] = (filter, listener) =>
    events.subscribe((event) =>
      filter.kind === undefined || filter.kind === event.kind
        ? listener(event)
        : Effect.void,
    );
  const end = (lifecycle: "closed" | "reloaded" | "crashed") =>
    Effect.gen(function* () {
      const current = lifetimes.get(rendererId)!;
      yield* Scope.close(current.scope, Exit.void);
      const generation = current.generation;
      if (lifecycle === "closed") {
        lifetimes.delete(rendererId);
        yield* events.publish(
          { type: "closed", rendererId, kind: "game", generation },
          "unbounded",
        );
      } else if (lifecycle === "crashed") {
        yield* events.publish(
          {
            type: "crashed",
            rendererId,
            kind: "game",
            generation,
            reason: "crashed",
          },
          "unbounded",
        );
      } else {
        const next = makeLifetime(rendererId, generation + 1);
        lifetimes.set(rendererId, next);
        yield* events.publish(
          {
            type: "reloaded",
            rendererId,
            kind: "game",
            generation: next.generation,
          },
          "unbounded",
        );
      }
    });
  return { describe, end, observe };
};

const runStartIpc = <A, E>(
  read: ArmyConfigRepository["Service"]["read"],
  test: (
    windows: ReturnType<typeof makeGameWindows>,
    invokeStart: (
      configName: string,
      playerName?: string,
      senderId?: number,
    ) => Effect.Effect<Fiber.Fiber<unknown>>,
  ) => Effect.Effect<A, E, ArmyCoordinator | Scope.Scope>,
) => {
  const windows = makeGameWindows();
  const handlers = new Map<string, Parameters<DesktopIpcMain["handle"]>[1]>();
  const ipc = makeDesktopIpc(
    {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
      removeHandler: (channel) => {
        handlers.delete(channel);
      },
    },
    { getAllWebContents: () => [], fromId: () => undefined },
  );
  return Effect.gen(function* () {
    yield* installLifecycle();
    yield* ipc.handle(start);
    const invoke = handlers.get(ArmyIpc.start.channel)!;
    return yield* test(
      windows,
      (configName, playerName = "Alice", senderId = rendererId) =>
        Effect.promise(() =>
          invoke({ sender: { id: senderId } } as IpcMainInvokeEvent, {
            configName,
            playerName,
          }),
        ).pipe(Effect.forkChild),
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        armyCoordinatorLayer,
        Layer.succeed(DesktopIpc, ipc),
        Layer.mock(DesktopWindows, {
          describe: windows.describe,
          observe: windows.observe,
        }),
        Layer.succeed(ArmyConfigRepository, { read }),
        Layer.mock(ArmyLoopTauntOrchestrator, {
          onCommand: () => Effect.void,
        }),
      ),
    ),
  );
};

describe("army start IPC", () => {
  it.effect.each(["farm", "farm.yaml"])(
    "joins an existing session after its config becomes unreadable as %s",
    (joinName) => {
      let broken = false;
      let reads = 0;
      const read = (configName: string) =>
        Effect.suspend(() => {
          reads += 1;
          return broken
            ? Effect.fail(
                new ArmyConfigRepositoryError({
                  operation: "parse",
                  configName,
                  cause: new Error("Broken edit"),
                }),
              )
            : Effect.succeed(farmConfig);
        });

      return runStartIpc(read, (_windows, invokeStart) =>
        Effect.gen(function* () {
          const alice = yield* invokeStart("farm");
          const coordinator = yield* ArmyCoordinator;
          const sessions = yield* coordinator.getSessions().pipe(
            Effect.tap(() => Effect.yieldNow),
            Effect.repeat({
              until: (sessions) => sessions.length > 0,
              times: 10,
            }),
          );
          expect(sessions.map((session) => session.phase)).toEqual([
            "collecting",
          ]);
          broken = true;

          const bob = yield* invokeStart(joinName, "Bob", 8);
          expect(yield* Fiber.join(bob)).toMatchObject({
            ok: true,
            value: {
              configName: "farm",
              playerName: "Bob",
              playerNumber: 2,
              players: ["Alice", "Bob"],
              role: "member",
              room: 1234,
            },
          });
          expect(yield* Fiber.join(alice)).toMatchObject({
            ok: true,
            value: { configName: "farm", playerName: "Alice", role: "leader" },
          });
          expect(reads).toBe(1);
          expect(
            (yield* coordinator.getSessions()).map((session) => ({
              participants: Array.from(session.participants.entries()),
              phase: session.phase,
            })),
          ).toEqual([
            {
              participants: [
                ["alice", 7],
                ["bob", 8],
              ],
              phase: "active",
            },
          ]);
        }),
      );
    },
  );

  it.effect("reports a config read failure for the first joiner", () =>
    runStartIpc(
      (configName) =>
        Effect.fail(
          new ArmyConfigRepositoryError({
            operation: "read",
            configName,
            cause: new Error("Missing config"),
          }),
        ),
      (_windows, invokeStart) =>
        Effect.gen(function* () {
          const reply = yield* invokeStart("farm");
          expect(yield* Fiber.join(reply)).toEqual({
            ok: false,
            message: "Could not read army config farm.",
          });
          const coordinator = yield* ArmyCoordinator;
          expect(yield* coordinator.getSessions()).toEqual([]);
        }),
    ),
  );

  it.effect("reads a config whose name ends in .yaml from its own file", () =>
    runStartIpc(
      (configNameInput) => {
        const configName = normalizeArmyConfigName(configNameInput);
        return configName === "solo.yaml"
          ? Effect.succeed({ ...soloConfig, configName })
          : Effect.fail(
              new ArmyConfigRepositoryError({
                operation: "read",
                configName,
                cause: new Error("Missing config"),
              }),
            );
      },
      (_windows, invokeStart) =>
        Effect.gen(function* () {
          const reply = yield* invokeStart("solo.yaml.yaml");
          expect(yield* Fiber.join(reply)).toMatchObject({
            ok: true,
            value: { configName: "solo.yaml", playerName: "Alice" },
          });
        }),
    ),
  );

  it.effect.each(["succeeds", "fails"] as const)(
    "joins the session created while another first joiner's load %s",
    (outcome) =>
      Effect.gen(function* () {
        const reading = yield* Deferred.make<void>();
        const released = yield* Deferred.make<
          ArmyConfigPayload,
          ArmyConfigRepositoryError
        >();
        let reads = 0;
        const read = () =>
          Effect.suspend(() => {
            reads += 1;
            return reads === 1
              ? Deferred.succeed(reading, undefined).pipe(
                  Effect.andThen(Deferred.await(released)),
                )
              : Effect.succeed(farmConfig);
          });

        yield* runStartIpc(read, (_windows, invokeStart) =>
          Effect.gen(function* () {
            const bob = yield* invokeStart("farm", "Bob", 8);
            yield* Deferred.await(reading);
            const alice = yield* invokeStart("farm");
            const coordinator = yield* ArmyCoordinator;
            const sessions = yield* coordinator.getSessions().pipe(
              Effect.tap(() => Effect.yieldNow),
              Effect.repeat({
                until: (sessions) => sessions.length > 0,
                times: 10,
              }),
            );
            expect(sessions.map((session) => session.phase)).toEqual([
              "collecting",
            ]);

            if (outcome === "succeeds") {
              yield* Deferred.succeed(released, {
                ...farmConfig,
                players: ["Bob"],
                raw: { players: ["Bob"], room: "9876" },
                room: 9876,
              });
            } else {
              yield* Deferred.fail(
                released,
                new ArmyConfigRepositoryError({
                  operation: "parse",
                  configName: "farm",
                  cause: new Error("Broken edit"),
                }),
              );
            }

            expect(yield* Fiber.join(bob)).toMatchObject({
              ok: true,
              value: {
                configName: "farm",
                playerName: "Bob",
                playerNumber: 2,
                players: ["Alice", "Bob"],
                role: "member",
                room: 1234,
              },
            });
            expect(yield* Fiber.join(alice)).toMatchObject({
              ok: true,
              value: { playerName: "Alice", role: "leader", room: 1234 },
            });
            expect(
              (yield* coordinator.getSessions()).map((session) => ({
                configName: session.config.configName,
                phase: session.phase,
              })),
            ).toEqual([{ configName: "farm", phase: "active" }]);
          }),
        );
      }),
  );

  for (const lifecycle of ["closed", "reloaded", "crashed"] as const) {
    it.effect(
      `does not seat a game renderer ${lifecycle} while its army config loads`,
      () =>
        Effect.gen(function* () {
          const reading = yield* Deferred.make<void>();
          const released = yield* Deferred.make<ArmyConfigPayload>();
          const read = () =>
            Deferred.succeed(reading, undefined).pipe(
              Effect.andThen(Deferred.await(released)),
            );

          yield* runStartIpc(read, (windows, invokeStart) =>
            Effect.gen(function* () {
              const reply = yield* invokeStart("solo");
              yield* Deferred.await(reading);
              yield* windows.end(lifecycle);
              yield* Deferred.succeed(released, soloConfig);
              const envelope = yield* Fiber.join(reply);

              const coordinator = yield* ArmyCoordinator;
              const sessions = yield* coordinator.getSessions();
              expect(
                sessions.map((session) =>
                  Array.from(session.participants.values()),
                ),
              ).toEqual([]);
              expect(envelope).toEqual({
                ok: false,
                message: "Army window is no longer available",
              });
            }),
          );
        }),
    );
  }

  it.effect("keeps the window-closed reason while waiting for the roster", () =>
    runStartIpc(
      () =>
        Effect.succeed({
          ...soloConfig,
          configName: "duo",
          players: ["Alice", "Bob"],
          raw: { players: ["Alice", "Bob"], room: "1234" },
        }),
      (windows, invokeStart) =>
        Effect.gen(function* () {
          const reply = yield* invokeStart("duo");
          const coordinator = yield* ArmyCoordinator;
          const sessions = yield* coordinator.getSessions().pipe(
            Effect.tap(() => Effect.yieldNow),
            Effect.repeat({
              until: (sessions) => sessions.length > 0,
              times: 10,
            }),
          );
          expect(
            sessions.map((session) => ({
              participants: Array.from(session.participants.entries()),
              phase: session.phase,
            })),
          ).toEqual([{ participants: [["alice", 7]], phase: "collecting" }]);

          yield* windows.end("closed");

          expect(yield* Fiber.join(reply)).toEqual({
            ok: false,
            message: "Army window closed",
          });
          expect(yield* coordinator.getSessions()).toEqual([]);
        }),
    ),
  );
});
