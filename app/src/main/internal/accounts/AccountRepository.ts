import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SynchronizedRef from "effect/SynchronizedRef";

import {
  emptyAccountManagerStorage,
  normalizeAccountManagerStorage,
  serializeAccountManagerStorage,
  type AccountManagerStorage,
} from "@lucent/core/accounts";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import {
  type JsonFileError,
  readJsonFile,
  writeJsonFile,
} from "../../settings/JsonFile";
import { AccountsError } from "./AccountsError";

const ACCOUNT_MANAGER_STORAGE_FILE = "accounts.json";

const wrapJsonError = (error: JsonFileError): AccountsError =>
  new AccountsError({
    operation: error.operation === "parse" ? "parse" : error.operation,
    detail: error.message,
    cause: error,
  });

export interface AccountRepositoryShape {
  readonly get: Effect.Effect<AccountManagerStorage, AccountsError>;
  readonly load: Effect.Effect<AccountManagerStorage, AccountsError>;
  readonly path: string;
  readonly update: (
    modify: (
      storage: AccountManagerStorage,
    ) => Effect.Effect<AccountManagerStorage, AccountsError>,
  ) => Effect.Effect<AccountManagerStorage, AccountsError>;
}

export class AccountRepository extends Context.Service<
  AccountRepository,
  AccountRepositoryShape
>()("lucent/internal/accounts/AccountRepository") {}

export const layer = Layer.effect(
  AccountRepository,
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const path = env.appDataPath(ACCOUNT_MANAGER_STORAGE_FILE);
    const storageRef =
      yield* SynchronizedRef.make<AccountManagerStorage | null>(null);

    const readStorageFromFile = Effect.gen(function* () {
      const result = yield* readJsonFile(path).pipe(
        Effect.mapError(wrapJsonError),
      );
      if (result.status === "missing") {
        const defaults = emptyAccountManagerStorage();
        yield* writeJsonFile(
          path,
          serializeAccountManagerStorage(defaults),
        ).pipe(Effect.mapError(wrapJsonError));
        return defaults;
      }

      const storage = normalizeAccountManagerStorage(result.value);
      yield* writeJsonFile(path, serializeAccountManagerStorage(storage)).pipe(
        Effect.mapError(wrapJsonError),
      );
      return storage;
    });

    const load = SynchronizedRef.modifyEffect(storageRef, () =>
      readStorageFromFile.pipe(Effect.map((storage) => [storage, storage])),
    );

    const get = SynchronizedRef.get(storageRef).pipe(
      Effect.flatMap((current) =>
        current === null ? load : Effect.succeed(current),
      ),
    );

    const write = (storage: AccountManagerStorage) => {
      const normalized = serializeAccountManagerStorage(storage);
      return writeJsonFile(path, normalized).pipe(
        Effect.mapError(wrapJsonError),
        Effect.as(normalized),
      );
    };

    const update = (
      modify: (
        storage: AccountManagerStorage,
      ) => Effect.Effect<AccountManagerStorage, AccountsError>,
    ) =>
      SynchronizedRef.modifyEffect(storageRef, (current) =>
        (current === null ? readStorageFromFile : Effect.succeed(current)).pipe(
          Effect.flatMap(modify),
          Effect.flatMap(write),
          Effect.map((saved) => [saved, saved] as const),
        ),
      );

    return AccountRepository.of({
      get,
      load,
      path,
      update,
    });
  }),
);
