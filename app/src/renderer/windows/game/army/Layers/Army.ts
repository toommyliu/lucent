import {
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  SynchronizedRef,
} from "effect";
import { equalsIgnoreCase } from "@lucent/shared/string";
import type { Aura } from "@lucent/game";
import {
  Army,
  ArmyError,
  type ArmyEffect,
  type ArmyEquipSet,
  type ArmyRunStepOptions,
  type ArmySession,
  type ArmyShape,
} from "../Services/Army";
import {
  LOOP_TAUNT_ACTION_LOCK_AURA_CATEGORIES,
  LOOP_TAUNT_FOCUS_AURA_NAME,
  LOOP_TAUNT_SCROLL_SKILL,
  matchesLoopTauntFocusAura,
  matchesLoopTauntFocusAuraAdd,
  matchesLoopTauntMessage,
  normalizeLoopTauntOptions,
  resolveTargetMonMapIdToken,
  type ArmyLoopTauntHandle,
  type ArmyLoopTauntTurnContext,
  type LoopTauntCastOutcome,
  type NormalizedLoopTauntOptions,
} from "../LoopTaunt";
import type {
  ArmyLoopTauntCommandPayload,
  ArmyLoopTauntIneligibleReason,
} from "../../../../../shared/army";
import { Auth } from "../../flash/Services/Auth";
import { Combat } from "../../flash/Services/Combat";
import { Drops } from "../../flash/Services/Drops";
import { Inventory } from "../../flash/Services/Inventory";
import { GameEvents } from "../../flash/Services/GameEvents";
import { Packet } from "../../flash/Services/Packet";
import { Player } from "../../flash/Services/Player";
import { TempInventory } from "../../flash/Services/TempInventory";
import { Wait } from "../../flash/Services/Wait";
import { World, type WorldShape } from "../../flash/Services/World";
import {
  CONSUMABLE_SKILL_INDEX,
  waitForConsumableSkillSlot,
} from "../../flash/consumableSkill";
import {
  normalizeItemQuantity,
  resolveItemIdentifier,
} from "../../flash/itemIdentifiers";
import { Jobs } from "../../jobs/Services/Jobs";

interface ArmyState {
  readonly session: ArmySession | null;
  readonly nextStep: number;
  readonly scopedNextSteps: Readonly<Record<string, number>>;
}

const DEFAULT_STATE: ArmyState = {
  session: null,
  nextStep: 0,
  scopedNextSteps: {},
};

const DEFAULT_JOIN_CELL = "Enter";
const DEFAULT_JOIN_PAD = "Spawn";
const WAIT_FOR_MAP_TIMEOUT = "2 minutes";
const WAIT_FOR_GROUP_ANTI_AFK_DELAY = "1500 millis";
const WAIT_FOR_GROUP_ANTI_AFK_INTERVAL = "30 seconds";
const LOOP_TAUNT_RESOLVE_INTERVAL = "250 millis";
const LOOP_TAUNT_TARGET_SELECTION_TIMEOUT = "10 seconds";
const LOOP_TAUNT_ACTION_LOCK_CATEGORY_SET = new Set<string>(
  LOOP_TAUNT_ACTION_LOCK_AURA_CATEGORIES,
);

const getLoopTauntActionLockCategory = (
  auras: readonly Aura[],
): string | undefined => {
  for (const aura of auras) {
    const category = aura.cat?.trim().toLowerCase();
    if (
      category !== undefined &&
      LOOP_TAUNT_ACTION_LOCK_CATEGORY_SET.has(category)
    ) {
      return category;
    }
  }

  return undefined;
};

const readPlayerActionLockCategory = (
  world: WorldShape,
  playerName: string,
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const self = yield* world.players
      .getByName(playerName)
      .pipe(Effect.catchCause(() => Effect.succeed(Option.none())));
    if (Option.isNone(self)) {
      return undefined;
    }

    const auras = yield* world.players.getAuras(self.value.data.entID).pipe(
      Effect.map((auras) => Array.from(auras.values())),
      Effect.catchCause(() => Effect.succeed([] as readonly Aura[])),
    );
    return getLoopTauntActionLockCategory(auras);
  });

const cloneSession = (session: ArmySession): ArmySession => ({
  ...session,
  players: [...session.players],
  raw: { ...session.raw },
});

const cloneState = (state: ArmyState): ArmyState => ({
  session: state.session === null ? null : cloneSession(state.session),
  nextStep: state.nextStep,
  scopedNextSteps: { ...state.scopedNextSteps },
});

const withArmyRoom = (map: string, roomNumber: string): string => {
  const targetMap = map.trim();
  if (targetMap.includes("-") || roomNumber.trim() === "") {
    return targetMap;
  }

  return `${targetMap}-${roomNumber}`;
};

const fromArmyIpc = <A>(label: string, promise: () => Promise<A>) =>
  Effect.tryPromise({
    try: promise,
    catch: (cause) => new ArmyError(label, cause),
  });

const normalizeSyncPlayerKey = (playerName: string): string =>
  playerName.trim().toLowerCase();

// Full-army calls share `nextStep`, so every client reaches the same step
// number. Subset-only calls, such as Loop Taunt setup, are not run by
// non-participants; using the full-army counter there would put participants
// ahead and make the next full-army sync fail. Scoped counters keep each
// explicit player set aligned without advancing everyone else's global step.
const scopedStepKey = (players?: readonly string[]): string => {
  if (players === undefined) {
    return "all";
  }

  return `players:${players
    .map(normalizeSyncPlayerKey)
    .toSorted()
    .join("\u0000")}`;
};

const getNestedConfigValue = (
  obj: Record<string, unknown>,
  path: string,
  defaultValue: unknown,
): unknown => {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    const key = part.trim();
    if (key === "") {
      return defaultValue;
    }

    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !(key in current)
    ) {
      return defaultValue;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
};

const resolveConfigValue = (
  raw: Record<string, unknown>,
  key: string,
  defaultValue: unknown,
): unknown => {
  const normalized = key.trim();
  if (normalized === "") {
    return raw;
  }

  const value = normalized.includes(".")
    ? getNestedConfigValue(raw, normalized, defaultValue)
    : raw[normalized];

  return value === undefined ? defaultValue : value;
};

const assertStarted = (state: ArmyState): ArmyEffect<ArmySession> =>
  state.session === null
    ? Effect.fail(new ArmyError("Army has not been started"))
    : Effect.succeed(cloneSession(state.session));

const loopTauntJobKey = (id: string): string => `army:loop-taunt:${id}`;

const make = Effect.gen(function* () {
  const auth = yield* Auth;
  const combat = yield* Combat;
  const drops = yield* Drops;
  const inventory = yield* Inventory;
  const jobs = yield* Jobs;
  const packetDomain = yield* GameEvents;
  const packet = yield* Packet;
  const player = yield* Player;
  const tempInventory = yield* TempInventory;
  const wait = yield* Wait;
  const world = yield* World;
  const runFork = Effect.runFork;
  const stateRef = yield* SynchronizedRef.make<ArmyState>(DEFAULT_STATE);

  const getState = SynchronizedRef.get(stateRef).pipe(Effect.map(cloneState));

  const getSession: ArmyShape["getSession"] = () =>
    getState.pipe(Effect.map((state) => state.session));

  const stopLoopTauntJobs = () =>
    Effect.gen(function* () {
      const keys = yield* jobs.getRunningKeys();
      yield* Effect.forEach(
        keys.filter((key) => key.startsWith("army:loop-taunt:")),
        (key) => jobs.stop(key),
        { discard: true },
      );
    });

  const start: ArmyShape["start"] = (configName) =>
    Effect.gen(function* () {
      const username = yield* auth.getUsername();
      const session = yield* fromArmyIpc("Failed to start army", () =>
        window.desktop.army.start({ configName, playerName: username }),
      );

      yield* SynchronizedRef.set(stateRef, {
        session,
        nextStep: 0,
        scopedNextSteps: {},
      });

      return cloneSession(session);
    });

  const leave: ArmyShape["leave"] = () =>
    Effect.gen(function* () {
      const state = yield* getState;
      if (state.session === null) {
        return;
      }

      yield* stopLoopTauntJobs();
      const session = state.session;
      yield* fromArmyIpc("Failed to leave army", () =>
        window.desktop.army.leave({
          sessionId: session.sessionId,
          playerName: session.playerName,
        }),
      ).pipe(Effect.catchCause(() => Effect.void));
      yield* SynchronizedRef.set(stateRef, DEFAULT_STATE);
    });

  const isStarted: ArmyShape["isStarted"] = () =>
    getState.pipe(Effect.map((state) => state.session !== null));

  const isLeader: ArmyShape["isLeader"] = () =>
    getState.pipe(Effect.map((state) => state.session?.role === "leader"));

  const isMember: ArmyShape["isMember"] = () =>
    getState.pipe(Effect.map((state) => state.session?.role === "member"));

  const getConfigValue: ArmyShape["getConfigValue"] = (key, defaultValue) =>
    getState.pipe(
      Effect.map((state) =>
        state.session === null
          ? defaultValue
          : resolveConfigValue(state.session.raw, key, defaultValue),
      ),
    );

  const getConfigString: ArmyShape["getConfigString"] = (
    key,
    defaultValue = "",
  ) =>
    getConfigValue(key, defaultValue).pipe(
      Effect.map((value) => (typeof value === "string" ? value : defaultValue)),
    );

  const getPlayerNumber: ArmyShape["getPlayerNumber"] = () =>
    getState.pipe(Effect.map((state) => state.session?.playerNumber ?? -1));

  const nextBarrierStep = (
    options?: ArmyRunStepOptions & {
      readonly players?: readonly string[];
    },
  ) =>
    SynchronizedRef.modify(stateRef, (state) => {
      const key = scopedStepKey(options?.players);
      if (key === "all") {
        return [
          state.nextStep,
          { ...state, nextStep: state.nextStep + 1 },
        ] as const;
      }

      const step = state.scopedNextSteps[key] ?? 0;
      return [
        step,
        {
          ...state,
          scopedNextSteps: {
            ...state.scopedNextSteps,
            [key]: step + 1,
          },
        },
      ] as const;
    });

  const waitAtBarrier = (
    session: ArmySession,
    step: number,
    label: string,
    options?: ArmyRunStepOptions & {
      readonly players?: readonly string[];
    },
  ) =>
    fromArmyIpc("Failed to synchronize army", () =>
      window.desktop.army.barrier({
        sessionId: session.sessionId,
        playerName: session.playerName,
        step,
        label,
        ...(options?.players !== undefined
          ? { players: options.players }
          : null),
        ...(options?.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : null),
      }),
    );

  const waitAtProgressCheckpoint = (
    session: ArmySession,
    step: number,
    label: string,
    complete: boolean,
    options?: ArmyRunStepOptions & {
      readonly players?: readonly string[];
    },
  ) =>
    fromArmyIpc("Failed to synchronize army progress", () =>
      window.desktop.army.progress({
        sessionId: session.sessionId,
        playerName: session.playerName,
        step,
        label,
        complete,
        ...(options?.players !== undefined
          ? { players: options.players }
          : null),
        ...(options?.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : null),
      }),
    );

  const sendAntiAfk = () =>
    Effect.gen(function* () {
      const ready = yield* player
        .isReady()
        .pipe(Effect.catch(() => Effect.succeed(false)));
      if (!ready) {
        return;
      }

      yield* Effect.sleep(WAIT_FOR_GROUP_ANTI_AFK_DELAY);
      yield* packet.sendServer("%xt%zm%afk%1%false%");
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning({
          cause,
          message: "Army anti-AFK packet failed while waiting for group",
        }),
      ),
    );

  const listenForAfkWhileWaitingForGroup = (username: string) =>
    Effect.acquireRelease(
      packetDomain.on("afk", (event) =>
        event.afk && equalsIgnoreCase(event.username, username)
          ? sendAntiAfk()
          : Effect.void,
      ),
      (dispose) => Effect.sync(dispose),
    ).pipe(Effect.asVoid);

  const runAntiAfkFallbackWhileWaitingForGroup = () =>
    Effect.forkScoped(
      Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(WAIT_FOR_GROUP_ANTI_AFK_INTERVAL);
          yield* sendAntiAfk();
        }
      }),
    ).pipe(Effect.asVoid);

  const runStep: ArmyShape["runStep"] = (label, action, options) =>
    Effect.gen(function* () {
      const step = yield* nextBarrierStep(options);
      const session = yield* getState.pipe(Effect.flatMap(assertStarted));
      const result = yield* action;
      yield* waitAtBarrier(session, step, label, options);
      return result;
    });

  const sync: ArmyShape["sync"] = (label = "sync", options) =>
    runStep(label, Effect.void, options).pipe(Effect.asVoid);

  const runUntilArmyProgressComplete = <E>(args: {
    readonly label: string;
    readonly isComplete: () => Effect.Effect<boolean, E>;
    readonly action: () => Effect.Effect<void, E>;
    readonly options?: ArmyRunStepOptions & {
      readonly players?: readonly string[];
    };
  }) =>
    Effect.gen(function* () {
      const step = yield* nextBarrierStep(args.options);
      const session = yield* getState.pipe(Effect.flatMap(assertStarted));

      while (true) {
        const complete = yield* args.isComplete();
        const progress = yield* waitAtProgressCheckpoint(
          session,
          step,
          args.label,
          complete,
          args.options,
        );
        if (progress.complete) {
          return;
        }

        yield* args.action();
        yield* Effect.sleep("100 millis");
      }
    });

  const executeWithArmy: ArmyShape["executeWithArmy"] = (action) =>
    runStep("execute", action);

  const waitForAllInMap: ArmyShape["waitForAllInMap"] = () =>
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* getState.pipe(Effect.flatMap(assertStarted));
        yield* listenForAfkWhileWaitingForGroup(session.playerName);
        yield* runAntiAfkFallbackWhileWaitingForGroup();

        const ready = yield* wait.until(
          Effect.gen(function* () {
            for (const armyPlayer of session.players) {
              const match = yield* world.players.getByName(armyPlayer);
              if (Option.isNone(match)) {
                return false;
              }
            }

            return true;
          }),
          { timeout: WAIT_FOR_MAP_TIMEOUT },
        );

        if (!ready) {
          return yield* Effect.fail(
            new ArmyError(
              `Timed out waiting for army players in map: ${session.players.join(", ")}`,
            ),
          );
        }
      }),
    );

  const joinMap: ArmyShape["joinMap"] = (map, cell, pad) =>
    runStep(
      `join:${map}`,
      Effect.gen(function* () {
        const session = yield* getState.pipe(Effect.flatMap(assertStarted));
        yield* player.joinMap(
          withArmyRoom(map, session.roomNumber),
          cell ?? DEFAULT_JOIN_CELL,
          pad ?? DEFAULT_JOIN_PAD,
        );
        yield* waitForAllInMap();
      }),
    ).pipe(Effect.asVoid);

  const kill: ArmyShape["kill"] = (target, options) =>
    runStep(`kill:${String(target)}`, combat.kill(target, options)).pipe(
      Effect.asVoid,
    );

  const killForItem: ArmyShape["killForItem"] = (
    target,
    item,
    quantity,
    options,
  ) => {
    const label = `kill-item:${String(item)}`;
    const resolvedItem = resolveItemIdentifier(item);
    if (resolvedItem === undefined) {
      return runStep(label, Effect.void).pipe(Effect.asVoid);
    }

    const normalizedQuantity = normalizeItemQuantity(quantity);
    return runUntilArmyProgressComplete({
      label,
      isComplete: () =>
        Effect.gen(function* () {
          const hasDrop = yield* drops.containsDrop(resolvedItem);
          if (hasDrop) {
            yield* drops.acceptDrop(resolvedItem);
          }
          return yield* inventory.contains(resolvedItem, normalizedQuantity);
        }),
      action: () => combat.kill(target, options),
    }).pipe(Effect.asVoid);
  };

  const killForTempItem: ArmyShape["killForTempItem"] = (
    target,
    item,
    quantity,
    options,
  ) => {
    const label = `kill-temp:${String(item)}`;
    const resolvedItem = resolveItemIdentifier(item);
    if (resolvedItem === undefined) {
      return runStep(label, Effect.void).pipe(Effect.asVoid);
    }

    const normalizedQuantity = normalizeItemQuantity(quantity);
    return runUntilArmyProgressComplete({
      label,
      isComplete: () =>
        tempInventory.contains(resolvedItem, normalizedQuantity),
      action: () => combat.kill(target, options),
    }).pipe(Effect.asVoid);
  };

  const resolveItem = (item: string | undefined, resolveItems: boolean) =>
    Effect.gen(function* () {
      if (item === undefined || item.trim() === "") {
        return undefined;
      }

      if (!resolveItems) {
        return item;
      }

      const fromItems = yield* getConfigValue(`items.${item}`);
      if (typeof fromItems === "string" && fromItems.trim() !== "") {
        return fromItems;
      }

      const fromRoot = yield* getConfigValue(item);
      return typeof fromRoot === "string" && fromRoot.trim() !== ""
        ? fromRoot
        : item;
    });

  const equipItem = (item: string | undefined, resolveItems: boolean) =>
    Effect.gen(function* () {
      const resolved = yield* resolveItem(item, resolveItems);
      if (resolved !== undefined) {
        yield* inventory.equip(resolved).pipe(Effect.asVoid);
        yield* Effect.sleep("500 millis");
      }
    });

  const drinkConsumable = (item: string, resolveItems: boolean) =>
    Effect.gen(function* () {
      const resolved = yield* resolveItem(item, resolveItems);
      if (resolved === undefined) {
        return;
      }

      const inventoryItem = yield* inventory.getItem(resolved);
      if (inventoryItem === null) {
        return;
      }

      const equipped = yield* inventory.equip(resolved);
      if (!equipped) {
        return;
      }

      const slotMatches = yield* waitForConsumableSkillSlot(
        { combat, wait },
        inventoryItem,
      );
      if (!slotMatches) {
        return;
      }

      yield* Effect.sleep("500 millis");
      yield* combat.useSkill(CONSUMABLE_SKILL_INDEX, true, true);
      yield* Effect.sleep("1 second");
    });

  const readSet = (setName: string) =>
    Effect.gen(function* () {
      const playerNumber = yield* getPlayerNumber();
      const set =
        (yield* getConfigValue(`sets.${setName}`)) ??
        (yield* getConfigValue(setName));
      if (typeof set !== "object" || set === null || Array.isArray(set)) {
        return undefined;
      }

      const record = set as Record<string, unknown>;
      const playerSet = record[`Player${playerNumber}`] ?? record["Default"];
      if (
        typeof playerSet !== "object" ||
        playerSet === null ||
        Array.isArray(playerSet)
      ) {
        return undefined;
      }

      return playerSet as ArmyEquipSet;
    });

  const equipSet: ArmyShape["equipSet"] = (setName, options) =>
    runStep(
      `equip:${setName}`,
      Effect.gen(function* () {
        const set = yield* readSet(setName);
        if (set === undefined) {
          return;
        }

        const resolveItems = options?.resolveItems ?? false;
        yield* equipItem(set.SafeClass, resolveItems);
        yield* equipItem(set.SafePot, resolveItems);
        yield* equipItem(set.Class, resolveItems);
        yield* equipItem(set.SafePot, resolveItems);
        yield* equipItem(set.Weapon, resolveItems);
        yield* equipItem(set.Cape, resolveItems);
        yield* equipItem(set.Helm, resolveItems);
        yield* equipItem(set.Armor, resolveItems);
        yield* equipItem(set.Pet, resolveItems);

        for (const pot of set.Pots ?? []) {
          yield* drinkConsumable(pot, resolveItems);
        }

        yield* equipItem(set.Scroll, resolveItems);
      }),
    ).pipe(Effect.asVoid);

  const resolveExistingLoopTauntTarget = (
    options: Pick<NormalizedLoopTauntOptions, "target">,
  ) =>
    Effect.gen(function* () {
      const tokenMonMapId = resolveTargetMonMapIdToken(options.target);
      if (tokenMonMapId !== undefined) {
        const monster = yield* world.monsters.get(tokenMonMapId);
        return Option.isSome(monster) ? tokenMonMapId : undefined;
      }

      if (typeof options.target !== "string") {
        return undefined;
      }

      const monster = yield* world.monsters.findByName(options.target);
      return Option.isSome(monster) ? monster.value.monMapId : undefined;
    });

  const waitForLoopTauntTarget = (
    options: Pick<NormalizedLoopTauntOptions, "target">,
  ) =>
    Effect.gen(function* () {
      while (true) {
        const monMapId = yield* resolveExistingLoopTauntTarget(options);
        if (monMapId !== undefined) {
          return monMapId;
        }

        yield* Effect.sleep(LOOP_TAUNT_RESOLVE_INTERVAL);
      }
    });

  const waitForLoopTauntCombatTarget = (monMapId: number) =>
    wait.until(
      combat.target.get().pipe(
        Effect.map(
          (target) =>
            Option.isSome(target) &&
            target.value.type === "monster" &&
            target.value.monMapId === monMapId,
        ),
        Effect.catchCause(() => Effect.succeed(false)),
      ),
      { timeout: LOOP_TAUNT_TARGET_SELECTION_TIMEOUT },
    );

  const ownsLoopTauntParticipation = (
    session: ArmySession,
    options: Pick<NormalizedLoopTauntOptions, "participants">,
  ): boolean =>
    options.participants.some(
      (participant) => participant.number === session.playerNumber,
    );

  const prepareLoopTauntTarget = (
    session: ArmySession,
    options: Pick<NormalizedLoopTauntOptions, "id" | "participants" | "target">,
  ) =>
    Effect.gen(function* () {
      yield* Effect.logInfo({
        message: "Loop Taunt waiting for target",
        id: options.id,
        target: options.target,
      });
      const monMapId = yield* waitForLoopTauntTarget(options);
      yield* Effect.logInfo({
        message: "Loop Taunt target resolved",
        id: options.id,
        target: options.target,
        monMapId,
      });
      if (ownsLoopTauntParticipation(session, options)) {
        yield* Effect.logInfo({
          message: "Loop Taunt targeting monster",
          id: options.id,
          playerNumber: session.playerNumber,
          monMapId,
        });
        yield* combat.attackMonster(monMapId);
        const targeted = yield* waitForLoopTauntCombatTarget(monMapId);
        if (!targeted) {
          return yield* Effect.fail(
            new ArmyError(
              `Timed out waiting for loop taunt target selection: ${monMapId}`,
            ),
          );
        }
      }

      return monMapId;
    });

  const runCoordinatedLoopTaunt = (
    session: ArmySession,
    options: NormalizedLoopTauntOptions,
    targetMonMapId: number,
    armedStep: number,
    armed: Deferred.Deferred<void, ArmyError>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        let armedComplete = false;
        let tauntInFlight = false;
        let activeTurn:
          | Pick<
              Extract<ArmyLoopTauntCommandPayload, { type: "turn" }>,
              "attempt" | "epoch"
            >
          | undefined;
        const pendingTauntFibers = new Set<ReturnType<typeof runFork>>();

        const log = (message: string, details?: Record<string, unknown>) =>
          Effect.logInfo({
            message,
            id: options.id,
            playerNumber: session.playerNumber,
            ...details,
          });

        const publishObservation = (
          payload: Omit<
            Parameters<
              typeof window.desktop.army.publishLoopTauntObservation
            >[0],
            "id" | "playerName" | "sessionId" | "targetMonMapId"
          >,
        ) =>
          fromArmyIpc("Failed to publish loop taunt observation", () =>
            window.desktop.army.publishLoopTauntObservation({
              id: options.id,
              playerName: session.playerName,
              sessionId: session.sessionId,
              targetMonMapId,
              ...payload,
            }),
          ).pipe(Effect.asVoid);

        const publishFocusActive = (auraName: string, auraIcon?: string) =>
          publishObservation({
            ...(activeTurn === undefined ? null : activeTurn),
            ...(auraIcon === undefined ? null : { auraIcon }),
            auraName,
            type: "focus-active",
          }).pipe(Effect.ignore);

        const publishTrigger = (
          triggerReason: "focus-missing" | "focus-removed" | "message-matched",
          details?: {
            readonly auraName?: string;
            readonly message?: string;
          },
        ) =>
          publishObservation({
            ...details,
            triggerReason,
            type: "trigger",
          }).pipe(Effect.ignore);

        const publishIneligible = (
          command: Extract<ArmyLoopTauntCommandPayload, { type: "turn" }>,
          reason: ArmyLoopTauntIneligibleReason,
        ) =>
          publishObservation({
            attempt: command.attempt,
            eligible: false,
            epoch: command.epoch,
            reason,
            type: "turn-result",
          });

        const taunt = (monMapId: number): Effect.Effect<LoopTauntCastOutcome> =>
          Effect.gen(function* () {
            if (tauntInFlight) {
              yield* log("Loop Taunt cast skipped", {
                monMapId,
                reason: "cast already in flight",
              });
              return { reason: "in-flight", type: "skipped" } as const;
            }

            tauntInFlight = true;
            try {
              const ready = yield* player
                .isReady()
                .pipe(Effect.catchCause(() => Effect.succeed(false)));
              const alive = yield* player
                .isAlive()
                .pipe(Effect.catchCause(() => Effect.succeed(false)));
              if (!ready || !alive) {
                const reason = ready ? "not-alive" : "not-ready";
                yield* log("Loop Taunt cast skipped", {
                  alive,
                  monMapId,
                  ready,
                  reason,
                });
                return { reason, type: "skipped" } as const;
              }

              const actionLockCategory = yield* readPlayerActionLockCategory(
                world,
                session.playerName,
              );
              if (actionLockCategory !== undefined) {
                yield* log("Loop Taunt cast skipped", {
                  actionLockCategory,
                  monMapId,
                  reason: "player action locked",
                });
                return { reason: "not-usable", type: "skipped" } as const;
              }

              yield* log("Loop Taunt casting", {
                monMapId,
                skill: LOOP_TAUNT_SCROLL_SKILL,
              });
              yield* combat.attackMonster(monMapId);
              yield* combat.useSkill(LOOP_TAUNT_SCROLL_SKILL, true, true);
              return { type: "cast" } as const;
            } finally {
              tauntInFlight = false;
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                yield* Effect.logError({
                  cause,
                  id: options.id,
                  message: "loop taunt failed",
                });
                return { reason: "failed", type: "skipped" } as const;
              }),
            ),
          );

        const forkTrackedTaunt = (effect: Effect.Effect<void, unknown>) =>
          Effect.sync(() => {
            let fiber: ReturnType<typeof runFork> | undefined;
            fiber = runFork(
              effect.pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    if (fiber !== undefined) {
                      pendingTauntFibers.delete(fiber);
                    }
                  }),
                ),
              ),
            );
            pendingTauntFibers.add(fiber);
          });

        const localPlayer = {
          name: session.playerName,
          number: session.playerNumber,
        };

        const readonlyWorld: ArmyLoopTauntTurnContext["world"] = {
          monsters: {
            get: world.monsters.get,
            getAura: world.monsters.getAura,
          },
          players: {
            getAll: world.players.getAll,
            getAura: world.players.getAura,
            getAuras: world.players.getAuras,
            getByName: world.players.getByName,
          },
        };

        const evaluateShouldTaunt = (
          command: Extract<ArmyLoopTauntCommandPayload, { type: "turn" }>,
        ): Effect.Effect<boolean> =>
          Effect.gen(function* () {
            if (options.shouldTaunt === undefined) {
              return true;
            }

            const result = options.shouldTaunt({
              id: options.id,
              localPlayer,
              participants: options.participants,
              target: {
                monMapId: command.targetMonMapId,
                token: options.target,
              },
              trigger: options.trigger,
              turn: {
                attempt: command.attempt,
                epoch: command.epoch,
              },
              world: readonlyWorld,
            });
            return yield* Effect.isEffect(result)
              ? (result as Effect.Effect<boolean, unknown>)
              : Effect.succeed(result === true);
          }).pipe(
            Effect.map((result) => result === true),
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                yield* Effect.logError({
                  cause,
                  id: options.id,
                  message: "Loop Taunt shouldTaunt failed",
                });
                return false;
              }),
            ),
          );

        const reportTurn = (
          command: Extract<ArmyLoopTauntCommandPayload, { type: "turn" }>,
        ) =>
          Effect.gen(function* () {
            const ready = yield* player
              .isReady()
              .pipe(Effect.catchCause(() => Effect.succeed(false)));
            if (!ready) {
              yield* publishIneligible(command, "not-ready");
              return;
            }

            const alive = yield* player
              .isAlive()
              .pipe(Effect.catchCause(() => Effect.succeed(false)));
            if (!alive) {
              yield* publishIneligible(command, "not-alive");
              return;
            }

            const actionLockCategory = yield* readPlayerActionLockCategory(
              world,
              session.playerName,
            );
            if (actionLockCategory !== undefined) {
              yield* publishIneligible(command, "not-usable");
              return;
            }

            const shouldTaunt = yield* evaluateShouldTaunt(command);
            if (!shouldTaunt) {
              yield* publishIneligible(command, "should-taunt-false");
              return;
            }

            const outcome = yield* taunt(command.targetMonMapId);
            yield* publishObservation({
              attempt: command.attempt,
              eligible: true,
              epoch: command.epoch,
              outcome: outcome.type === "cast" ? "cast" : "skipped",
              ...(outcome.type === "skipped"
                ? { reason: outcome.reason }
                : null),
              type: "turn-result",
            });
          });

        const onCommand = window.desktop.army.onLoopTauntCommand((command) => {
          if (
            command.sessionId !== session.sessionId ||
            command.id !== options.id
          ) {
            return;
          }

          if (command.type === "stop") {
            runFork(jobs.stop(loopTauntJobKey(options.id)).pipe(Effect.asVoid));
            return;
          }

          if (
            command.targetMonMapId !== targetMonMapId ||
            command.selected.number !== session.playerNumber
          ) {
            return;
          }

          activeTurn = {
            attempt: command.attempt,
            epoch: command.epoch,
          };

          void Effect.runPromise(forkTrackedTaunt(reportTurn(command))).catch(
            () => undefined,
          );
        });

        const onAuraAdded = yield* packetDomain.on("auraAdded", (event) =>
          Effect.gen(function* () {
            if (
              !armedComplete ||
              event.targetType !== "monster" ||
              event.targetId !== targetMonMapId ||
              !matchesLoopTauntFocusAuraAdd(event.auraName, event.aura)
            ) {
              return;
            }

            yield* publishFocusActive(event.auraName, event.aura?.icon);
            yield* log("Loop Taunt Focus active", {
              aura: event.auraName,
              monMapId: targetMonMapId,
            });
          }),
        );

        const onAuraRemoved = yield* packetDomain.on("auraRemoved", (event) =>
          Effect.gen(function* () {
            if (
              !armedComplete ||
              options.trigger.type !== "focus" ||
              event.targetType !== "monster" ||
              event.targetId !== targetMonMapId ||
              !matchesLoopTauntFocusAura(event.auraName)
            ) {
              return;
            }

            const remainingAura = yield* world.monsters
              .getAura(targetMonMapId, LOOP_TAUNT_FOCUS_AURA_NAME)
              .pipe(Effect.catchCause(() => Effect.succeed(Option.none())));
            if (Option.isSome(remainingAura)) {
              yield* log("Loop Taunt Focus removal ignored", {
                monMapId: targetMonMapId,
                reason: "aura still active",
                stack: remainingAura.value.stack,
              });
              return;
            }

            yield* publishTrigger("focus-removed", {
              auraName: event.auraName,
            });
            yield* log("Loop Taunt Focus removed", {
              monMapId: targetMonMapId,
            });
          }),
        );

        const onUpdateMessage = yield* packetDomain.on(
          "updateMessage",
          (event) =>
            Effect.gen(function* () {
              if (
                !armedComplete ||
                options.trigger.type !== "message" ||
                event.source !== "animation" ||
                !matchesLoopTauntMessage(options.trigger.message, event.message)
              ) {
                return;
              }

              const eventMonMapId =
                event.sourceMonMapId ?? event.targetMonMapId ?? event.monMapId;
              if (eventMonMapId !== targetMonMapId) {
                return;
              }

              yield* publishTrigger("message-matched", {
                message: event.message,
              });
              yield* log("Loop Taunt message matched", {
                updateMessage: event.message,
                configuredMessage: options.trigger.message,
                monMapId: targetMonMapId,
              });
            }),
        );

        const onServerCastConfirmed = yield* packetDomain.on(
          "loopTauntServerCastConfirmed",
          (event) =>
            Effect.gen(function* () {
              if (
                !armedComplete ||
                event.monMapId !== targetMonMapId ||
                !matchesLoopTauntFocusAuraAdd(event.auraName, {
                  icon: event.auraIcon,
                })
              ) {
                return;
              }

              yield* publishFocusActive(event.auraName, event.auraIcon);
            }),
        );

        const onMonsterDeath = yield* packetDomain.on("monsterDeath", (event) =>
          Effect.gen(function* () {
            if (event.monMapId !== targetMonMapId) {
              return;
            }

            yield* publishObservation({ type: "target-dead" }).pipe(
              Effect.ignore,
            );
            yield* log("Loop Taunt stopped on monster death", {
              monMapId: targetMonMapId,
            });
            yield* jobs.stop(loopTauntJobKey(options.id));
          }),
        );

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* Effect.sync(() => {
              onCommand();
              onAuraAdded();
              onAuraRemoved();
              onUpdateMessage();
              onServerCastConfirmed();
              onMonsterDeath();
            });
            yield* Effect.forEach(
              Array.from(pendingTauntFibers),
              (fiber) => Fiber.interrupt(fiber),
              { discard: true },
            );
            pendingTauntFibers.clear();
            yield* fromArmyIpc("Failed to stop coordinated loop taunt", () =>
              window.desktop.army.stopLoopTaunt({
                id: options.id,
                playerName: session.playerName,
                sessionId: session.sessionId,
              }),
            ).pipe(Effect.ignore);
          }),
        );

        yield* waitAtBarrier(
          session,
          armedStep,
          `loop-taunt-armed:${options.id}`,
          {
            players: options.participants.map(
              (participant) => participant.name,
            ),
          },
        );

        yield* fromArmyIpc("Failed to start coordinated loop taunt", () =>
          window.desktop.army.startLoopTaunt({
            id: options.id,
            participants: options.participants,
            playerName: session.playerName,
            sessionId: session.sessionId,
            targetMonMapId,
            trigger:
              options.trigger.type === "message"
                ? {
                    message: options.trigger.message,
                    type: "message",
                  }
                : { type: "focus" },
          }),
        );

        armedComplete = true;
        yield* log("Loop Taunt armed", {
          monMapId: targetMonMapId,
          participants: options.participants.map((participant) => ({
            name: participant.name,
            number: participant.number,
          })),
          target: options.target,
          trigger: options.trigger.type,
        });
        yield* Deferred.succeed(armed, undefined).pipe(Effect.asVoid);

        if (options.trigger.type === "focus") {
          const aura = yield* world.monsters.getAura(
            targetMonMapId,
            LOOP_TAUNT_FOCUS_AURA_NAME,
          );
          if (
            Option.isNone(aura) ||
            !matchesLoopTauntFocusAuraAdd(aura.value.name, aura.value)
          ) {
            yield* publishTrigger("focus-missing", {
              auraName: LOOP_TAUNT_FOCUS_AURA_NAME,
            });
            yield* log("Loop Taunt initial Focus absent", {
              monMapId: targetMonMapId,
            });
          } else {
            yield* publishFocusActive(aura.value.name, aura.value.icon);
            yield* log("Loop Taunt waiting for Focus removal", {
              monMapId: targetMonMapId,
            });
          }
        }

        return yield* Effect.never;
      }),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          yield* Deferred.fail(
            armed,
            new ArmyError("Loop Taunt failed to arm", cause),
          );
          return yield* Effect.failCause(cause);
        }),
      ),
    );

  const stopLoopTaunt: ArmyShape["stopLoopTaunt"] = (id) =>
    Effect.gen(function* () {
      yield* Effect.logInfo({
        message: "Loop Taunt stopping",
        id,
      });
      const stopped = yield* jobs.stop(loopTauntJobKey(id));
      yield* Effect.logInfo({
        message: stopped ? "Loop Taunt stopped" : "Loop Taunt was not running",
        id,
      });
      return stopped;
    });

  const stopAllLoopTaunts: ArmyShape["stopAllLoopTaunts"] = () =>
    stopLoopTauntJobs();

  const startLoopTaunt: ArmyShape["startLoopTaunt"] = (options) =>
    Effect.gen(function* () {
      const session = yield* getState.pipe(Effect.flatMap(assertStarted));
      const normalized = yield* Effect.try({
        try: () => normalizeLoopTauntOptions(options, session.players),
        catch: (cause) => new ArmyError("Invalid Loop Taunt options", cause),
      });
      const key = loopTauntJobKey(normalized.id);
      const participantNames = normalized.participants.map(
        (participant) => participant.name,
      );
      const targetStep = yield* nextBarrierStep({ players: participantNames });
      const armedStep = yield* nextBarrierStep({ players: participantNames });
      const monMapId = yield* prepareLoopTauntTarget(session, normalized);
      yield* Effect.logInfo({
        message: "Loop Taunt waiting for army target sync",
        id: normalized.id,
        monMapId,
      });
      yield* waitAtBarrier(
        session,
        targetStep,
        `loop-taunt-target:${normalized.id}`,
        { players: participantNames },
      );
      yield* Effect.logInfo({
        message: "Loop Taunt target sync complete",
        id: normalized.id,
        monMapId,
      });
      const armed = yield* Deferred.make<void, ArmyError>();

      yield* Effect.logInfo({
        message: "Loop Taunt starting background job",
        id: normalized.id,
        monMapId,
      });
      const loopTauntEffect = runCoordinatedLoopTaunt(
        session,
        normalized,
        monMapId,
        armedStep,
        armed,
      );
      yield* jobs.start(key, loopTauntEffect, {
        replace: true,
      });
      yield* Deferred.await(armed).pipe(
        Effect.onInterrupt(() =>
          stopLoopTaunt(normalized.id).pipe(Effect.asVoid),
        ),
      );

      return {
        id: normalized.id,
        stop: () => stopLoopTaunt(normalized.id),
      } satisfies ArmyLoopTauntHandle;
    });

  return {
    start,
    leave,
    isStarted,
    isLeader,
    isMember,
    getSession,
    getConfigValue,
    getConfigString,
    getPlayerNumber,
    sync,
    runStep,
    executeWithArmy,
    waitForAllInMap,
    joinMap,
    kill,
    killForItem,
    killForTempItem,
    equipSet,
    startLoopTaunt,
    stopLoopTaunt,
    stopAllLoopTaunts,
  } satisfies ArmyShape;
});

export const ArmyLive = Layer.effect(Army, make);
