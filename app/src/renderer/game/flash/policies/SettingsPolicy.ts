import { Effect, Layer } from "effect";
import type { FlashSettingsPatch, FlashSettingsSnapshot } from "../Types";
import { EventsApi, type EventsApiShape } from "../api/Events";
import { PlayerApi, type PlayerApiShape } from "../api/Player";
import { SettingsApi, type SettingsApiShape } from "../api/Settings";
import { Jobs, type JobsShape } from "../jobs/Jobs";

const SETTINGS_REAPPLY_JOB_KEY = "settings/apply";
const SETTINGS_REAPPLY_INTERVAL = "1 second";
const SETTINGS_ACTION_JOB_KEY = "settings/actions";
const SETTINGS_ACTION_INTERVAL = "500 millis";

export const hasRecurringSettingActions = (
  state: FlashSettingsSnapshot,
): boolean =>
  state.enemyMagnetEnabled ||
  state.infiniteRangeEnabled ||
  state.provokeCellEnabled ||
  state.skipCutscenesEnabled;

export const getRecurringSettingsPatch = (
  state: FlashSettingsSnapshot,
): FlashSettingsPatch => ({
  ...(state.enemyMagnetEnabled ? { enemyMagnetEnabled: true } : {}),
  ...(state.infiniteRangeEnabled ? { infiniteRangeEnabled: true } : {}),
  ...(state.provokeCellEnabled ? { provokeCellEnabled: true } : {}),
  ...(state.skipCutscenesEnabled ? { skipCutscenesEnabled: true } : {}),
});

export interface SettingsPolicyPorts {
  readonly events: Pick<EventsApiShape, "on">;
  readonly jobs: Pick<JobsShape, "startPeriodicJob" | "stop">;
  readonly player: Pick<PlayerApiShape, "isReady">;
  readonly settings: Pick<SettingsApiShape, "apply" | "get" | "onState">;
}

export const installSettingsPolicy = (ports: SettingsPolicyPorts) =>
  Effect.gen(function* () {
    const runFork = Effect.runForkWith(yield* Effect.context<never>());

    const isLoggedIn = ports.player
      .isReady()
      .pipe(Effect.catchCause(() => Effect.succeed(false)));

    const applyCurrentSettings = ports.settings
      .get()
      .pipe(Effect.flatMap((current) => ports.settings.apply(current)));

    const applyRecurringSettingActions = Effect.gen(function* () {
      const current = yield* ports.settings.get();
      if (!hasRecurringSettingActions(current)) {
        return;
      }

      yield* ports.settings.apply(getRecurringSettingsPatch(current));
    });

    yield* ports.jobs.startPeriodicJob({
      interval: SETTINGS_REAPPLY_INTERVAL,
      key: SETTINGS_REAPPLY_JOB_KEY,
      runOnStart: true,
      shouldRun: isLoggedIn,
      task: applyCurrentSettings,
    });

    const syncSettingsActionJob = (state: FlashSettingsSnapshot) => {
      if (!hasRecurringSettingActions(state)) {
        return ports.jobs.stop(SETTINGS_ACTION_JOB_KEY).pipe(Effect.asVoid);
      }

      return ports.jobs
        .startPeriodicJob({
          interval: SETTINGS_ACTION_INTERVAL,
          key: SETTINGS_ACTION_JOB_KEY,
          replace: false,
          runOnStart: true,
          shouldRun: isLoggedIn,
          task: applyRecurringSettingActions,
        })
        .pipe(Effect.asVoid);
    };

    const disposeConnection = yield* ports.events.on(
      { kind: "runtime", type: "connection" },
      (event) =>
        Effect.gen(function* () {
          if (
            event.type === "connection" &&
            event.payload.status === "OnConnection"
          ) {
            yield* applyCurrentSettings;
          }
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning({
              cause,
              message: "settings reapply on connection failed",
            }),
          ),
        ),
    );
    yield* Effect.addFinalizer(() => Effect.sync(disposeConnection));

    const disposeSettingsActionJob = yield* ports.settings.onState((state) => {
      runFork(
        syncSettingsActionJob(state).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning({
              cause,
              message: "settings action job sync failed",
            }),
          ),
        ),
      );
    });
    yield* Effect.addFinalizer(() => Effect.sync(disposeSettingsActionJob));
  });

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventsApi;
    const jobs = yield* Jobs;
    const player = yield* PlayerApi;
    const settings = yield* SettingsApi;
    yield* installSettingsPolicy({ events, jobs, player, settings });
  }),
);
