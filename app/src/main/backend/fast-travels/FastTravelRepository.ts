import { Effect, Layer, ServiceMap } from "effect";
import {
  cloneDefaultFastTravels,
  normalizeFastTravels,
  type FastTravel,
} from "../../../shared/fast-travels";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import { DesktopObservability } from "../../app/DesktopObservability";
import {
  DesktopStorage,
  type DesktopStorageError,
} from "../../storage/DesktopStorage";

export const FAST_TRAVELS_STORAGE_FILE = "fast-travels.json";

export interface FastTravelRepositoryShape {
  readonly path: string;
  readonly get: Effect.Effect<readonly FastTravel[], DesktopStorageError>;
  readonly set: (
    locations: readonly FastTravel[],
  ) => Effect.Effect<readonly FastTravel[], DesktopStorageError>;
  readonly update: (
    f: (locations: readonly FastTravel[]) => readonly FastTravel[],
  ) => Effect.Effect<readonly FastTravel[], DesktopStorageError>;
}

export class FastTravelRepository extends ServiceMap.Service<
  FastTravelRepository,
  FastTravelRepositoryShape
>()("main/FastTravelRepository") {}

export const layer = Layer.effect(FastTravelRepository)(
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const storage = yield* DesktopStorage;
    const observability = yield* DesktopObservability;
    const path = env.appDataPath(FAST_TRAVELS_STORAGE_FILE);
    const defaults = (): readonly FastTravel[] => cloneDefaultFastTravels();
    const file = yield* storage.makeJsonFile<readonly FastTravel[]>({
      path,
      defaults,
      normalize: normalizeFastTravels,
      onMalformed: ({ path, quarantinePath, error }) =>
        observability
          .warn("fast-travels", "Malformed fast travel storage file", {
            path,
            quarantinePath,
            error,
          })
          .pipe(Effect.asVoid),
    });

    return { path, get: file.get, set: file.set, update: file.update };
  }),
);
