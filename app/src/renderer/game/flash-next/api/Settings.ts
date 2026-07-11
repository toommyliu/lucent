import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import {
  SettingsPatch,
  type SettingsPatch as SettingsPatchValue,
} from "../contract/Settings";
import type { Store } from "../state/Store";

const decodePatch = Schema.decodeUnknownOption(SettingsPatch);

export const makeSettings = (bridge: BridgeService, store: Store) => {
  const command = (
    method: keyof Window["swf"],
    value?: unknown,
  ): Effect.Effect<void> =>
    bridge
      .invoke(method, value === undefined ? undefined : [value], Schema.Void)
      .pipe(Effect.asVoid);

  const apply = (input: unknown) => {
    const decoded = decodePatch(input);
    if (Option.isNone(decoded)) return Effect.void;
    const patch: SettingsPatchValue = {
      ...decoded.value,
      ...(decoded.value.frameRate === undefined
        ? {}
        : { frameRate: Math.max(1, Math.min(60, decoded.value.frameRate)) }),
      ...(decoded.value.walkSpeed === undefined
        ? {}
        : { walkSpeed: Math.max(1, decoded.value.walkSpeed) }),
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
    return Effect.all(effects, { discard: true }).pipe(
      Effect.andThen(store.settings.patch(patch)),
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

  return {
    apply,
    changes: store.settings.changes,
    enemyMagnet: () => action("enemyMagnetEnabled", "settings.enemyMagnet"),
    get: () => store.settings.get,
    infiniteRange: () =>
      action("infiniteRangeEnabled", "settings.infiniteRange"),
    isAntiCounterEnabled: () =>
      store.settings.get.pipe(Effect.map((state) => state.antiCounterEnabled)),
    provokeCell: () => action("provokeCellEnabled", "settings.provokeCell"),
    setAnimationsEnabled: set("animationsEnabled"),
    setAntiCounterEnabled: set("antiCounterEnabled"),
    setCollisionsEnabled: set("collisionsEnabled"),
    setCustomGuild: set("customGuild"),
    setCustomName: set("customName"),
    setDeathAdsVisible: set("deathAdsVisible"),
    setEnemyMagnetEnabled: set("enemyMagnetEnabled"),
    setFrameRate: set("frameRate"),
    setInfiniteRangeEnabled: set("infiniteRangeEnabled"),
    setLagKillerEnabled: set("lagKillerEnabled"),
    setOtherPlayersVisible: set("otherPlayersVisible"),
    setProvokeCellEnabled: set("provokeCellEnabled"),
    setSkipCutscenesEnabled: set("skipCutscenesEnabled"),
    setWalkSpeed: set("walkSpeed"),
    skipCutscenes: () =>
      action("skipCutscenesEnabled", "settings.skipCutscenes"),
  };
};

export type Settings = ReturnType<typeof makeSettings>;
