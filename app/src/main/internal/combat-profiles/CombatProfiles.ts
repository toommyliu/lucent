import { join } from "path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import {
  DEFAULT_COMBAT_PROFILE_ID,
  DEFAULT_COMBAT_PROFILE_LIBRARY,
  cloneCombatProfileLibrary,
  normalizeCombatProfile,
  normalizeCombatProfileLibrary,
  serializeCombatProfileLibrary,
  type CombatProfile,
  type CombatProfileLibrary,
} from "@lucent/core/combatProfiles";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import { makeListenerRegistry } from "../../app/ListenerRegistry";
import { DesktopFileSystem } from "../../filesystem/DesktopFileSystem";
import { type JsonFileError, makeJsonFile } from "../../filesystem/JsonFile";

const combatProfilesOperationSchema = Schema.Literals([
  "delete-profile",
  "mkdir",
  "parse",
  "read",
  "rename",
  "save-profile",
  "unlink",
  "write",
]);

export class CombatProfilesError extends Schema.TaggedErrorClass<CombatProfilesError>()(
  "CombatProfilesError",
  {
    detail: Schema.String,
    operation: combatProfilesOperationSchema,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface CombatProfilesShape {
  readonly deleteProfile: (
    profileId: string,
  ) => Effect.Effect<CombatProfileLibrary, CombatProfilesError>;
  readonly get: Effect.Effect<CombatProfileLibrary, CombatProfilesError>;
  readonly load: Effect.Effect<CombatProfileLibrary, CombatProfilesError>;
  readonly onChanged: (
    listener: (library: CombatProfileLibrary) => void,
  ) => Effect.Effect<() => void>;
  readonly saveProfile: (
    profile: CombatProfile,
  ) => Effect.Effect<CombatProfileLibrary, CombatProfilesError>;
}

export class CombatProfiles extends Context.Service<
  CombatProfiles,
  CombatProfilesShape
>()("lucent/internal/combat-profiles/CombatProfiles") {}

const wrapDataError = (error: JsonFileError): CombatProfilesError =>
  new CombatProfilesError({
    operation: error.operation,
    detail: error.message,
    cause: error,
  });

const validationError = (
  operation: typeof combatProfilesOperationSchema.Type,
  detail: string,
): CombatProfilesError =>
  new CombatProfilesError({
    operation,
    detail,
  });

const defaultLibrary = (): CombatProfileLibrary =>
  cloneCombatProfileLibrary(DEFAULT_COMBAT_PROFILE_LIBRARY);

const saveProfileToLibrary = (
  current: CombatProfileLibrary,
  profile: CombatProfile,
): CombatProfileLibrary => {
  const normalizedProfile = normalizeCombatProfile(profile);
  const existingIndex = current.profiles.findIndex(
    (candidate) => candidate.id === normalizedProfile.id,
  );
  const profiles =
    existingIndex === -1
      ? [...current.profiles, normalizedProfile]
      : current.profiles.map((candidate, index) =>
          index === existingIndex ? normalizedProfile : candidate,
        );

  return normalizeCombatProfileLibrary({
    ...current,
    profiles,
  });
};

const deleteProfileFromLibrary = (
  current: CombatProfileLibrary,
  profileId: string,
): Effect.Effect<CombatProfileLibrary, CombatProfilesError> =>
  Effect.gen(function* () {
    if (profileId === DEFAULT_COMBAT_PROFILE_ID) {
      return yield* validationError(
        "delete-profile",
        "The generic combat profile cannot be deleted.",
      );
    }

    const profiles = current.profiles.filter(
      (profile) => profile.id !== profileId,
    );
    if (profiles.length === current.profiles.length) {
      return yield* validationError(
        "delete-profile",
        "Combat profile does not exist.",
      );
    }

    return normalizeCombatProfileLibrary({
      ...current,
      profiles,
    });
  });

const makeCombatProfiles = Effect.gen(function* () {
  const env = yield* DesktopEnvironment;
  const jsonFile = makeJsonFile(yield* DesktopFileSystem);
  const path = join(env.appDataDir, "combat-profiles.json");
  const libraryRef = yield* Ref.make<CombatProfileLibrary | null>(null);
  const mutationLock = yield* Semaphore.make(1);
  const libraryChanges = makeListenerRegistry<CombatProfileLibrary>();

  const readLibraryFromFile = Effect.gen(function* () {
    const result = yield* jsonFile
      .read(path)
      .pipe(Effect.mapError(wrapDataError));
    if (result.status === "missing") {
      const defaults = defaultLibrary();
      yield* jsonFile
        .write(path, serializeCombatProfileLibrary(defaults))
        .pipe(Effect.mapError(wrapDataError));
      return defaults;
    }

    const library = yield* Effect.try({
      try: () => normalizeCombatProfileLibrary(result.value),
      catch: (cause) =>
        new CombatProfilesError({
          operation: "parse",
          detail:
            cause instanceof Error
              ? cause.message
              : "Invalid combat profile library.",
          cause,
        }),
    });
    yield* jsonFile
      .write(path, serializeCombatProfileLibrary(library))
      .pipe(Effect.mapError(wrapDataError));
    return library;
  });

  const commitLibrary = Effect.fn("CombatProfiles.commitLibrary")(function* (
    library: CombatProfileLibrary,
  ) {
    yield* Ref.set(libraryRef, library);
    yield* libraryChanges.publish(library);
    return library;
  });

  const load = mutationLock.withPermit(
    readLibraryFromFile.pipe(Effect.flatMap(commitLibrary)),
  );

  const get = Ref.get(libraryRef).pipe(
    Effect.flatMap((current) =>
      current === null ? load : Effect.succeed(current),
    ),
  );

  const writeLibraryFile = (
    library: CombatProfileLibrary,
  ): Effect.Effect<CombatProfileLibrary, CombatProfilesError> => {
    const normalized = normalizeCombatProfileLibrary(library);
    return jsonFile
      .write(path, serializeCombatProfileLibrary(normalized))
      .pipe(Effect.mapError(wrapDataError), Effect.as(normalized));
  };

  const update = (
    modify: (
      current: CombatProfileLibrary,
    ) => Effect.Effect<CombatProfileLibrary, CombatProfilesError>,
  ) =>
    mutationLock.withPermit(
      Ref.get(libraryRef).pipe(
        Effect.flatMap((current) =>
          current === null ? readLibraryFromFile : Effect.succeed(current),
        ),
        Effect.flatMap(modify),
        Effect.flatMap(writeLibraryFile),
        Effect.flatMap(commitLibrary),
      ),
    );

  const deleteProfile: CombatProfilesShape["deleteProfile"] = (profileId) =>
    update((current) => deleteProfileFromLibrary(current, profileId));

  const onChanged: CombatProfilesShape["onChanged"] = libraryChanges.subscribe;

  const saveProfile: CombatProfilesShape["saveProfile"] = (profile) =>
    update((current) => Effect.succeed(saveProfileToLibrary(current, profile)));

  return CombatProfiles.of({
    deleteProfile,
    get,
    load,
    onChanged,
    saveProfile,
  });
});

export const layer = Layer.effect(CombatProfiles, makeCombatProfiles);
