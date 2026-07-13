import { Context, Effect, Layer, Schema, SynchronizedRef } from "effect";

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
import {
  type JsonFileError,
  readJsonFile,
  writeJsonFile,
} from "../../settings/JsonFile";

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
  const path = env.appDataPath("combat-profiles.json");
  const libraryRef = yield* SynchronizedRef.make<CombatProfileLibrary | null>(
    null,
  );
  const libraryChanges = makeListenerRegistry<CombatProfileLibrary>();

  const readLibraryFromFile = Effect.gen(function* () {
    const result = yield* readJsonFile(path).pipe(
      Effect.mapError(wrapDataError),
    );
    if (result.status === "missing") {
      const defaults = defaultLibrary();
      yield* writeJsonFile(path, serializeCombatProfileLibrary(defaults)).pipe(
        Effect.mapError(wrapDataError),
      );
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
    yield* writeJsonFile(path, serializeCombatProfileLibrary(library)).pipe(
      Effect.mapError(wrapDataError),
    );
    return library;
  });

  const load = SynchronizedRef.modifyEffect(libraryRef, () =>
    readLibraryFromFile.pipe(
      Effect.map((library) => [library, library] as const),
    ),
  );

  const get = SynchronizedRef.get(libraryRef).pipe(
    Effect.flatMap((current) =>
      current === null ? load : Effect.succeed(current),
    ),
  );

  const writeLibraryFile = (
    library: CombatProfileLibrary,
  ): Effect.Effect<CombatProfileLibrary, CombatProfilesError> => {
    const normalized = normalizeCombatProfileLibrary(library);
    return writeJsonFile(path, serializeCombatProfileLibrary(normalized)).pipe(
      Effect.mapError(wrapDataError),
      Effect.as(normalized),
    );
  };

  const update = (
    modify: (
      current: CombatProfileLibrary,
    ) => Effect.Effect<CombatProfileLibrary, CombatProfilesError>,
  ) =>
    SynchronizedRef.modifyEffect(libraryRef, (current) =>
      (current === null ? readLibraryFromFile : Effect.succeed(current)).pipe(
        Effect.flatMap(modify),
        Effect.flatMap(writeLibraryFile),
        Effect.map((saved) => [saved, saved] as const),
      ),
    ).pipe(Effect.tap(libraryChanges.publish));

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
