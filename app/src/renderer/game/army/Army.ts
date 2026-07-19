import { Cause, Clock, Context, Effect, Layer, SynchronizedRef } from "effect";

import {
  resolveArmyEquipSet,
  resolveArmyItemAlias,
  type ArmyConfigRaw,
  type ArmyEquipSet,
  type ArmyProgressResult,
  type ArmySessionPayload,
} from "@lucent/core/army";
import type { ItemQuery, MonsterQuery } from "@lucent/game";
import type { DesktopArmyBridge } from "../../../shared/desktopBridge";
import { Api, type ApiService } from "../flash/api/Api";
import type { CombatKillOptions } from "../flash/api/Combat";
import {
  type ArmyLoopTauntAssignment,
  ArmyLoopTauntError,
  type ArmyLoopTauntHandle,
  type ArmyLoopTauntRuntimeAssignment,
  makeArmyLoopTauntRuntime,
} from "./ArmyLoopTaunt";

type ItemSelector = ItemQuery;
type MonsterSelector = MonsterQuery;

export class ArmyError extends Error {
  readonly _tag = "ArmyError";

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ArmyError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: cause,
        writable: true,
      });
    }
  }
}

export interface ArmyRunStepOptions {
  readonly timeoutMs?: number;
}

export interface ArmyEquipSetOptions {
  readonly resolveItems?: boolean;
}

export type ArmySession = ArmySessionPayload;

export interface ArmyApiShape {
  readonly equipSet: (
    setName: string,
    options?: ArmyEquipSetOptions,
  ) => Effect.Effect<void, ArmyError>;
  readonly executeWithArmy: <A, E>(
    action: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ArmyError>;
  readonly getConfigString: (
    key: string,
    defaultValue?: string,
  ) => Effect.Effect<string>;
  readonly getConfigValue: (
    key: string,
    defaultValue?: unknown,
  ) => Effect.Effect<unknown>;
  readonly getPlayerNumber: () => Effect.Effect<number>;
  readonly getSession: () => Effect.Effect<ArmySession | null>;
  readonly isLeader: () => Effect.Effect<boolean>;
  readonly isMember: () => Effect.Effect<boolean>;
  readonly isStarted: () => Effect.Effect<boolean>;
  readonly joinMap: (
    map: string,
    cell?: string,
    pad?: string,
  ) => Effect.Effect<void, ArmyError>;
  readonly kill: (
    target: MonsterSelector,
    options?: CombatKillOptions,
  ) => Effect.Effect<void, ArmyError>;
  readonly killForItem: (
    target: MonsterSelector,
    item: ItemSelector,
    quantity?: number,
    options?: CombatKillOptions,
  ) => Effect.Effect<void, ArmyError>;
  readonly killForTempItem: (
    target: MonsterSelector,
    item: ItemSelector,
    quantity?: number,
    options?: CombatKillOptions,
  ) => Effect.Effect<void, ArmyError>;
  readonly leave: () => Effect.Effect<void>;
  readonly runStep: <A, E>(
    label: string,
    action: Effect.Effect<A, E>,
    options?: ArmyRunStepOptions,
  ) => Effect.Effect<A, E | ArmyError>;
  readonly start: (configName: string) => Effect.Effect<ArmySession, ArmyError>;
  /**
   * Starts the same assignment plan across the full Army roster.
   *
   * @param assignments The ordered assignment list every participant runs.
   */
  readonly startLoopTaunt: (
    assignments: readonly ArmyLoopTauntAssignment[],
  ) => Effect.Effect<ArmyLoopTauntHandle, ArmyLoopTauntError>;
  readonly sync: (
    label?: string,
    options?: ArmyRunStepOptions,
  ) => Effect.Effect<void, ArmyError>;
  readonly waitForAllInMap: () => Effect.Effect<void, ArmyError>;
}

export interface ArmyApiRuntimeShape extends Omit<
  ArmyApiShape,
  "startLoopTaunt"
> {
  readonly startLoopTauntForScript: (
    assignments: readonly ArmyLoopTauntRuntimeAssignment[],
    onFailure: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
  ) => Effect.Effect<ArmyLoopTauntHandle, ArmyLoopTauntError>;
}

export class ArmyApi extends Context.Service<ArmyApi, ArmyApiRuntimeShape>()(
  "lucent/game/army/ArmyApi",
) {}

interface ArmyState {
  readonly nextStep: number;
  readonly session: ArmySession | null;
}

const defaultState: ArmyState = {
  nextStep: 0,
  session: null,
};

const joinRosterTimeoutMs = 30_000;
const joinRosterIntervalMs = 250;
const consumableSkillIndex = 5;

const cloneSession = (session: ArmySession): ArmySession => ({
  ...session,
  items: { ...session.items },
  players: [...session.players],
  raw: { ...session.raw },
  sets: { ...session.sets },
});

const fromDesktop = <A>(label: string, promise: () => Promise<A>) =>
  Effect.tryPromise({
    try: promise,
    catch: (cause) => new ArmyError(label, cause),
  });

const normalizePlayerKey = (name: string): string => name.trim().toLowerCase();

const withArmyRoom = (map: string, room: string): string => {
  const target = map.trim();
  if (target === "" || /-\d+$/.test(target)) {
    return target;
  }
  return `${target}-${room.trim()}`;
};

const causeMessage = (cause: Cause.Cause<unknown>): string => {
  const squashed = Cause.squash(cause);
  return squashed instanceof Error && squashed.message.length > 0
    ? squashed.message
    : Cause.pretty(cause);
};

const resolveSetItem = (
  session: ArmySession,
  item: string | undefined,
  resolveItems: boolean,
): string | undefined =>
  resolveItems ? resolveArmyItemAlias(session, item) : item;

const warnEquip = (
  setName: string,
  field: string,
  item: string,
  cause?: unknown,
) =>
  Effect.logWarning({
    ...(cause === undefined ? {} : { cause }),
    field,
    item,
    message: `Army equipSet skipped ${field}`,
    setName,
  });

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
  raw: ArmyConfigRaw,
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

const armyEquipOrder = [
  "safeClass",
  "safePot",
  "class",
  "safePot",
  "weapon",
  "cape",
  "helm",
  "armor",
  "pet",
] as const satisfies readonly (keyof ArmyEquipSet)[];

const makeArmyApi = (
  api: ApiService,
  bridge: DesktopArmyBridge | undefined = window.desktop.army,
) =>
  Effect.gen(function* () {
    const {
      auth,
      combat,
      drops,
      inventory,
      map,
      player,
      players,
      tempInventory,
      wait,
    } = api;
    const stateRef = yield* SynchronizedRef.make<ArmyState>(defaultState);
    const coordinationRef = yield* SynchronizedRef.make(false);
    const runFork = Effect.runForkWith(yield* Effect.context<never>());

    const getState = SynchronizedRef.get(stateRef);

    const requireArmyBridge = () =>
      bridge === undefined
        ? Effect.fail(new ArmyError("Army bridge is unavailable"))
        : Effect.succeed(bridge);

    const getSession: ArmyApiShape["getSession"] = () =>
      getState.pipe(
        Effect.map((state) =>
          state.session === null ? null : cloneSession(state.session),
        ),
      );
    const loopTaunts = yield* makeArmyLoopTauntRuntime(api, bridge, getSession);

    const assertStarted = Effect.gen(function* () {
      const state = yield* getState;
      if (state.session === null) {
        return yield* Effect.fail(new ArmyError("Army has not been started"));
      }
      return cloneSession(state.session);
    });

    const nextStep = SynchronizedRef.modify(stateRef, (state) => [
      state.nextStep,
      { ...state, nextStep: state.nextStep + 1 },
    ]);

    const withCoordination = <A, E>(
      operation: Effect.Effect<A, E>,
    ): Effect.Effect<A, E | ArmyError> =>
      Effect.gen(function* () {
        const acquired = yield* SynchronizedRef.modify(
          coordinationRef,
          (busy) => [!busy, true] as const,
        );
        if (!acquired) {
          return yield* Effect.fail(
            new ArmyError(
              "Another coordinated army operation is already running",
            ),
          );
        }
        return yield* operation.pipe(
          Effect.ensuring(SynchronizedRef.set(coordinationRef, false)),
        );
      });

    const startLoopTauntForScript: ArmyApiRuntimeShape["startLoopTauntForScript"] =
      (assignments, onFailure) =>
        withCoordination(
          loopTaunts.startLoopTaunt(assignments, onFailure),
        ).pipe(
          Effect.mapError((error) =>
            error instanceof ArmyLoopTauntError
              ? error
              : new ArmyLoopTauntError(
                  "Failed to coordinate Loop Taunt startup",
                  error,
                ),
          ),
        );

    const failSession = (
      session: ArmySession,
      reason: string,
      details?: { readonly label?: string; readonly step?: number },
    ) =>
      Effect.gen(function* () {
        const army = bridge;
        if (army === undefined) {
          yield* SynchronizedRef.set(stateRef, defaultState);
          return;
        }
        yield* fromDesktop("Failed to fail army session", () =>
          army.fail({
            ...(details?.label === undefined ? {} : { label: details.label }),
            ...(details?.step === undefined ? {} : { step: details.step }),
            reason,
            sessionId: session.sessionId,
          }),
        ).pipe(Effect.catchCause(() => Effect.void));
        yield* SynchronizedRef.set(stateRef, defaultState);
      });

    const waitAtSync = (
      session: ArmySession,
      step: number,
      label: string,
      options?: ArmyRunStepOptions,
    ) =>
      Effect.gen(function* () {
        const army = yield* requireArmyBridge();
        yield* fromDesktop("Failed to synchronize army", () =>
          army.sync({
            label,
            sessionId: session.sessionId,
            step,
            ...(options?.timeoutMs === undefined
              ? {}
              : { timeoutMs: options.timeoutMs }),
          }),
        ).pipe(
          Effect.tapError(() => SynchronizedRef.set(stateRef, defaultState)),
        );
      });

    const waitAtProgress = (
      session: ArmySession,
      step: number,
      label: string,
      complete: boolean,
      options?: ArmyRunStepOptions,
    ): Effect.Effect<ArmyProgressResult, ArmyError> =>
      Effect.gen(function* () {
        const army = yield* requireArmyBridge();
        return yield* fromDesktop("Failed to synchronize army progress", () =>
          army.progress({
            complete,
            label,
            sessionId: session.sessionId,
            step,
            ...(options?.timeoutMs === undefined
              ? {}
              : { timeoutMs: options.timeoutMs }),
          }),
        ).pipe(
          Effect.tapError(() => SynchronizedRef.set(stateRef, defaultState)),
        );
      });

    const runStepInternal: ArmyApiShape["runStep"] = (label, action, options) =>
      Effect.gen(function* () {
        const step = yield* nextStep;
        const session = yield* assertStarted;
        const result = yield* action.pipe(
          Effect.catchCause((cause) =>
            failSession(session, causeMessage(cause), { label, step }).pipe(
              Effect.andThen(Effect.failCause(cause)),
            ),
          ),
        );
        yield* waitAtSync(session, step, label, options);
        return result;
      });

    const runStep: ArmyApiShape["runStep"] = (label, action, options) =>
      withCoordination(runStepInternal(label, action, options));

    const sync: ArmyApiShape["sync"] = (label = "sync", options) =>
      withCoordination(
        Effect.gen(function* () {
          const step = yield* nextStep;
          const session = yield* assertStarted;
          yield* waitAtSync(session, step, label, options);
        }),
      );

    const start: ArmyApiShape["start"] = (configName) =>
      withCoordination(
        Effect.gen(function* () {
          const current = yield* getState;
          if (current.session !== null) {
            return yield* Effect.fail(
              new ArmyError(
                "Army has already been started; leave it before starting again",
              ),
            );
          }
          const username = yield* auth.getUsername();
          const army = yield* requireArmyBridge();
          const session = yield* fromDesktop("Failed to start army", () =>
            army.start({ configName, playerName: username }),
          );
          yield* SynchronizedRef.set(stateRef, {
            nextStep: 0,
            session,
          });
          return cloneSession(session);
        }),
      );

    const leave: ArmyApiShape["leave"] = () =>
      Effect.gen(function* () {
        yield* loopTaunts.stopActive("Army session is leaving");
        const state = yield* getState;
        if (state.session === null) {
          return;
        }

        const army = bridge;
        if (army === undefined) {
          yield* SynchronizedRef.set(stateRef, defaultState);
          return;
        }
        yield* fromDesktop("Failed to leave army", () =>
          army.leave({
            sessionId: state.session!.sessionId,
          }),
        ).pipe(Effect.catchCause(() => Effect.void));
        yield* SynchronizedRef.set(stateRef, defaultState);
      });

    const isStarted: ArmyApiShape["isStarted"] = () =>
      getState.pipe(Effect.map((state) => state.session !== null));

    const isLeader: ArmyApiShape["isLeader"] = () =>
      getState.pipe(Effect.map((state) => state.session?.role === "leader"));

    const isMember: ArmyApiShape["isMember"] = () =>
      getState.pipe(Effect.map((state) => state.session?.role === "member"));

    const getPlayerNumber: ArmyApiShape["getPlayerNumber"] = () =>
      getState.pipe(Effect.map((state) => state.session?.playerNumber ?? -1));

    const getConfigValue: ArmyApiShape["getConfigValue"] = (
      key,
      defaultValue,
    ) =>
      getState.pipe(
        Effect.map((state) =>
          state.session === null
            ? defaultValue
            : resolveConfigValue(state.session.raw, key, defaultValue),
        ),
      );

    const getConfigString: ArmyApiShape["getConfigString"] = (
      key,
      defaultValue = "",
    ) =>
      getConfigValue(key, defaultValue).pipe(
        Effect.map((value) =>
          typeof value === "string" ? value : defaultValue,
        ),
      );

    const visibleMissingPlayers = (session: ArmySession) =>
      Effect.gen(function* () {
        const visible = new Set(
          (yield* players.getAll()).map((record) =>
            normalizePlayerKey(record.username),
          ),
        );
        return session.players.filter(
          (armyPlayer) => !visible.has(normalizePlayerKey(armyPlayer)),
        );
      });

    const waitForAllInMapInternal = (session: ArmySession, step: number) =>
      Effect.gen(function* () {
        const deadline = (yield* Clock.currentTimeMillis) + joinRosterTimeoutMs;
        let lastProgress: ArmyProgressResult | undefined;
        let lastMissing: readonly string[] = [];
        while (true) {
          const [mapName, roomNumber, missing] = yield* Effect.all([
            map.getName(),
            map.getRoomNumber(),
            visibleMissingPlayers(session),
          ]);
          const label = `map:${mapName.trim().toLowerCase()}-${roomNumber}`;
          lastMissing = missing;
          lastProgress = yield* waitAtProgress(
            session,
            step,
            label,
            missing.length === 0,
            { timeoutMs: joinRosterTimeoutMs },
          );
          if (lastProgress.complete) {
            return;
          }

          if ((yield* Clock.currentTimeMillis) >= deadline) {
            const reason =
              lastMissing.length > 0
                ? `Timed out waiting for army roster in ${label}; ${
                    session.playerName
                  } cannot see: ${lastMissing.join(", ")}`
                : `Timed out waiting for army roster in ${label}; pending players: ${lastProgress.pendingPlayers.join(
                    ", ",
                  )}`;
            yield* failSession(session, reason, { label, step });
            return yield* Effect.fail(new ArmyError(reason));
          }

          yield* Effect.sleep(`${joinRosterIntervalMs} millis`);
        }
      });

    const waitForAllInMap: ArmyApiShape["waitForAllInMap"] = () =>
      withCoordination(
        Effect.gen(function* () {
          const step = yield* nextStep;
          const session = yield* assertStarted;
          yield* waitForAllInMapInternal(session, step);
        }),
      );

    const joinMap: ArmyApiShape["joinMap"] = (map, cell, pad) =>
      withCoordination(
        Effect.gen(function* () {
          const targetStep = yield* nextStep;
          const joinedStep = yield* nextStep;
          const session = yield* assertStarted;
          const resolvedMap = withArmyRoom(map, session.room);
          const label = `join:${resolvedMap}`;
          yield* waitAtSync(session, targetStep, `join-ready:${resolvedMap}`);

          const joined = yield* player.joinMap(resolvedMap, cell, pad);
          if (!joined) {
            const reason = `Failed to join army map: ${resolvedMap}`;
            yield* failSession(session, reason, { label, step: joinedStep });
            return yield* Effect.fail(new ArmyError(reason));
          }

          yield* waitForAllInMapInternal(session, joinedStep);
        }),
      );

    const kill: ArmyApiShape["kill"] = (target, options) =>
      runStep(
        `kill:${String(target)}`,
        combat.kill(target, options).pipe(Effect.asVoid),
      );

    const runUntilArmyProgressComplete = <E>(args: {
      readonly action: () => Effect.Effect<void, E>;
      readonly isComplete: () => Effect.Effect<boolean, E>;
      readonly label: string;
    }): Effect.Effect<void, E | ArmyError> =>
      withCoordination(
        Effect.gen(function* () {
          const step = yield* nextStep;
          const session = yield* assertStarted;

          while (true) {
            const complete = yield* args.isComplete();
            const progress = yield* waitAtProgress(
              session,
              step,
              args.label,
              complete,
            );
            if (progress.complete) {
              return;
            }

            yield* args.action().pipe(
              Effect.catchCause((cause) =>
                failSession(session, causeMessage(cause), {
                  label: args.label,
                  step,
                }).pipe(Effect.andThen(Effect.failCause(cause))),
              ),
            );
            yield* Effect.sleep("100 millis");
          }
        }),
      );

    const killForItem: ArmyApiShape["killForItem"] = (
      target,
      item,
      quantity,
      options,
    ) =>
      runUntilArmyProgressComplete({
        action: () => combat.kill(target, options).pipe(Effect.asVoid),
        isComplete: () =>
          Effect.gen(function* () {
            if (yield* drops.contains(item)) {
              yield* drops.accept(item);
            }
            return yield* inventory.contains(item, quantity);
          }),
        label: `kill-item:${String(item)}`,
      });

    const killForTempItem: ArmyApiShape["killForTempItem"] = (
      target,
      item,
      quantity,
      options,
    ) =>
      runUntilArmyProgressComplete({
        action: () => combat.kill(target, options).pipe(Effect.asVoid),
        isComplete: () => tempInventory.contains(item, quantity),
        label: `kill-temp:${String(item)}`,
      });

    const equipItem = (
      session: ArmySession,
      setName: string,
      field: string,
      item: string | undefined,
      resolveItems: boolean,
    ) =>
      Effect.gen(function* () {
        const resolved = resolveSetItem(session, item, resolveItems);
        if (resolved === undefined) {
          return;
        }

        const equipped = yield* inventory
          .equip(resolved)
          .pipe(
            Effect.catchCause((cause) =>
              warnEquip(setName, field, resolved, cause).pipe(Effect.as(false)),
            ),
          );
        if (!equipped) {
          yield* warnEquip(setName, field, resolved);
          return;
        }

        yield* Effect.sleep("500 millis");
      });

    const drinkConsumable = (
      session: ArmySession,
      setName: string,
      item: string,
      resolveItems: boolean,
    ) =>
      Effect.gen(function* () {
        const resolved = resolveSetItem(session, item, resolveItems);
        if (resolved === undefined) {
          return;
        }

        const inventoryItem = yield* inventory
          .get(resolved)
          .pipe(
            Effect.catchCause((cause) =>
              warnEquip(setName, "pots", resolved, cause).pipe(Effect.as(null)),
            ),
          );
        if (inventoryItem === null) {
          yield* warnEquip(setName, "pots", resolved);
          return;
        }

        const equipped = yield* inventory
          .equip(resolved)
          .pipe(
            Effect.catchCause((cause) =>
              warnEquip(setName, "pots", resolved, cause).pipe(
                Effect.as(false),
              ),
            ),
          );
        if (!equipped) {
          yield* warnEquip(setName, "pots", resolved);
          return;
        }

        const slotReady = yield* wait.until(
          combat.getConsumableSkillItem().pipe(
            Effect.map((slot) => slot?.itemId === inventoryItem.itemId),
            Effect.catchCause(() => Effect.succeed(false)),
          ),
          { timeout: "2 seconds" },
        );
        if (!slotReady) {
          yield* warnEquip(setName, "pots", resolved);
          return;
        }

        const used = yield* combat
          .useSkill(consumableSkillIndex, { force: true, wait: true })
          .pipe(
            Effect.catchCause((cause) =>
              warnEquip(setName, "pots", resolved, cause).pipe(
                Effect.as(false),
              ),
            ),
          );
        if (!used) {
          yield* warnEquip(setName, "pots", resolved);
          return;
        }

        yield* Effect.sleep("1 second");
      });

    const equipSet: ArmyApiShape["equipSet"] = (setName, options) =>
      runStep(
        `equip:${setName}`,
        Effect.gen(function* () {
          const session = yield* assertStarted;
          const set = resolveArmyEquipSet(session, setName);
          if (set === undefined) {
            return;
          }

          const resolveItems = options?.resolveItems === true;
          for (const field of armyEquipOrder) {
            const item = set[field];
            if (typeof item === "string") {
              yield* equipItem(session, setName, field, item, resolveItems);
            }
          }

          for (const pot of set.pots ?? []) {
            yield* drinkConsumable(session, setName, pot, resolveItems);
          }

          yield* equipItem(
            session,
            setName,
            "scroll",
            set.scroll,
            resolveItems,
          );
        }),
      );

    const executeWithArmy: ArmyApiShape["executeWithArmy"] = (action) =>
      runStep("execute", action);

    const disposeEnded = bridge?.onEnded((payload) => {
      runFork(
        Effect.all(
          [
            SynchronizedRef.update(stateRef, (state) =>
              state.session?.sessionId === payload.sessionId
                ? defaultState
                : state,
            ),
            loopTaunts.notifySessionEnded(payload),
          ],
          { discard: true },
        ),
      );
    });
    if (disposeEnded !== undefined) {
      yield* Effect.addFinalizer(() => Effect.sync(disposeEnded));
    }

    return ArmyApi.of({
      equipSet,
      executeWithArmy,
      getConfigString,
      getConfigValue,
      getPlayerNumber,
      getSession,
      isLeader,
      isMember,
      isStarted,
      joinMap,
      kill,
      killForItem,
      killForTempItem,
      leave,
      runStep,
      start,
      startLoopTauntForScript,
      sync,
      waitForAllInMap,
    });
  });

export const layer = Layer.effect(
  ArmyApi,
  Effect.flatMap(Api, (api) => makeArmyApi(api)),
);

export { ArmyLoopTauntError } from "./ArmyLoopTaunt";
export type {
  ArmyLoopTauntAssignment,
  ArmyLoopTauntHandle,
  ArmyLoopTauntStrategy,
} from "./ArmyLoopTaunt";
