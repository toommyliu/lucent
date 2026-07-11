import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { FlashEvent, FlashSettingsSnapshot } from "../Types";
import type { EventsApiShape } from "../api/Events";
import type { PeriodicJobDefinition } from "../jobs/Jobs";
import { matchesEventSelector } from "../protocol/PacketSelectors";
import {
  getRecurringSettingsPatch,
  hasRecurringSettingActions,
  installSettingsPolicy,
  type SettingsPolicyPorts,
} from "./SettingsPolicy";

const defaultSettings = (): FlashSettingsSnapshot => ({
  animationsEnabled: true,
  antiCounterEnabled: true,
  collisionsEnabled: true,
  customGuild: "",
  customName: "",
  deathAdsVisible: true,
  enemyMagnetEnabled: false,
  frameRate: 24,
  infiniteRangeEnabled: false,
  lagKillerEnabled: false,
  otherPlayersVisible: true,
  provokeCellEnabled: false,
  skipCutscenesEnabled: false,
  walkSpeed: 8,
});

const connectionEvent = (status: string): FlashEvent => ({
  kind: "runtime",
  payload: { status },
  type: "connection",
});

const makeHarness = (initial: Partial<FlashSettingsSnapshot> = {}) => {
  let ready = false;
  let state = { ...defaultSettings(), ...initial };
  const applied: Array<Partial<FlashSettingsSnapshot>> = [];
  const periodicJobs: PeriodicJobDefinition[] = [];
  const stoppedJobs: string[] = [];
  const eventHandlers: Array<{
    readonly handler: (event: FlashEvent) => Effect.Effect<void>;
    readonly selector: Parameters<EventsApiShape["on"]>[0];
  }> = [];
  const stateHandlers: Array<(next: FlashSettingsSnapshot) => void> = [];

  const events: SettingsPolicyPorts["events"] = {
    on: (selector, handler) =>
      Effect.sync(() => {
        const entry = { handler, selector };
        eventHandlers.push(entry);
        return () => {
          const index = eventHandlers.indexOf(entry);
          if (index >= 0) eventHandlers.splice(index, 1);
        };
      }),
  };
  const jobs: SettingsPolicyPorts["jobs"] = {
    startPeriodicJob: (definition) =>
      Effect.sync(() => {
        periodicJobs.push(definition);
        return true;
      }),
    stop: (key) =>
      Effect.sync(() => {
        stoppedJobs.push(key);
        return true;
      }),
  };
  const player: SettingsPolicyPorts["player"] = {
    isReady: () => Effect.sync(() => ready),
  };
  const settings: SettingsPolicyPorts["settings"] = {
    apply: (patch) =>
      Effect.sync(() => {
        applied.push(patch);
      }),
    get: () => Effect.sync(() => state),
    onState: (listener) =>
      Effect.sync(() => {
        stateHandlers.push(listener);
        listener(state);
        return () => {
          const index = stateHandlers.indexOf(listener);
          if (index >= 0) stateHandlers.splice(index, 1);
        };
      }),
  };

  return {
    applied,
    emit: (event: FlashEvent) =>
      Effect.forEach(
        eventHandlers,
        ({ handler, selector }) =>
          matchesEventSelector(event, selector) ? handler(event) : Effect.void,
        { discard: true },
      ),
    emitSettings: (patch: Partial<FlashSettingsSnapshot>) => {
      state = { ...state, ...patch };
      for (const handler of stateHandlers) handler(state);
    },
    periodicJobs,
    policy: installSettingsPolicy({ events, jobs, player, settings }),
    setReady: (value: boolean) => {
      ready = value;
    },
    stoppedJobs,
  };
};

describe("SettingsPolicy", () => {
  it.effect(
    "registers the readiness-gated reapply job and handles connection",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* harness.policy;
            expect(harness.periodicJobs).toHaveLength(1);
            const reapply = harness.periodicJobs[0]!;
            expect(reapply).toMatchObject({
              interval: "1 second",
              key: "settings/apply",
              runOnStart: true,
            });
            expect(yield* reapply.shouldRun!).toBe(false);
            harness.setReady(true);
            expect(yield* reapply.shouldRun!).toBe(true);

            yield* reapply.task;
            expect(harness.applied).toHaveLength(1);
            yield* harness.emit(connectionEvent("OnConnection"));
            expect(harness.applied).toHaveLength(2);
            yield* harness.emit(connectionEvent("OnConnectionLost"));
            expect(harness.applied).toHaveLength(2);
          }),
        );
      }),
  );

  it.effect(
    "starts and stops one recurring-action job with a narrow patch",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness({
          enemyMagnetEnabled: true,
          infiniteRangeEnabled: true,
          provokeCellEnabled: true,
          skipCutscenesEnabled: true,
        });
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* harness.policy;
            const recurring = {
              ...defaultSettings(),
              enemyMagnetEnabled: true,
              infiniteRangeEnabled: true,
              provokeCellEnabled: true,
              skipCutscenesEnabled: true,
            };
            expect(hasRecurringSettingActions(recurring)).toBe(true);
            expect(getRecurringSettingsPatch(recurring)).toEqual({
              enemyMagnetEnabled: true,
              infiniteRangeEnabled: true,
              provokeCellEnabled: true,
              skipCutscenesEnabled: true,
            });
            yield* Effect.yieldNow;
            expect(harness.periodicJobs).toHaveLength(2);
            const actions = harness.periodicJobs[1]!;
            expect(actions).toMatchObject({
              interval: "500 millis",
              key: "settings/actions",
              replace: false,
              runOnStart: true,
            });
            yield* actions.task;
            expect(harness.applied.at(-1)).toEqual({
              enemyMagnetEnabled: true,
              infiniteRangeEnabled: true,
              provokeCellEnabled: true,
              skipCutscenesEnabled: true,
            });

            harness.emitSettings({
              enemyMagnetEnabled: false,
              infiniteRangeEnabled: false,
              provokeCellEnabled: false,
              skipCutscenesEnabled: false,
            });
            yield* Effect.yieldNow;
            expect(harness.stoppedJobs).toContain("settings/actions");
          }),
        );
      }),
  );
});
