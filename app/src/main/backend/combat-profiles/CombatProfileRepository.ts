import { Effect, Layer, ServiceMap } from "effect";
import {
  cloneCombatProfileLibrary,
  DEFAULT_COMBAT_PROFILE_LIBRARY,
  normalizeCombatProfileLibrary,
  type CombatProfileLibrary,
} from "../../../shared/combat-profiles";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import { DesktopObservability } from "../../app/DesktopObservability";
import {
  DesktopStorage,
  type DesktopStorageError,
} from "../../storage/DesktopStorage";

export interface CombatProfileRepositoryShape {
  readonly path: string;
  readonly get: Effect.Effect<CombatProfileLibrary, DesktopStorageError>;
  readonly set: (
    library: CombatProfileLibrary,
  ) => Effect.Effect<CombatProfileLibrary, DesktopStorageError>;
  readonly update: (
    f: (library: CombatProfileLibrary) => CombatProfileLibrary,
  ) => Effect.Effect<CombatProfileLibrary, DesktopStorageError>;
}

export class CombatProfileRepository extends ServiceMap.Service<
  CombatProfileRepository,
  CombatProfileRepositoryShape
>()("main/CombatProfileRepository") {}

export const layer = Layer.effect(CombatProfileRepository)(
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const storage = yield* DesktopStorage;
    const observability = yield* DesktopObservability;
    const path = env.appDataPath("combat-profiles.json");
    const defaults = (): CombatProfileLibrary =>
      cloneCombatProfileLibrary(DEFAULT_COMBAT_PROFILE_LIBRARY);
    const file = yield* storage.makeJsonFile<CombatProfileLibrary>({
      path,
      defaults,
      normalize: normalizeCombatProfileLibrary,
      onMalformed: ({ path, quarantinePath, error }) =>
        observability
          .warn("combat-profiles", "Malformed combat profile storage file", {
            path,
            quarantinePath,
            error,
          })
          .pipe(Effect.asVoid),
    });

    return { path, get: file.get, set: file.set, update: file.update };
  }),
);
