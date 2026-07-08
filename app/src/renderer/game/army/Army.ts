import { Cause, Context, Effect, Layer, SynchronizedRef } from "effect";

import {
  resolveArmyEquipSet,
  resolveArmyItemAlias,
  type ArmyConfigRaw,
  type ArmyEquipSet,
  type ArmyProgressResult,
  type ArmySessionPayload,
} from "@lucent/core/army";
import type {
  CombatKillOptions,
  ItemSelector,
  MonsterSelector,
} from "../flash/Types";
import { AuthApi } from "../flash/api/Auth";
import { CombatApi } from "../flash/api/Combat";
import { DropsApi } from "../flash/api/Drops";
import { InventoryApi } from "../flash/api/Inventory";
import { PlayerApi } from "../flash/api/Player";
import { PlayersApi } from "../flash/api/Players";
import { TempInventoryApi } from "../flash/api/TempInventory";
import { WaitApi } from "../flash/api/Wait";

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
  readonly sync: (
    label?: string,
    options?: ArmyRunStepOptions,
  ) => Effect.Effect<void, ArmyError>;
}

export class ArmyApi extends Context.Service<ArmyApi, ArmyApiShape>()(
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

const requireArmyBridge = () =>
  Effect.sync(() => {
    const army = window.desktop.army;
    if (army === undefined) {
      throw new ArmyError("Army bridge is unavailable");
    }
    return army;
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

const equipOrder = [
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

export const layer = Layer.effect(
  ArmyApi,
  Effect.gen(function* () {
    const auth = yield* AuthApi;
    const combat = yield* CombatApi;
    const drops = yield* DropsApi;
    const inventory = yield* InventoryApi;
    const player = yield* PlayerApi;
    const players = yield* PlayersApi;
    const tempInventory = yield* TempInventoryApi;
    const wait = yield* WaitApi;
    const stateRef = yield* SynchronizedRef.make<ArmyState>(defaultState);

    const getState = SynchronizedRef.get(stateRef);

    const getSession: ArmyApiShape["getSession"] = () =>
      getState.pipe(
        Effect.map((state) =>
          state.session === null ? null : cloneSession(state.session),
        ),
      );

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

    const failSession = (
      session: ArmySession,
      reason: string,
      details?: { readonly label?: string; readonly step?: number },
    ) =>
      Effect.gen(function* () {
        const army = yield* requireArmyBridge();
        yield* fromDesktop("Failed to fail army session", () =>
          army.fail({
            ...(details?.label === undefined ? {} : { label: details.label }),
            ...(details?.step === undefined ? {} : { step: details.step }),
            playerName: session.playerName,
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
            playerName: session.playerName,
            sessionId: session.sessionId,
            step,
            ...(options?.timeoutMs === undefined
              ? {}
              : { timeoutMs: options.timeoutMs }),
          }),
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
            playerName: session.playerName,
            sessionId: session.sessionId,
            step,
            ...(options?.timeoutMs === undefined
              ? {}
              : { timeoutMs: options.timeoutMs }),
          }),
        );
      });

    const runStep: ArmyApiShape["runStep"] = (label, action, options) =>
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

    const sync: ArmyApiShape["sync"] = (label = "sync", options) =>
      Effect.gen(function* () {
        const step = yield* nextStep;
        const session = yield* assertStarted;
        yield* waitAtSync(session, step, label, options);
      });

    const start: ArmyApiShape["start"] = (configName) =>
      Effect.gen(function* () {
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
      });

    const leave: ArmyApiShape["leave"] = () =>
      Effect.gen(function* () {
        const state = yield* getState;
        if (state.session === null) {
          return;
        }

        const army = yield* requireArmyBridge();
        yield* fromDesktop("Failed to leave army", () =>
          army.leave({
            playerName: state.session!.playerName,
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

    const waitForRosterVisible = (
      session: ArmySession,
      step: number,
      label: string,
    ) =>
      Effect.gen(function* () {
        const deadline = Date.now() + joinRosterTimeoutMs;
        let lastProgress: ArmyProgressResult | undefined;
        let lastMissing: readonly string[] = [];
        while (true) {
          const missing = yield* visibleMissingPlayers(session);
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

          if (Date.now() >= deadline) {
            const reason =
              lastMissing.length > 0
                ? `Timed out waiting for army roster in ${label}; ${
                    session.playerName
                  } cannot see: ${lastMissing.join(", ")}`
                : `Timed out waiting for army roster in ${label}; pending clients: ${lastProgress.pendingPlayers.join(
                    ", ",
                  )}`;
            yield* failSession(session, reason, { label, step });
            return yield* Effect.fail(new ArmyError(reason));
          }

          yield* Effect.sleep(`${joinRosterIntervalMs} millis`);
        }
      });

    const joinMap: ArmyApiShape["joinMap"] = (map, cell, pad) =>
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

        yield* waitForRosterVisible(session, joinedStep, label);
      });

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
      });

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
          for (const field of equipOrder) {
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
      sync,
    });
  }),
);
