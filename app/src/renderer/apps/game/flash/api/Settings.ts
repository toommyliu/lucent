import { Effect, Fiber, Schema, Semaphore, Stream } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import type { SettingsPatch as SettingsPatchValue } from "../contract/Settings";
import type { Store } from "../state/Store";
import type { SettingsState } from "../state/Settings";

const normalizePatch = (input: SettingsPatchValue): SettingsPatchValue => ({
  ...input,
  ...(input.frameRate === undefined
    ? {}
    : { frameRate: Math.max(1, Math.min(60, input.frameRate)) }),
  ...(input.walkSpeed === undefined
    ? {}
    : { walkSpeed: Math.max(1, input.walkSpeed) }),
});

const reapplyPatch = (state: SettingsState): SettingsPatchValue => {
  const {
    customGuild,
    customGuildConfigured,
    customName,
    customNameConfigured,
    ...settings
  } = state;

  return {
    ...settings,
    ...(customGuildConfigured ? { customGuild } : {}),
    ...(customNameConfigured ? { customName } : {}),
  };
};

const recurringActionsPatch = (state: SettingsState): SettingsPatchValue => ({
  enemyMagnetEnabled: state.enemyMagnetEnabled,
  infiniteRangeEnabled: state.infiniteRangeEnabled,
  provokeCellEnabled: state.provokeCellEnabled,
  skipCutscenesEnabled: state.skipCutscenesEnabled,
});

export const makeSettings = Effect.fnUntraced(function* (
  bridge: BridgeService,
  store: Store,
) {
  const scope = yield* Effect.scope;
  const updates = yield* Semaphore.make(1);
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const command = (
    method: keyof Window["swf"],
    value?: boolean | number | string,
  ): Effect.Effect<void> =>
    bridge
      .invoke(method, value === undefined ? undefined : [value], Schema.Void)
      .pipe(Effect.asVoid);

  const execute = (patch: SettingsPatchValue) => {
    const effects: Effect.Effect<void>[] = [];
    const enqueue = <K extends keyof SettingsPatchValue>(
      key: K,
      method: keyof Window["swf"],
    ) => {
      const value = patch[key];
      if (value !== undefined) effects.push(command(method, value));
    };
    enqueue("animationsEnabled", "settings.setAnimationsEnabled");
    enqueue("collisionsEnabled", "settings.setCollisionsEnabled");
    enqueue("customGuild", "settings.setCustomGuild");
    enqueue("customName", "settings.setCustomName");
    enqueue("deathAdsVisible", "settings.setDeathAdsVisible");
    enqueue("frameRate", "settings.setFrameRate");
    enqueue("lagKillerEnabled", "settings.setLagKillerEnabled");
    enqueue("otherPlayersVisible", "settings.setOtherPlayersVisible");
    enqueue("walkSpeed", "settings.setWalkSpeed");
    if (patch.enemyMagnetEnabled === true) {
      effects.push(command("settings.enemyMagnet"));
    }
    if (patch.infiniteRangeEnabled === true) {
      effects.push(command("settings.infiniteRange"));
    }
    if (patch.provokeCellEnabled === true) {
      effects.push(command("settings.provokeCell"));
    }
    if (patch.skipCutscenesEnabled === true) {
      effects.push(command("settings.skipCutscenes"));
    }
    return Effect.all(effects, { discard: true });
  };

  const apply = (input: SettingsPatchValue) =>
    updates.withPermits(1)(
      Effect.gen(function* () {
        const patch = normalizePatch(input);
        yield* execute(patch);
        yield* store.settings.patch({
          ...patch,
          ...(patch.customGuild === undefined
            ? {}
            : { customGuildConfigured: true }),
          ...(patch.customName === undefined
            ? {}
            : { customNameConfigured: true }),
        });
      }),
    );

  const action = (
    key:
      | "enemyMagnetEnabled"
      | "infiniteRangeEnabled"
      | "provokeCellEnabled"
      | "skipCutscenesEnabled",
    method: keyof Window["swf"],
  ) =>
    updates.withPermits(1)(
      Effect.gen(function* () {
        yield* command(method);
        const state = yield* store.settings.get;
        yield* store.settings.patch({ [key]: !state[key] });
      }),
    );

  const reapply = () =>
    updates.withPermits(1)(
      store.settings.get.pipe(
        Effect.map(reapplyPatch),
        Effect.flatMap(execute),
      ),
    );

  const reapplyActions = () =>
    updates.withPermits(1)(
      store.settings.get.pipe(
        Effect.map(recurringActionsPatch),
        Effect.flatMap(execute),
      ),
    );

  const set =
    <K extends keyof SettingsPatchValue>(key: K) =>
    (value: SettingsPatchValue[K]) =>
      apply({ [key]: value });

  const changes = store.settings.changes;
  const get = () => store.settings.get;
  const enemyMagnet = () =>
    action("enemyMagnetEnabled", "settings.enemyMagnet");
  const infiniteRange = () =>
    action("infiniteRangeEnabled", "settings.infiniteRange");
  const provokeCell = () =>
    action("provokeCellEnabled", "settings.provokeCell");
  const skipCutscenes = () =>
    action("skipCutscenesEnabled", "settings.skipCutscenes");
  const isAntiCounterEnabled = () =>
    store.settings.get.pipe(Effect.map((state) => state.antiCounterEnabled));
  const onState = (listener: (state: SettingsState) => void) =>
    store.settings.changes.pipe(
      Stream.runForEach((state) => Effect.sync(() => listener(state))),
      Effect.forkIn(scope),
      Effect.map((fiber) => () => {
        runFork(Fiber.interrupt(fiber));
      }),
    );
  const setAnimationsEnabled = set("animationsEnabled");
  const setAntiCounterEnabled = set("antiCounterEnabled");
  const setCollisionsEnabled = set("collisionsEnabled");
  const setCustomGuild = set("customGuild");
  const setCustomName = set("customName");
  const resetCustomGuild = updates.withPermits(1)(
    Effect.gen(function* () {
      yield* command("settings.resetCustomGuild");
      yield* store.settings.patch({
        customGuild: "",
        customGuildConfigured: false,
      });
    }),
  );
  const resetCustomName = updates.withPermits(1)(
    Effect.gen(function* () {
      yield* command("settings.resetCustomName");
      yield* store.settings.patch({
        customName: "",
        customNameConfigured: false,
      });
    }),
  );
  const setDeathAdsVisible = set("deathAdsVisible");
  const setEnemyMagnetEnabled = set("enemyMagnetEnabled");
  const setFrameRate = set("frameRate");
  const setInfiniteRangeEnabled = set("infiniteRangeEnabled");
  const setLagKillerEnabled = set("lagKillerEnabled");
  const setOtherPlayersVisible = set("otherPlayersVisible");
  const setProvokeCellEnabled = set("provokeCellEnabled");
  const setSkipCutscenesEnabled = set("skipCutscenesEnabled");
  const setWalkSpeed = set("walkSpeed");

  return {
    apply,
    changes,
    enemyMagnet,
    get,
    infiniteRange,
    isAntiCounterEnabled,
    onState,
    provokeCell,
    reapply,
    reapplyActions,
    resetCustomGuild,
    resetCustomName,
    setAnimationsEnabled,
    setAntiCounterEnabled,
    setCollisionsEnabled,
    setCustomGuild,
    setCustomName,
    setDeathAdsVisible,
    setEnemyMagnetEnabled,
    setFrameRate,
    setInfiniteRangeEnabled,
    setLagKillerEnabled,
    setOtherPlayersVisible,
    setProvokeCellEnabled,
    setSkipCutscenesEnabled,
    setWalkSpeed,
    skipCutscenes,
  };
});

export type Settings = Effect.Success<ReturnType<typeof makeSettings>>;
