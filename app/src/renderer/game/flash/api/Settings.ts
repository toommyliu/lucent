import { Context, Effect, Layer } from "effect";

import type { FlashSettingsPatch, FlashSettingsSnapshot } from "../Types";
import { SwfBridge } from "../SwfBridge";
import { normalizeSettingsPatch, SettingsState } from "../state/Settings";
import type {
  StateDisposer,
  StateSubscriptionOptions,
} from "../StateListeners";

export interface SettingsApiShape {
  readonly apply: (patch: FlashSettingsPatch) => Effect.Effect<void>;
  readonly enemyMagnet: () => Effect.Effect<void>;
  readonly get: () => Effect.Effect<FlashSettingsSnapshot>;
  readonly infiniteRange: () => Effect.Effect<void>;
  readonly isAntiCounterEnabled: () => Effect.Effect<boolean>;
  readonly onState: (
    listener: (state: FlashSettingsSnapshot) => void,
    options?: StateSubscriptionOptions,
  ) => Effect.Effect<StateDisposer>;
  readonly provokeCell: () => Effect.Effect<void>;
  readonly setAnimationsEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setAntiCounterEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setCollisionsEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setCustomGuild: (name: string) => Effect.Effect<void>;
  readonly setCustomName: (name: string) => Effect.Effect<void>;
  readonly setDeathAdsVisible: (visible: boolean) => Effect.Effect<void>;
  readonly setEnemyMagnetEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setFrameRate: (fps: number) => Effect.Effect<void>;
  readonly setInfiniteRangeEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setLagKillerEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setOtherPlayersVisible: (visible: boolean) => Effect.Effect<void>;
  readonly setProvokeCellEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setSkipCutscenesEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setWalkSpeed: (speed: number) => Effect.Effect<void>;
  readonly skipCutscenes: () => Effect.Effect<void>;
}

export class SettingsApi extends Context.Service<
  SettingsApi,
  SettingsApiShape
>()("lucent/game/flash/api/Settings") {}

export const layer = Layer.effect(
  SettingsApi,
  Effect.gen(function* () {
    const bridge = yield* SwfBridge;
    const state = yield* SettingsState;

    const enemyMagnet = () => bridge.call("settings.enemyMagnet");
    const infiniteRange = () => bridge.call("settings.infiniteRange");
    const provokeCell = () => bridge.call("settings.provokeCell");
    const skipCutscenes = () => bridge.call("settings.skipCutscenes");

    const applyPersistentPatch = (patch: FlashSettingsPatch) =>
      Effect.gen(function* () {
        if (patch.animationsEnabled !== undefined) {
          yield* bridge.call("settings.setAnimationsEnabled", [
            patch.animationsEnabled,
          ]);
        }

        if (patch.collisionsEnabled !== undefined) {
          yield* bridge.call("settings.setCollisionsEnabled", [
            patch.collisionsEnabled,
          ]);
        }

        if (patch.customGuild !== undefined && patch.customGuild !== "") {
          yield* bridge.call("settings.setCustomGuild", [patch.customGuild]);
        }

        if (patch.customName !== undefined && patch.customName !== "") {
          yield* bridge.call("settings.setCustomName", [patch.customName]);
        }

        if (patch.deathAdsVisible !== undefined) {
          yield* bridge.call("settings.setDeathAdsVisible", [
            patch.deathAdsVisible,
          ]);
        }

        if (patch.frameRate !== undefined) {
          yield* bridge.call("settings.setFrameRate", [patch.frameRate]);
        }

        if (patch.lagKillerEnabled !== undefined) {
          yield* bridge.call("settings.setLagKillerEnabled", [
            patch.lagKillerEnabled,
          ]);
        }

        if (patch.otherPlayersVisible !== undefined) {
          yield* bridge.call("settings.setOtherPlayersVisible", [
            patch.otherPlayersVisible,
          ]);
        }

        if (patch.walkSpeed !== undefined) {
          yield* bridge.call("settings.setWalkSpeed", [patch.walkSpeed]);
        }
      });

    const applyActionPatch = (patch: FlashSettingsPatch) =>
      Effect.gen(function* () {
        if (patch.enemyMagnetEnabled === true) {
          yield* enemyMagnet();
        }

        if (patch.infiniteRangeEnabled === true) {
          yield* infiniteRange();
        }

        if (patch.provokeCellEnabled === true) {
          yield* provokeCell();
        }

        if (patch.skipCutscenesEnabled === true) {
          yield* skipCutscenes();
        }
      });

    const apply: SettingsApiShape["apply"] = (patch) => {
      const normalized = normalizeSettingsPatch(patch);
      return applyPersistentPatch(normalized).pipe(
        Effect.andThen(applyActionPatch(normalized)),
      );
    };

    const applyAndPatch = (patch: FlashSettingsPatch) => {
      const normalized = normalizeSettingsPatch(patch);
      return applyPersistentPatch(normalized).pipe(
        Effect.andThen(state.patch(normalized)),
        Effect.asVoid,
      );
    };

    return SettingsApi.of({
      apply,
      enemyMagnet,
      get: state.get,
      infiniteRange,
      isAntiCounterEnabled: () =>
        state.get().pipe(Effect.map((settings) => settings.antiCounterEnabled)),
      onState: state.onState,
      provokeCell,
      setAnimationsEnabled: (enabled) =>
        applyAndPatch({ animationsEnabled: enabled }),
      setAntiCounterEnabled: (enabled) =>
        state.patch({ antiCounterEnabled: enabled }).pipe(Effect.asVoid),
      setCollisionsEnabled: (enabled) =>
        applyAndPatch({ collisionsEnabled: enabled }),
      setCustomGuild: (name) => applyAndPatch({ customGuild: name }),
      setCustomName: (name) => applyAndPatch({ customName: name }),
      setDeathAdsVisible: (visible) =>
        applyAndPatch({ deathAdsVisible: visible }),
      setEnemyMagnetEnabled: (enabled) =>
        state.patch({ enemyMagnetEnabled: enabled }).pipe(Effect.asVoid),
      setFrameRate: (fps) => applyAndPatch({ frameRate: fps }),
      setInfiniteRangeEnabled: (enabled) =>
        state.patch({ infiniteRangeEnabled: enabled }).pipe(Effect.asVoid),
      setLagKillerEnabled: (enabled) =>
        applyAndPatch({ lagKillerEnabled: enabled }),
      setOtherPlayersVisible: (visible) =>
        applyAndPatch({ otherPlayersVisible: visible }),
      setProvokeCellEnabled: (enabled) =>
        state.patch({ provokeCellEnabled: enabled }).pipe(Effect.asVoid),
      setSkipCutscenesEnabled: (enabled) =>
        state.patch({ skipCutscenesEnabled: enabled }).pipe(Effect.asVoid),
      setWalkSpeed: (speed) => applyAndPatch({ walkSpeed: speed }),
      skipCutscenes,
    });
  }),
);
