import { Collection } from "@lucent/collection";
import { EntityState, Monster } from "@lucent/game";
import type { MonsterData } from "@lucent/game";
import { Effect, Fiber, Layer, Option } from "effect";
import { expect, test } from "vitest";
import {
  COMBAT_PROFILE_LIBRARY_VERSION,
  DEFAULT_COMBAT_PROFILE_ID,
  type CombatProfileLibrary,
} from "../../../../../shared/combat-profiles";
import { Combat, type CombatShape } from "../../flash/Services/Combat";
import {
  GameEvents,
  type GameEvent,
  type GameEventHandler,
  type GameEventMap,
  type GameEventsShape,
} from "../../flash/Services/GameEvents";
import { Player, type PlayerShape } from "../../flash/Services/Player";
import { World, type WorldShape } from "../../flash/Services/World";
import { Jobs, type JobsShape } from "../../jobs/Services/Jobs";
import { AutoAttack, type AutoAttackShape } from "../Services/AutoAttack";
import { AutoAttackLive } from "./AutoAttack";

type HandlerStore = {
  [K in GameEvent]?: Set<GameEventHandler<K>>;
};

const monsterData = (overrides?: Partial<MonsterData>): MonsterData => ({
  iLvl: 100,
  intHP: 10_000,
  intHPMax: 10_000,
  intMP: 100,
  intMPMax: 100,
  intState: EntityState.Idle,
  monId: 1,
  monMapId: 7,
  sRace: "Undead",
  strFrame: "Boss",
  strMonName: "Training Dummy",
  ...overrides,
});

const makeLibrary = (
  resetSkillIndexOnMonsterDeath: boolean,
): CombatProfileLibrary => ({
  version: COMBAT_PROFILE_LIBRARY_VERSION,
  profiles: [
    {
      id: DEFAULT_COMBAT_PROFILE_ID,
      label: "Generic",
      role: "Base",
      delayMs: 0,
      cooldownMode: "use-if-ready",
      timeoutMs: 10_000,
      ...(resetSkillIndexOnMonsterDeath
        ? { resetSkillIndexOnMonsterDeath: true }
        : {}),
      steps: [
        { id: "one", skill: 1, conditions: [] },
        { id: "two", skill: 2, conditions: [] },
      ],
    },
  ],
  autoAttack: {
    mode: "generic",
  },
});

const makeGameEvents = (): GameEventsShape => {
  const handlers: HandlerStore = {};

  return {
    started: true,
    on(event, handler) {
      return Effect.sync(() => {
        const eventHandlers =
          (handlers[event] as Set<typeof handler> | undefined) ??
          new Set<typeof handler>();
        eventHandlers.add(handler);
        handlers[event] = eventHandlers as HandlerStore[typeof event];

        return () => {
          eventHandlers.delete(handler);
        };
      });
    },
    emit(event, payload) {
      const eventHandlers = handlers[event] as
        | Set<GameEventHandler<typeof event>>
        | undefined;
      return Effect.forEach(
        eventHandlers ? Array.from(eventHandlers) : [],
        (handler) =>
          handler(payload).pipe(Effect.catchCause(() => Effect.void)),
        { discard: true },
      ).pipe(Effect.asVoid);
    },
  };
};

const makeWorld = (
  monsters: ReadonlyMap<number, Monster>,
  availableIds: () => readonly number[],
): WorldShape =>
  ({
    map: {},
    monsters: {
      get: (selector: number) =>
        Effect.succeed(
          monsters.has(selector)
            ? Option.some(monsters.get(selector)!)
            : Option.none(),
        ),
      getAvailable: () =>
        Effect.succeed(
          new Collection(
            availableIds()
              .map((monMapId) => monsters.get(monMapId))
              .filter((monster): monster is Monster => monster !== undefined)
              .map((monster) => [monster.monMapId, monster] as const),
          ),
        ),
    },
    players: {},
    entities: {},
  }) as unknown as WorldShape;

const withAutoAttack = async <A>(
  body: (
    autoAttack: AutoAttackShape,
    harness: {
      readonly jobsState: { task?: Effect.Effect<void, unknown> };
    },
  ) => Effect.Effect<A, unknown>,
  services: {
    readonly combat: CombatShape;
    readonly gameEvents: GameEventsShape;
    readonly world: WorldShape;
  },
): Promise<A> => {
  const jobsState: { task?: Effect.Effect<void, unknown> } = {};
  const jobs = {
    start: (_key: string, task: Effect.Effect<void, unknown>) => {
      jobsState.task = task;
      return Effect.succeed(true);
    },
    startPeriodic: () => Effect.succeed(true),
    startPeriodicJob: () => Effect.succeed(true),
    stop: () => Effect.succeed(true),
    stopAll: () => Effect.void,
    isRunning: () => Effect.succeed(jobsState.task !== undefined),
    getRunningKeys: () => Effect.succeed([]),
  } as JobsShape;
  const player = {
    getClassName: () => Effect.succeed(undefined),
    isAlive: () => Effect.succeed(true),
  } as unknown as PlayerShape;

  return await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const autoAttack = yield* AutoAttack;
        return yield* body(autoAttack, { jobsState });
      }),
    ).pipe(
      Effect.provide(
        AutoAttackLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Jobs)(jobs),
              Layer.succeed(Combat)(services.combat),
              Layer.succeed(GameEvents)(services.gameEvents),
              Layer.succeed(Player)(player),
              Layer.succeed(World)(services.world),
            ),
          ),
        ),
      ),
    ),
  );
};

const monsterDeathEvent = (monMapId: number): GameEventMap["monsterDeath"] => ({
  monMapId,
  packet: {} as GameEventMap["monsterDeath"]["packet"],
});

test("auto attack resets the profile cursor on any monster death when unlocked", async () => {
  const gameEvents = makeGameEvents();
  const monster = new Monster(monsterData());
  const monsters = new Map([[monster.monMapId, monster]]);
  let currentTargetId: number | undefined;
  const useSkillCalls: string[] = [];
  const combat = {
    attackMonster: (monMapId: number) =>
      Effect.sync(() => {
        currentTargetId = monMapId;
        return true;
      }),
    canUseSkill: () => Effect.succeed(true),
    useSkill: (skill: number | string) =>
      Effect.sync(() => {
        useSkillCalls.push(String(skill));
      }),
    cancelAutoAttack: () => Effect.void,
    cancelTarget: () => Effect.void,
    target: {
      get: () =>
        Effect.succeed(
          currentTargetId === undefined
            ? Option.none()
            : Option.some({
                type: "monster" as const,
                monMapId: currentTargetId,
                entity: monsters.get(currentTargetId)!,
              }),
        ),
    },
  } as unknown as CombatShape;

  const result = await withAutoAttack(
    (autoAttack, harness) =>
      Effect.gen(function* () {
        yield* autoAttack.enable({
          library: makeLibrary(true),
          profileRef: "generic",
        });
        if (harness.jobsState.task === undefined) {
          throw new Error("Expected auto attack job task");
        }

        const fiber = yield* Effect.forkDetach(harness.jobsState.task, {
          startImmediately: true,
        });
        yield* Effect.sleep("20 millis");
        yield* gameEvents.emit("monsterDeath", monsterDeathEvent(999));
        yield* Effect.sleep("70 millis");
        yield* Fiber.interrupt(fiber);
        return useSkillCalls;
      }),
    {
      combat,
      gameEvents,
      world: makeWorld(monsters, () => [monster.monMapId]),
    },
  );

  expect(result.slice(0, 2)).toEqual(["1", "1"]);
});

test("auto attack keeps cursor position on monster death when reset is disabled", async () => {
  const gameEvents = makeGameEvents();
  const monster = new Monster(monsterData());
  const monsters = new Map([[monster.monMapId, monster]]);
  let currentTargetId: number | undefined;
  const useSkillCalls: string[] = [];
  const combat = {
    attackMonster: (monMapId: number) =>
      Effect.sync(() => {
        currentTargetId = monMapId;
        return true;
      }),
    canUseSkill: () => Effect.succeed(true),
    useSkill: (skill: number | string) =>
      Effect.sync(() => {
        useSkillCalls.push(String(skill));
      }),
    cancelAutoAttack: () => Effect.void,
    cancelTarget: () => Effect.void,
    target: {
      get: () =>
        Effect.succeed(
          currentTargetId === undefined
            ? Option.none()
            : Option.some({
                type: "monster" as const,
                monMapId: currentTargetId,
                entity: monsters.get(currentTargetId)!,
              }),
        ),
    },
  } as unknown as CombatShape;

  const result = await withAutoAttack(
    (autoAttack, harness) =>
      Effect.gen(function* () {
        yield* autoAttack.enable({
          library: makeLibrary(false),
          profileRef: "generic",
        });
        if (harness.jobsState.task === undefined) {
          throw new Error("Expected auto attack job task");
        }

        const fiber = yield* Effect.forkDetach(harness.jobsState.task, {
          startImmediately: true,
        });
        yield* Effect.sleep("20 millis");
        yield* gameEvents.emit("monsterDeath", monsterDeathEvent(999));
        yield* Effect.sleep("70 millis");
        yield* Fiber.interrupt(fiber);
        return useSkillCalls;
      }),
    {
      combat,
      gameEvents,
      world: makeWorld(monsters, () => [monster.monMapId]),
    },
  );

  expect(result.slice(0, 2)).toEqual(["1", "2"]);
});

test("auto attack random selection does not create a target lock", async () => {
  const gameEvents = makeGameEvents();
  const first = new Monster(monsterData({ monMapId: 7 }));
  const second = new Monster(monsterData({ monMapId: 8 }));
  const monsters = new Map([
    [first.monMapId, first],
    [second.monMapId, second],
  ]);
  let currentTargetId: number | undefined;
  const attackCalls: number[] = [];
  const combat = {
    attackMonster: (monMapId: number) =>
      Effect.sync(() => {
        attackCalls.push(monMapId);
        currentTargetId = monMapId;
        return true;
      }),
    canUseSkill: () => Effect.succeed(true),
    useSkill: () => Effect.void,
    cancelAutoAttack: () => Effect.void,
    cancelTarget: () => Effect.void,
    target: {
      get: () =>
        Effect.succeed(
          currentTargetId === undefined
            ? Option.none()
            : Option.some({
                type: "monster" as const,
                monMapId: currentTargetId,
                entity: monsters.get(currentTargetId)!,
              }),
        ),
    },
  } as unknown as CombatShape;

  const result = await withAutoAttack(
    (autoAttack, harness) =>
      Effect.gen(function* () {
        yield* autoAttack.enable({
          library: makeLibrary(false),
          profileRef: "generic",
        });
        if (harness.jobsState.task === undefined) {
          throw new Error("Expected auto attack job task");
        }

        const fiber = yield* Effect.forkDetach(harness.jobsState.task, {
          startImmediately: true,
        });
        yield* Effect.sleep("20 millis");
        first.data.intHP = 0;
        first.data.intState = EntityState.Dead;
        yield* Effect.sleep("70 millis");
        yield* Fiber.interrupt(fiber);
        return attackCalls;
      }),
    {
      combat,
      gameEvents,
      world: makeWorld(monsters, () =>
        first.isDead() ? [second.monMapId] : [first.monMapId, second.monMapId],
      ),
    },
  );

  expect(result.slice(0, 2)).toEqual([7, 8]);
});

test("auto attack locks manual targets, waits for respawn, and resets locked cursor on death", async () => {
  const gameEvents = makeGameEvents();
  const locked = new Monster(monsterData({ monMapId: 7 }));
  const other = new Monster(monsterData({ monMapId: 8 }));
  const monsters = new Map([
    [locked.monMapId, locked],
    [other.monMapId, other],
  ]);
  let currentTargetId: number | undefined = locked.monMapId;
  const attackCalls: number[] = [];
  const useSkillCalls: string[] = [];
  const combat = {
    attackMonster: (monMapId: number) =>
      Effect.sync(() => {
        attackCalls.push(monMapId);
        currentTargetId = monMapId;
        return true;
      }),
    canUseSkill: () => Effect.succeed(true),
    useSkill: (skill: number | string) =>
      Effect.sync(() => {
        useSkillCalls.push(String(skill));
      }),
    cancelAutoAttack: () => Effect.void,
    cancelTarget: () => Effect.void,
    target: {
      get: () =>
        Effect.succeed(
          currentTargetId === undefined
            ? Option.none()
            : Option.some({
                type: "monster" as const,
                monMapId: currentTargetId,
                entity: monsters.get(currentTargetId)!,
              }),
        ),
    },
  } as unknown as CombatShape;

  const result = await withAutoAttack(
    (autoAttack, harness) =>
      Effect.gen(function* () {
        yield* autoAttack.enable({
          library: makeLibrary(true),
          profileRef: "generic",
        });
        if (harness.jobsState.task === undefined) {
          throw new Error("Expected auto attack job task");
        }

        const fiber = yield* Effect.forkDetach(harness.jobsState.task, {
          startImmediately: true,
        });
        yield* Effect.sleep("20 millis");
        locked.data.intHP = 0;
        locked.data.intState = EntityState.Dead;
        currentTargetId = undefined;
        yield* gameEvents.emit(
          "monsterDeath",
          monsterDeathEvent(locked.monMapId),
        );
        yield* Effect.sleep("70 millis");
        locked.data.intHP = locked.data.intHPMax;
        locked.data.intState = EntityState.Idle;
        yield* Effect.sleep("280 millis");
        yield* Fiber.interrupt(fiber);
        return { attackCalls, useSkillCalls };
      }),
    {
      combat,
      gameEvents,
      world: makeWorld(monsters, () => [other.monMapId]),
    },
  );

  expect(result.attackCalls.length).toBeGreaterThanOrEqual(2);
  expect(result.attackCalls.every((monMapId) => monMapId === 7)).toBe(true);
  expect(result.useSkillCalls.slice(0, 2)).toEqual(["1", "1"]);
});

test("auto attack replaces the target lock when the user selects another monster", async () => {
  const gameEvents = makeGameEvents();
  const first = new Monster(monsterData({ monMapId: 7 }));
  const second = new Monster(monsterData({ monMapId: 8 }));
  const monsters = new Map([
    [first.monMapId, first],
    [second.monMapId, second],
  ]);
  let currentTargetId: number | undefined = first.monMapId;
  const attackCalls: number[] = [];
  const combat = {
    attackMonster: (monMapId: number) =>
      Effect.sync(() => {
        attackCalls.push(monMapId);
        currentTargetId = monMapId;
        return true;
      }),
    canUseSkill: () => Effect.succeed(true),
    useSkill: () => Effect.void,
    cancelAutoAttack: () => Effect.void,
    cancelTarget: () => Effect.void,
    target: {
      get: () =>
        Effect.succeed(
          currentTargetId === undefined
            ? Option.none()
            : Option.some({
                type: "monster" as const,
                monMapId: currentTargetId,
                entity: monsters.get(currentTargetId)!,
              }),
        ),
    },
  } as unknown as CombatShape;

  const result = await withAutoAttack(
    (autoAttack, harness) =>
      Effect.gen(function* () {
        yield* autoAttack.enable({
          library: makeLibrary(false),
          profileRef: "generic",
        });
        if (harness.jobsState.task === undefined) {
          throw new Error("Expected auto attack job task");
        }

        const fiber = yield* Effect.forkDetach(harness.jobsState.task, {
          startImmediately: true,
        });
        yield* Effect.sleep("20 millis");
        currentTargetId = second.monMapId;
        yield* Effect.sleep("70 millis");
        yield* Fiber.interrupt(fiber);
        return attackCalls;
      }),
    {
      combat,
      gameEvents,
      world: makeWorld(monsters, () => [first.monMapId, second.monMapId]),
    },
  );

  expect(result.slice(0, 2)).toEqual([7, 8]);
});

test("auto attack can replace a dead lock with a previously auto-selected monster", async () => {
  const gameEvents = makeGameEvents();
  const first = new Monster(monsterData({ monMapId: 7 }));
  const second = new Monster(monsterData({ monMapId: 8 }));
  const monsters = new Map([
    [first.monMapId, first],
    [second.monMapId, second],
  ]);
  let currentTargetId: number | undefined;
  const attackCalls: number[] = [];
  const combat = {
    attackMonster: (monMapId: number) =>
      Effect.sync(() => {
        attackCalls.push(monMapId);
        currentTargetId = monMapId;
        return true;
      }),
    canUseSkill: () => Effect.succeed(true),
    useSkill: () => Effect.void,
    cancelAutoAttack: () => Effect.void,
    cancelTarget: () => Effect.void,
    target: {
      get: () =>
        Effect.succeed(
          currentTargetId === undefined
            ? Option.none()
            : Option.some({
                type: "monster" as const,
                monMapId: currentTargetId,
                entity: monsters.get(currentTargetId)!,
              }),
        ),
    },
  } as unknown as CombatShape;

  const result = await withAutoAttack(
    (autoAttack, harness) =>
      Effect.gen(function* () {
        yield* autoAttack.enable({
          library: makeLibrary(true),
          profileRef: "generic",
        });
        if (harness.jobsState.task === undefined) {
          throw new Error("Expected auto attack job task");
        }

        const fiber = yield* Effect.forkDetach(harness.jobsState.task, {
          startImmediately: true,
        });
        yield* Effect.sleep("20 millis");
        currentTargetId = second.monMapId;
        yield* Effect.sleep("70 millis");
        second.data.intHP = 0;
        second.data.intState = EntityState.Dead;
        currentTargetId = undefined;
        yield* gameEvents.emit(
          "monsterDeath",
          monsterDeathEvent(second.monMapId),
        );
        yield* Effect.sleep("70 millis");
        currentTargetId = first.monMapId;
        yield* Effect.sleep("320 millis");
        yield* Fiber.interrupt(fiber);
        return attackCalls;
      }),
    {
      combat,
      gameEvents,
      world: makeWorld(monsters, () => [first.monMapId]),
    },
  );

  const transitions = result.filter(
    (monMapId, index) => index === 0 || monMapId !== result[index - 1],
  );
  expect(transitions.slice(0, 3)).toEqual([7, 8, 7]);
});
