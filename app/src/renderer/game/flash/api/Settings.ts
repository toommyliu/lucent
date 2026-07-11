import { Effect, Fiber, Schema, Stream } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import type { SettingsPatch as SettingsPatchValue } from "../contract/Settings";
import type { Store } from "../state/Store";
import type { SettingsState } from "../state/Settings";

export const makeSettings = Effect.fnUntraced(function* (
  bridge: BridgeService,
  store: Store,
) {
  const scope = yield* Effect.scope;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const command = (
    method: keyof Window["swf"],
    value?: boolean | number | string,
  ): Effect.Effect<void> =>
    bridge
      .invoke(method, value === undefined ? undefined : [value], Schema.Void)
      .pipe(Effect.asVoid);

  const apply = (input: SettingsPatchValue) => {
    const patch: SettingsPatchValue = {
      ...input,
      ...(input.frameRate === undefined
        ? {}
        : { frameRate: Math.max(1, Math.min(60, input.frameRate)) }),
      ...(input.walkSpeed === undefined
        ? {}
        : { walkSpeed: Math.max(1, input.walkSpeed) }),
    };
    const effects: Effect.Effect<void>[] = [];
    const set = <K extends keyof SettingsPatchValue>(
      key: K,
      method: keyof Window["swf"],
    ) => {
      const value = patch[key];
      if (value !== undefined) effects.push(command(method, value));
    };
    set("animationsEnabled", "settings.setAnimationsEnabled");
    set("collisionsEnabled", "settings.setCollisionsEnabled");
    set("customGuild", "settings.setCustomGuild");
    set("customName", "settings.setCustomName");
    set("deathAdsVisible", "settings.setDeathAdsVisible");
    set("frameRate", "settings.setFrameRate");
    set("lagKillerEnabled", "settings.setLagKillerEnabled");
    set("otherPlayersVisible", "settings.setOtherPlayersVisible");
    set("walkSpeed", "settings.setWalkSpeed");
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
    return Effect.all(effects, { discard: true }).pipe(
      Effect.andThen(
        store.settings.patch({
          ...patch,
          ...(patch.customGuild === undefined
            ? {}
            : { customGuildConfigured: true }),
          ...(patch.customName === undefined
            ? {}
            : { customNameConfigured: true }),
        }),
      ),
      Effect.asVoid,
    );
  };

  const action = (
    key:
      | "enemyMagnetEnabled"
      | "infiniteRangeEnabled"
      | "provokeCellEnabled"
      | "skipCutscenesEnabled",
    method: keyof Window["swf"],
  ) =>
    command(method).pipe(
      Effect.andThen(
        store.settings.get.pipe(
          Effect.flatMap((state) =>
            store.settings.patch({ [key]: !state[key] }),
          ),
        ),
      ),
      Effect.asVoid,
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
