import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import type { BridgeService } from "../bridge/Bridge";
import type {
  RenderingMode,
  SettingsPatch as SettingsPatchValue,
} from "../contract/Settings";
import type { Store } from "../state/Store";
import type { SettingsState } from "../state/Settings";

export const MINIMAL_RENDERING_FRAME_RATE = 2;

type NonMinimalRenderingMode = Exclude<RenderingMode, "minimal">;

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

const effectiveFrameRate = (state: SettingsState): number =>
  state.renderingMode === "minimal"
    ? MINIMAL_RENDERING_FRAME_RATE
    : state.frameRate;

const isNonMinimalRenderingMode = (
  mode: RenderingMode,
): mode is NonMinimalRenderingMode => mode !== "minimal";

export const makeSettings = Effect.fnUntraced(function* (
  bridge: BridgeService,
  store: Store,
) {
  const scope = yield* Effect.scope;
  const updates = yield* Semaphore.make(1);
  const resumeRenderingMode = yield* Ref.make<NonMinimalRenderingMode>("full");
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const command = (
    method: keyof Window["swf"],
    value?: boolean | number | string,
  ): Effect.Effect<void> =>
    bridge
      .invoke(method, value === undefined ? undefined : [value], Schema.Void)
      .pipe(Effect.asVoid);

  const execute = (patch: SettingsPatchValue, state: SettingsState) => {
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
    enqueue("otherPlayersVisible", "settings.setOtherPlayersVisible");
    enqueue("walkSpeed", "settings.setWalkSpeed");
    if (patch.renderingMode !== undefined) {
      effects.push(
        command("settings.setLagKillerEnabled", state.renderingMode !== "full"),
      );
    }
    if (patch.frameRate !== undefined || patch.renderingMode !== undefined) {
      effects.push(command("settings.setFrameRate", effectiveFrameRate(state)));
    }
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

  const applyUnlocked = Effect.fnUntraced(function* (
    input: SettingsPatchValue,
  ) {
    const patch = normalizePatch(input);
    const current = yield* store.settings.get;
    const next: SettingsState = { ...current, ...patch };

    yield* execute(patch, next);
    yield* store.settings.patch({
      ...patch,
      ...(patch.customGuild === undefined
        ? {}
        : { customGuildConfigured: true }),
      ...(patch.customName === undefined ? {} : { customNameConfigured: true }),
    });

    if (patch.renderingMode === "minimal") {
      if (isNonMinimalRenderingMode(current.renderingMode)) {
        yield* Ref.set(resumeRenderingMode, current.renderingMode);
      }
    } else if (patch.renderingMode !== undefined) {
      yield* Ref.set(resumeRenderingMode, patch.renderingMode);
    }
  });

  const apply = (input: SettingsPatchValue) =>
    updates.withPermits(1)(applyUnlocked(input));

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
      Effect.gen(function* () {
        const state = yield* store.settings.get;
        yield* execute(reapplyPatch(state), state);
      }),
    );

  const reapplyActions = () =>
    updates.withPermits(1)(
      Effect.gen(function* () {
        const state = yield* store.settings.get;
        yield* execute(recurringActionsPatch(state), state);
      }),
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
  const getRenderingMode = () =>
    store.settings.get.pipe(Effect.map((state) => state.renderingMode));
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
  const setOtherPlayersVisible = set("otherPlayersVisible");
  const setProvokeCellEnabled = set("provokeCellEnabled");
  const setRenderingMode = set("renderingMode");
  const setSkipCutscenesEnabled = set("skipCutscenesEnabled");
  const setWalkSpeed = set("walkSpeed");
  const restoreRenderingMode = () =>
    updates.withPermits(1)(
      Effect.gen(function* () {
        const mode = yield* Ref.get(resumeRenderingMode);
        yield* applyUnlocked({ renderingMode: mode });
      }),
    );

  return {
    apply,
    changes,
    enemyMagnet,
    get,
    getRenderingMode,
    infiniteRange,
    isAntiCounterEnabled,
    onState,
    provokeCell,
    reapply,
    reapplyActions,
    restoreRenderingMode,
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
    setOtherPlayersVisible,
    setProvokeCellEnabled,
    setRenderingMode,
    setSkipCutscenesEnabled,
    setWalkSpeed,
    skipCutscenes,
  };
});

export type Settings = Effect.Success<ReturnType<typeof makeSettings>>;
