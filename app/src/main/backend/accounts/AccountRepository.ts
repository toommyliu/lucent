import { Effect, Layer, ServiceMap } from "effect";
import type { AccountManagerState } from "../../../shared/ipc";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import { DesktopObservability } from "../../app/DesktopObservability";
import {
  DesktopStorage,
  type DesktopStorageError,
} from "../../storage/DesktopStorage";
import {
  ACCOUNT_MANAGER_STORAGE_FILE,
  emptyAccountManagerStorage,
  normalizeAccountManagerStorage,
  serializeAccountManagerStorage,
  type AccountManagerStorage,
} from "./AccountStore";

export interface AccountManagerRepositoryShape {
  readonly storagePath: string;
  readonly get: Effect.Effect<AccountManagerStorage, DesktopStorageError>;
  readonly set: (
    storage: AccountManagerStorage,
  ) => Effect.Effect<AccountManagerStorage, DesktopStorageError>;
  readonly update: (
    f: (storage: AccountManagerStorage) => AccountManagerStorage,
  ) => Effect.Effect<AccountManagerStorage, DesktopStorageError>;
  readonly toState: (
    sessions: AccountManagerState["sessions"],
  ) => Effect.Effect<AccountManagerState, DesktopStorageError>;
}

export class AccountManagerRepository extends ServiceMap.Service<
  AccountManagerRepository,
  AccountManagerRepositoryShape
>()("main/AccountManagerRepository") {}

export const layer = Layer.effect(AccountManagerRepository)(
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const storage = yield* DesktopStorage;
    const observability = yield* DesktopObservability;
    const storagePath = env.appDataPath(ACCOUNT_MANAGER_STORAGE_FILE);
    const file = yield* storage.makeJsonFile<AccountManagerStorage>({
      path: storagePath,
      defaults: emptyAccountManagerStorage,
      normalize: normalizeAccountManagerStorage,
      serialize: serializeAccountManagerStorage,
      onMalformed: ({ path, quarantinePath, error }) =>
        observability
          .warn("accounts", "Malformed account storage file", {
            path,
            quarantinePath,
            error,
          })
          .pipe(Effect.asVoid),
    });

    return {
      storagePath,
      get: file.get,
      set: file.set,
      update: file.update,
      toState: (sessions) =>
        file.get.pipe(
          Effect.map((storage) => ({
            accounts: storage.accounts,
            groups: storage.groups,
            sessions,
            storagePath,
          })),
        ),
    };
  }),
);
