import { Effect, Layer } from "effect";
import type { FlashSettingsPatch, FlashSettingsSnapshot } from "../Types";
import { EventsApi } from "../api/Events";
import { PlayerApi } from "../api/Player";
import { SettingsApi } from "../api/Settings";
import { Jobs } from "../jobs/Jobs";

const SETTINGS_REAPPLY_JOB_KEY = "settings/apply";
const SETTINGS_REAPPLY_INTERVAL = "1 second";
const SETTINGS_ACTION_JOB_KEY = "settings/actions";
const SETTINGS_ACTION_INTERVAL = "500 millis";

const hasRecurringSettingActions = (state: FlashSettingsSnapshot): boolean =>
  state.enemyMagnetEnabled ||
  state.infiniteRangeEnabled ||
  state.provokeCellEnabled ||
  state.skipCutscenesEnabled;

const getRecurringSettingsPatch = (
  state: FlashSettingsSnapshot,
): FlashSettingsPatch => ({
  ...(state.enemyMagnetEnabled ? { enemyMagnetEnabled: true } : {}),
  ...(state.infiniteRangeEnabled ? { infiniteRangeEnabled: true } : {}),
  ...(state.provokeCellEnabled ? { provokeCellEnabled: true } : {}),
  ...(state.skipCutscenesEnabled ? { skipCutscenesEnabled: true } : {}),
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventsApi;
    const jobs = yield* Jobs;
    const player = yield* PlayerApi;
    const settings = yield* SettingsApi;
    const runFork = Effect.runForkWith(yield* Effect.context<never>());

    const isLoggedIn = player
      .isReady()
      .pipe(Effect.catchCause(() => Effect.succeed(false)));

    const applyCurrentSettings = settings
      .get()
      .pipe(Effect.flatMap((current) => settings.apply(current)));

    const applyRecurringSettingActions = Effect.gen(function* () {
      const current = yield* settings.get();
      if (!hasRecurringSettingActions(current)) {
        return;
      }

      yield* settings.apply(getRecurringSettingsPatch(current));
    });

    yield* jobs.startPeriodicJob({
      interval: SETTINGS_REAPPLY_INTERVAL,
      key: SETTINGS_REAPPLY_JOB_KEY,
      runOnStart: true,
      shouldRun: isLoggedIn,
      task: applyCurrentSettings,
    });

    const syncSettingsActionJob = (state: FlashSettingsSnapshot) => {
      if (!hasRecurringSettingActions(state)) {
        return jobs.stop(SETTINGS_ACTION_JOB_KEY).pipe(Effect.asVoid);
      }

      return jobs
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

    const disposeConnection = yield* events.on(
      { type: "connection" },
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

    const disposeSettingsActionJob = yield* settings.onState((state) => {
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
  }),
);
