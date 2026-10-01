// TEMPORARY(army-stall-diagnostics): reports this client's view of a stalled
// army operation to the main-process log in builds without the debug flag.
// Remove once the stall has been diagnosed.
import type { ItemQuery } from "@lucent/game";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import type { ArmyProgressResult } from "@lucent/core/army";
import type { DesktopArmyBridge } from "../../../../shared/desktopBridge";
import type { ApiService } from "../flash/api/Api";
import type { BridgeService } from "../flash/bridge/Bridge";

export const ARMY_CLIENT_CHECK_INTERVAL_MS = 5_000;
export const ARMY_CLIENT_STALL_THRESHOLD_MS = 90_000;
export const ARMY_CLIENT_REPORT_REPEAT_MS = 60_000;

export interface ArmyDiagnosticGoal {
  readonly item: ItemQuery;
  readonly quantity?: number;
  readonly source: "inventory" | "temporary";
}

interface OperationState {
  actionRuns: number;
  goal: ArmyDiagnosticGoal | null;
  label: string | null;
  lastActionEndedAtMs: number | null;
  lastLocalComplete: boolean | null;
  lastProgress: ArmyProgressResult | null;
  progressReports: number;
  reportStartedAtMs: number | null;
  readonly startedAtMs: number;
  step: number | null;
  waiting: "progress" | "sync" | null;
}

const FlashTempItems = Schema.Array(
  Schema.Struct({
    ItemID: Schema.optionalKey(Schema.Unknown),
    iQty: Schema.optionalKey(Schema.Unknown),
    sName: Schema.optionalKey(Schema.Unknown),
  }),
);

const describeFailure = (cause: Cause.Cause<unknown>) => ({
  error: Cause.pretty(cause).slice(0, 500),
});

// Each read is isolated so one failing source cannot drop the whole snapshot.
const safely = <A>(read: () => Effect.Effect<A, unknown>) =>
  Effect.suspend(read).pipe(
    Effect.map((value): A | { readonly error: string } => value),
    Effect.catchCause((cause) => Effect.succeed(describeFailure(cause))),
  );

const serializableQuery = (query: ItemQuery) =>
  typeof query === "object" ? { ...query } : query;

export const makeArmyDiagnostics = (args: {
  readonly api: ApiService;
  readonly desktop: DesktopArmyBridge;
  readonly flash: Option.Option<BridgeService>;
  readonly getSessionId: Effect.Effect<string | null>;
}) =>
  Effect.gen(function* () {
    const { auth, combat, map, monsters, player, tempInventory } = args.api;
    let operation: OperationState | null = null;
    let lastOperationEndedAtMs: number | null = null;
    let lastReportedAtMs: number | null = null;

    const now = Clock.currentTimeMillis;
    const update = (apply: (current: OperationState) => void) =>
      Effect.sync(() => {
        if (operation !== null) apply(operation);
      });

    const begin = now.pipe(
      Effect.map((startedAtMs) => {
        operation = {
          actionRuns: 0,
          goal: null,
          label: null,
          lastActionEndedAtMs: null,
          lastLocalComplete: null,
          lastProgress: null,
          progressReports: 0,
          reportStartedAtMs: null,
          startedAtMs,
          step: null,
          waiting: null,
        };
      }),
    );

    const end = now.pipe(
      Effect.map((endedAtMs) => {
        operation = null;
        lastOperationEndedAtMs = endedAtMs;
      }),
    );

    const waitStarted = (
      kind: "progress" | "sync",
      step: number,
      label: string,
      localComplete?: boolean,
    ) =>
      now.pipe(
        Effect.flatMap((atMs) =>
          update((current) => {
            current.label = label;
            current.step = step;
            current.waiting = kind;
            current.reportStartedAtMs = atMs;
            if (localComplete !== undefined) {
              current.lastLocalComplete = localComplete;
              current.progressReports += 1;
            }
          }),
        ),
      );

    const waitFinished = (result?: ArmyProgressResult) =>
      update((current) => {
        current.waiting = null;
        current.reportStartedAtMs = null;
        if (result !== undefined) current.lastProgress = result;
      });

    const setGoal = (goal: ArmyDiagnosticGoal) =>
      update((current) => {
        current.goal = goal;
      });

    const actionFinished = now.pipe(
      Effect.flatMap((atMs) =>
        update((current) => {
          current.actionRuns += 1;
          current.lastActionEndedAtMs = atMs;
        }),
      ),
    );

    const readFlashTempItems = Option.match(args.flash, {
      onNone: () => Effect.succeed(null),
      onSome: (flash) =>
        flash.invoke("tempInventory.getItems", undefined, FlashTempItems).pipe(
          Effect.map(
            Option.match({
              onNone: () => null,
              onSome: (items) =>
                items.map((item) => ({
                  itemId: item.ItemID,
                  name: item.sName,
                  quantity: item.iQty,
                })),
            }),
          ),
        ),
    });

    const snapshot = (
      reason: string,
      nowMs: number,
      current: OperationState | null,
    ) =>
      Effect.gen(function* () {
        const game = yield* Effect.all({
          alive: safely(() => player.isAlive()),
          availableMonsters: safely(() =>
            monsters.getAvailable().pipe(
              Effect.map((available) =>
                available.map((monster) => ({
                  cell: monster.cell,
                  dead: monster.dead,
                  hp: monster.hp,
                  maxHp: monster.maxHp,
                  monsterMapId: monster.monsterMapId,
                  name: monster.name,
                })),
              ),
            ),
          ),
          cell: safely(() => player.getCell()),
          hp: safely(() => player.getHp()),
          loggedIn: safely(() => auth.isLoggedIn()),
          map: safely(() => map.getName()),
          pad: safely(() => player.getPad()),
          room: safely(() => map.getRoomNumber()),
          state: safely(() => player.getState()),
          target: safely(() => combat.target.get()),
        });
        const tempItems = yield* Effect.all({
          flash: safely(() => readFlashTempItems),
          lucent: safely(() =>
            tempInventory.getAll().pipe(
              Effect.map((items) =>
                items.map((item) => ({
                  itemId: item.itemId,
                  name: item.name,
                  quantity: item.quantity,
                })),
              ),
            ),
          ),
        });
        const goal = current?.goal ?? null;
        const goalState =
          goal === null
            ? null
            : {
                item: serializableQuery(goal.item),
                quantity: goal.quantity ?? 1,
                source: goal.source,
                lucentQuantity: yield* safely(() =>
                  Effect.map(
                    goal.source === "temporary"
                      ? tempInventory.get(goal.item)
                      : args.api.inventory.get(goal.item),
                    (item) => item?.quantity ?? 0,
                  ),
                ),
                dropPending: yield* safely(() =>
                  args.api.drops.contains(goal.item),
                ),
              };
        return {
          reason,
          msSinceLastOperation:
            lastOperationEndedAtMs === null
              ? null
              : nowMs - lastOperationEndedAtMs,
          operation:
            current === null
              ? null
              : {
                  actionRuns: current.actionRuns,
                  ageMs: nowMs - current.startedAtMs,
                  label: current.label,
                  lastLocalComplete: current.lastLocalComplete,
                  lastProgress: current.lastProgress,
                  msSinceLastActionEnded:
                    current.lastActionEndedAtMs === null
                      ? null
                      : nowMs - current.lastActionEndedAtMs,
                  progressReports: current.progressReports,
                  step: current.step,
                  waiting: current.waiting,
                  waitingMs:
                    current.reportStartedAtMs === null
                      ? null
                      : nowMs - current.reportStartedAtMs,
                },
          game,
          goal: goalState,
          tempItems,
        };
      });

    const check = Effect.gen(function* () {
      const sessionId = yield* args.getSessionId;
      if (sessionId === null) return;
      const nowMs = yield* now;
      const current = operation;
      const reason =
        current !== null
          ? nowMs - current.startedAtMs >= ARMY_CLIENT_STALL_THRESHOLD_MS
            ? "operation-running"
            : null
          : lastOperationEndedAtMs !== null &&
              nowMs - lastOperationEndedAtMs >= ARMY_CLIENT_STALL_THRESHOLD_MS
            ? "between-operations"
            : null;
      if (
        reason === null ||
        (lastReportedAtMs !== null &&
          nowMs - lastReportedAtMs < ARMY_CLIENT_REPORT_REPEAT_MS)
      ) {
        return;
      }
      lastReportedAtMs = nowMs;
      const data = yield* snapshot(reason, nowMs, current);
      yield* Effect.tryPromise(() =>
        args.desktop.diagnostic({ sessionId, snapshot: data }),
      );
    }).pipe(Effect.catchCause(() => Effect.void));

    yield* check.pipe(
      Effect.repeat(Schedule.spaced(ARMY_CLIENT_CHECK_INTERVAL_MS)),
      Effect.forkScoped,
    );

    return {
      actionFinished,
      begin,
      end,
      setGoal,
      waitFinished,
      waitStarted,
    };
  });

export type ArmyDiagnostics = Effect.Success<
  ReturnType<typeof makeArmyDiagnostics>
>;
