import { get } from "https";

import { Context, Effect, Layer, Schema, SynchronizedRef } from "effect";

import { ACCOUNT_SERVER_REFRESH_COOLDOWN_MS } from "../../shared/accountPolicy";
import {
  emptyAccountManagerStorage,
  normalizeAccountManagerStorage,
  removeGroupMemberUsername,
  renameGroupMemberUsername,
  serializeAccountManagerStorage,
  type AccountGameLaunchPayload,
  type AccountGameServer,
  type AccountGameServerPingsResult,
  type AccountGameServersResult,
  type AccountLaunchRequest,
  type AccountLaunchResult,
  type AccountManagerState,
  type AccountManagerStorage,
  type AccountScriptSession,
  type AccountScriptStatusUpdate,
  type ManagedAccount,
  type ManagedAccountDraft,
  type ManagedAccountGroupDraft,
  type ManagedAccountGroupPatch,
  type ManagedAccountGroups,
  type ManagedAccountPatch,
  type ScriptExecutePayload,
} from "@lucent/core/accounts";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { DesktopObservability } from "../app/DesktopObservability";
import { getArtixLauncherRequestHeaders } from "../electron/ElectronSession";
import {
  type JsonFileError,
  readJsonFile,
  writeJsonFile,
} from "../settings/JsonFile";
import {
  DesktopWindows,
  type DesktopWindowOpenOptions,
} from "../window/DesktopWindows";
import {
  ACCOUNT_SERVER_PING_CACHE_TTL_MS,
  accountServerPingCacheKey,
  pingAccountServers,
  type AccountServerData,
} from "./AccountServerPing";

const SERVERS_API_URL = "https://game.aq.com/game/api/data/servers";
const ACCOUNT_MANAGER_STORAGE_FILE = "accounts.json";
const SERVERS_CACHE_TTL_MS = 5 * 60 * 1_000;
const SERVER_REQUEST_TIMEOUT_MS = 10_000;

const accountOperationSchema = Schema.Literals([
  "close-game-window",
  "create-account",
  "create-group",
  "delete-account",
  "delete-group",
  "focus-game-window",
  "get-game-launch",
  "launch",
  "mkdir",
  "parse",
  "read",
  "rename",
  "refresh-servers",
  "unlink",
  "update-account",
  "update-group",
  "update-script-status",
  "write",
]);

type AccountOperation = typeof accountOperationSchema.Type;

export class DesktopAccountsError extends Schema.TaggedErrorClass<DesktopAccountsError>()(
  "DesktopAccountsError",
  {
    operation: accountOperationSchema,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface DesktopAccountsShape {
  readonly closeGameWindow: (
    gameWindowId: number,
  ) => Effect.Effect<AccountManagerState, DesktopAccountsError>;
  readonly createAccount: (
    draft: ManagedAccountDraft,
  ) => Effect.Effect<AccountManagerState, DesktopAccountsError>;
  readonly createGroup: (
    draft: ManagedAccountGroupDraft,
  ) => Effect.Effect<AccountManagerState, DesktopAccountsError>;
  readonly deleteAccount: (
    username: string,
  ) => Effect.Effect<AccountManagerState, DesktopAccountsError>;
  readonly deleteGroup: (
    name: string,
  ) => Effect.Effect<AccountManagerState, DesktopAccountsError>;
  readonly focusGameWindow: (
    gameWindowId: number,
  ) => Effect.Effect<AccountManagerState, DesktopAccountsError>;
  readonly getGameLaunch: (
    gameWindowId: number,
  ) => Effect.Effect<AccountGameLaunchPayload | null, DesktopAccountsError>;
  readonly getServerPings: Effect.Effect<
    AccountGameServerPingsResult,
    DesktopAccountsError
  >;
  readonly getServers: Effect.Effect<
    AccountGameServersResult,
    DesktopAccountsError
  >;
  readonly getState: Effect.Effect<AccountManagerState, DesktopAccountsError>;
  readonly launch: (
    request: AccountLaunchRequest,
  ) => Effect.Effect<AccountLaunchResult, DesktopAccountsError>;
  readonly load: Effect.Effect<AccountManagerState, DesktopAccountsError>;
  readonly onChanged: (
    listener: (state: AccountManagerState) => void,
  ) => Effect.Effect<() => void>;
  readonly refreshServers: Effect.Effect<
    AccountGameServersResult,
    DesktopAccountsError
  >;
  readonly updateAccount: (
    username: string,
    patch: ManagedAccountPatch,
  ) => Effect.Effect<AccountManagerState, DesktopAccountsError>;
  readonly updateGroup: (
    name: string,
    patch: ManagedAccountGroupPatch,
  ) => Effect.Effect<AccountManagerState, DesktopAccountsError>;
  readonly updateScriptStatus: (
    gameWindowId: number,
    update: AccountScriptStatusUpdate,
  ) => Effect.Effect<void, DesktopAccountsError>;
}

export class DesktopAccounts extends Context.Service<
  DesktopAccounts,
  DesktopAccountsShape
>()("lucent/desktop/accounts/DesktopAccounts") {}

interface PendingAccountLaunch {
  readonly account: ManagedAccount;
  readonly requestedAt: number;
  readonly script?: ScriptExecutePayload;
  readonly server?: string;
}

interface AccountServerCache {
  readonly fetchedAt: number;
  readonly servers: readonly AccountServerData[];
}

interface AccountServerPingCache {
  readonly cacheKey: string;
  readonly result: AccountGameServerPingsResult;
}

const now = (): number => Date.now();

const resolveLaunchWindowOptions = (
  request: AccountLaunchRequest,
): DesktopWindowOpenOptions | undefined => {
  const tiling = request.tiling;
  if (
    tiling === undefined ||
    tiling.algorithm === "none" ||
    !Number.isSafeInteger(tiling.index) ||
    !Number.isSafeInteger(tiling.count) ||
    tiling.index < 0 ||
    tiling.count <= 1 ||
    tiling.index >= tiling.count
  ) {
    return undefined;
  }

  return {
    tile: {
      algorithm: tiling.algorithm,
      count: tiling.count,
      index: tiling.index,
    },
  };
};

const wrapJsonError = (error: JsonFileError): DesktopAccountsError =>
  new DesktopAccountsError({
    operation: error.operation === "parse" ? "parse" : error.operation,
    detail: error.message,
    cause: error,
  });

const accountError = (
  operation: AccountOperation,
  detail: string,
  cause?: unknown,
): DesktopAccountsError =>
  new DesktopAccountsError({
    operation,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });

const normalizeRequiredString = (
  value: unknown,
  field: string,
  operation: AccountOperation,
): Effect.Effect<string, DesktopAccountsError> =>
  Effect.gen(function* () {
    if (typeof value !== "string") {
      return yield* accountError(operation, `${field} must be a string`);
    }

    const normalized = value.trim();
    if (normalized === "") {
      return yield* accountError(operation, `${field} is required`);
    }

    return normalized;
  });

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized === "" ? undefined : normalized;
};

const normalizeAccountDraft = (
  draft: ManagedAccountDraft,
  operation: AccountOperation,
): Effect.Effect<ManagedAccount, DesktopAccountsError> =>
  Effect.gen(function* () {
    const username = yield* normalizeRequiredString(
      draft.username,
      "username",
      operation,
    );
    const password = yield* normalizeRequiredString(
      draft.password,
      "password",
      operation,
    );
    const label =
      typeof draft.label === "string" && draft.label.trim() !== ""
        ? draft.label.trim()
        : username;

    return {
      label,
      username,
      password,
    };
  });

const normalizeAccountPatch = (
  patch: ManagedAccountPatch,
): Effect.Effect<ManagedAccountPatch, DesktopAccountsError> =>
  Effect.gen(function* () {
    const output: Record<string, string> = {};
    for (const key of ["label", "username", "password"] as const) {
      if (patch[key] !== undefined) {
        output[key] = yield* normalizeRequiredString(
          patch[key],
          key,
          "update-account",
        );
      }
    }
    return output;
  });

const hasAccountUsername = (
  accounts: readonly ManagedAccount[],
  username: string,
  options: { readonly exceptUsername?: string } = {},
): boolean => {
  const key = username.toLowerCase();
  const exceptKey = options.exceptUsername?.toLowerCase();

  return accounts.some(
    (account) =>
      account.username.toLowerCase() === key &&
      account.username.toLowerCase() !== exceptKey,
  );
};

const findGroupName = (
  groups: ManagedAccountGroups,
  name: string,
): string | undefined => {
  const key = name.toLowerCase();
  return Object.keys(groups).find(
    (groupName) => groupName.toLowerCase() === key,
  );
};

const hasGroupName = (
  groups: ManagedAccountGroups,
  name: string,
  options: { readonly exceptName?: string } = {},
): boolean => {
  const key = name.toLowerCase();
  const exceptKey = options.exceptName?.toLowerCase();
  return Object.keys(groups).some(
    (groupName) => groupName.toLowerCase() === key && key !== exceptKey,
  );
};

const normalizeGroupMembers = (
  value: readonly string[],
  accounts: readonly ManagedAccount[],
  operation: AccountOperation,
): Effect.Effect<readonly string[], DesktopAccountsError> =>
  Effect.gen(function* () {
    const accountUsernames = new Set(
      accounts.map((account) => account.username),
    );
    const seen = new Set<string>();
    const usernames: string[] = [];

    for (const username of value) {
      const normalized = yield* normalizeRequiredString(
        username,
        "group username",
        operation,
      );
      if (!accountUsernames.has(normalized)) {
        return yield* accountError(
          operation,
          `Account not found: ${normalized}`,
        );
      }

      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        return yield* accountError(
          operation,
          `Duplicate group member: ${normalized}`,
        );
      }

      seen.add(key);
      usernames.push(normalized);
    }

    return usernames;
  });

const normalizeGroupDraft = (
  draft: ManagedAccountGroupDraft,
  accounts: readonly ManagedAccount[],
): Effect.Effect<ManagedAccountGroupDraft, DesktopAccountsError> =>
  Effect.gen(function* () {
    const name = yield* normalizeRequiredString(
      draft.name,
      "group name",
      "create-group",
    );
    const usernames = yield* normalizeGroupMembers(
      draft.usernames,
      accounts,
      "create-group",
    );
    return { name, usernames };
  });

const normalizeGroupPatch = (
  patch: ManagedAccountGroupPatch,
  accounts: readonly ManagedAccount[],
): Effect.Effect<ManagedAccountGroupPatch, DesktopAccountsError> =>
  Effect.gen(function* () {
    return {
      ...(patch.name === undefined
        ? {}
        : {
            name: yield* normalizeRequiredString(
              patch.name,
              "group name",
              "update-group",
            ),
          }),
      ...(patch.usernames === undefined
        ? {}
        : {
            usernames: yield* normalizeGroupMembers(
              patch.usernames,
              accounts,
              "update-group",
            ),
          }),
    };
  });

const toAccountGameServer = (server: AccountServerData): AccountGameServer => ({
  name: server.sName,
  language: server.sLang,
  online: server.bOnline === 1,
  upgrade: server.bUpg === 1,
  playerCount: server.iCount,
  maxPlayers: server.iMax,
});

// TOOD: schema
const isAccountServerData = (value: unknown): value is AccountServerData => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record["bOnline"] === "number" &&
    typeof record["bUpg"] === "number" &&
    typeof record["iCount"] === "number" &&
    typeof record["iMax"] === "number" &&
    typeof record["iPort"] === "number" &&
    typeof record["sIP"] === "string" &&
    typeof record["sLang"] === "string" &&
    typeof record["sName"] === "string"
  );
};

const fetchJson = (
  url: string,
  headers: Record<string, string>,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const request = get(
      url,
      {
        headers: {
          Accept: "application/json",
          ...headers,
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const chunks: Buffer[] = [];

        response.on("error", reject);
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const source = Buffer.concat(chunks).toString("utf8");
          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new Error(
                `Failed to fetch servers: ${statusCode} ${
                  response.statusMessage ?? ""
                }`.trim(),
              ),
            );
            return;
          }

          try {
            resolve(JSON.parse(source));
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.setTimeout(SERVER_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("Timed out while fetching servers"));
    });
    request.on("error", reject);
  });

const serverLoadErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "";
  const statusCode = /Failed to fetch servers: (\d{3})/.exec(message)?.[1];

  return statusCode === undefined
    ? message || "Unable to load servers"
    : `Unable to load login servers (HTTP ${statusCode})`;
};

const scriptName = (
  script: ScriptExecutePayload | null | undefined,
): string | undefined => {
  const name = script?.name?.trim();
  if (name !== undefined && name !== "") {
    return name;
  }

  const path = script?.path?.trim();
  return path === undefined || path === "" ? undefined : path;
};

export const makeDesktopAccounts = Effect.gen(function* () {
  const env = yield* DesktopEnvironment;
  const observability = yield* DesktopObservability;
  const windows = yield* DesktopWindows;
  const serverRequestHeaders = getArtixLauncherRequestHeaders(env.platform);
  const path = env.appDataPath(ACCOUNT_MANAGER_STORAGE_FILE);
  const storageRef = yield* SynchronizedRef.make<AccountManagerStorage | null>(
    null,
  );
  const listeners = new Set<(state: AccountManagerState) => void>();
  const sessions = new Map<number, AccountScriptSession>();
  const gameLaunchPayloads = new Map<number, AccountGameLaunchPayload>();
  let serverCache: AccountServerCache | null = null;
  let serverPingCache: AccountServerPingCache | null = null;
  let lastServerRefreshRequestTime = 0;

  const sessionsState = (): readonly AccountScriptSession[] =>
    Array.from(sessions.values()).sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );

  const toState = (storage: AccountManagerStorage): AccountManagerState => ({
    accounts: storage.accounts,
    groups: storage.groups,
    sessions: sessionsState(),
    storagePath: path,
  });

  const publish = (state: AccountManagerState): Effect.Effect<void> =>
    Effect.sync(() => {
      for (const listener of listeners) {
        listener(state);
      }
    });

  const readStorageFromFile = Effect.gen(function* () {
    const result = yield* readJsonFile(path).pipe(
      Effect.mapError(wrapJsonError),
    );
    if (result.status === "missing") {
      const defaults = emptyAccountManagerStorage();
      yield* writeJsonFile(path, serializeAccountManagerStorage(defaults)).pipe(
        Effect.mapError(wrapJsonError),
      );
      return defaults;
    }

    const storage = normalizeAccountManagerStorage(result.value);
    yield* writeJsonFile(path, serializeAccountManagerStorage(storage)).pipe(
      Effect.mapError(wrapJsonError),
    );
    return storage;
  });

  const loadStorage = SynchronizedRef.modifyEffect(storageRef, () =>
    readStorageFromFile.pipe(Effect.map((storage) => [storage, storage])),
  );

  const getStorage = SynchronizedRef.get(storageRef).pipe(
    Effect.flatMap((current) =>
      current === null ? loadStorage : Effect.succeed(current),
    ),
  );

  const writeStorage = (
    storage: AccountManagerStorage,
  ): Effect.Effect<AccountManagerStorage, DesktopAccountsError> => {
    const normalized = serializeAccountManagerStorage(storage);
    return writeJsonFile(path, normalized).pipe(
      Effect.mapError(wrapJsonError),
      Effect.as(normalized),
    );
  };

  const publishCurrentState = getStorage.pipe(
    Effect.flatMap((storage) => publish(toState(storage))),
  );

  const updateStorage = (
    modify: (
      storage: AccountManagerStorage,
    ) => Effect.Effect<AccountManagerStorage, DesktopAccountsError>,
  ) =>
    SynchronizedRef.modifyEffect(storageRef, (current) =>
      (current === null ? readStorageFromFile : Effect.succeed(current)).pipe(
        Effect.flatMap(modify),
        Effect.flatMap(writeStorage),
        Effect.map((saved) => [saved, saved] as const),
      ),
    ).pipe(
      Effect.flatMap((storage) => {
        const state = toState(storage);
        return publish(state).pipe(Effect.as(state));
      }),
    );

  const getState = getStorage.pipe(Effect.map(toState));
  const load = loadStorage.pipe(Effect.map(toState));

  const claimPendingLaunch = (
    gameWindowId: number,
  ): AccountGameLaunchPayload | null => {
    const existing = gameLaunchPayloads.get(gameWindowId);
    return existing ?? null;
  };

  const trackLaunchPayload = (
    gameWindowId: number,
    pending: PendingAccountLaunch,
  ): void => {
    const payload: AccountGameLaunchPayload = {
      account: pending.account,
      ...(pending.script === undefined ? {} : { script: pending.script }),
      ...(pending.server === undefined ? {} : { server: pending.server }),
      gameWindowId,
      requestedAt: pending.requestedAt,
    };
    gameLaunchPayloads.set(gameWindowId, payload);
    const pendingScriptName = scriptName(payload.script);
    sessions.set(gameWindowId, {
      gameWindowId,
      launchUsername: payload.account.username,
      currentUsername: payload.account.username,
      ...(pendingScriptName === undefined
        ? {}
        : { scriptName: pendingScriptName }),
      status: "starting",
      message: "Waiting...",
      updatedAt: now(),
    });
  };

  const getCachedServers = Effect.gen(function* () {
    const timestamp = now();
    if (
      serverCache !== null &&
      timestamp - serverCache.fetchedAt < SERVERS_CACHE_TTL_MS
    ) {
      return serverCache.servers;
    }

    const data = yield* Effect.tryPromise({
      try: () => fetchJson(SERVERS_API_URL, serverRequestHeaders),
      catch: (cause) =>
        accountError("refresh-servers", serverLoadErrorMessage(cause), cause),
    }).pipe(
      Effect.catch((error: DesktopAccountsError) =>
        serverCache === null
          ? Effect.fail(error)
          : observability
              .warn("accounts", "Failed to fetch servers; using cache", {
                error,
                cachedServerCount: serverCache.servers.length,
              })
              .pipe(Effect.as(serverCache.servers as unknown)),
      ),
    );

    if (!Array.isArray(data)) {
      if (serverCache !== null) {
        yield* observability.warn(
          "accounts",
          "Invalid servers payload; using cache",
          {
            payload: data,
            cachedServerCount: serverCache.servers.length,
          },
        );
        return serverCache.servers;
      }

      return yield* accountError(
        "refresh-servers",
        "Invalid servers payload",
        data,
      );
    }

    serverCache = {
      fetchedAt: now(),
      servers: data.filter(isAccountServerData),
    };
    serverPingCache = null;
    return serverCache.servers;
  });

  const serverResult = (
    servers: readonly AccountServerData[],
  ): AccountGameServersResult => ({
    servers: servers.map(toAccountGameServer),
    refreshAvailableAt:
      lastServerRefreshRequestTime === 0
        ? 0
        : lastServerRefreshRequestTime + ACCOUNT_SERVER_REFRESH_COOLDOWN_MS,
  });

  const getServers = getCachedServers.pipe(Effect.map(serverResult));

  const refreshServers = Effect.gen(function* () {
    const timestamp = now();
    if (
      lastServerRefreshRequestTime !== 0 &&
      timestamp - lastServerRefreshRequestTime <
        ACCOUNT_SERVER_REFRESH_COOLDOWN_MS
    ) {
      return yield* getServers;
    }

    lastServerRefreshRequestTime = timestamp;
    serverCache = null;
    serverPingCache = null;
    const servers = yield* getCachedServers;
    return serverResult(servers);
  });

  const getServerPings = Effect.gen(function* () {
    const servers = yield* getCachedServers;
    const cacheKey = accountServerPingCacheKey(servers);
    const timestamp = now();
    if (
      serverPingCache !== null &&
      serverPingCache.cacheKey === cacheKey &&
      timestamp < serverPingCache.result.expiresAt
    ) {
      return serverPingCache.result;
    }

    const pings = yield* Effect.tryPromise({
      try: () => pingAccountServers(servers),
      catch: (cause) =>
        accountError("refresh-servers", serverLoadErrorMessage(cause), cause),
    });
    const measuredAt = now();
    const result: AccountGameServerPingsResult = {
      expiresAt: measuredAt + ACCOUNT_SERVER_PING_CACHE_TTL_MS,
      measuredAt,
      pings,
    };
    serverPingCache = {
      cacheKey,
      result,
    };
    return result;
  });

  const removeWindowSession = (gameWindowId: number) =>
    Effect.gen(function* () {
      const removedSession = sessions.delete(gameWindowId);
      const removedPayload = gameLaunchPayloads.delete(gameWindowId);
      if (removedSession || removedPayload) {
        yield* publishCurrentState;
      }
    });

  const unsubscribeWindows = yield* windows.onClosed((event) => {
    if (event.kind === "game") {
      return removeWindowSession(event.browserWindowId);
    }
    return Effect.void;
  });

  yield* Effect.addFinalizer(() => Effect.sync(unsubscribeWindows));

  return DesktopAccounts.of({
    closeGameWindow: (gameWindowId) =>
      windows.closeBrowserWindow(gameWindowId).pipe(
        Effect.flatMap(() => removeWindowSession(gameWindowId)),
        Effect.flatMap(() => getState),
        Effect.mapError((cause) =>
          cause instanceof DesktopAccountsError
            ? cause
            : accountError(
                "close-game-window",
                `Failed to close game window: ${gameWindowId}`,
                cause,
              ),
        ),
      ),
    createAccount: (draft) =>
      updateStorage((storage) =>
        Effect.gen(function* () {
          const account = yield* normalizeAccountDraft(draft, "create-account");
          if (hasAccountUsername(storage.accounts, account.username)) {
            return yield* accountError(
              "create-account",
              "An account with this username already exists",
            );
          }

          return {
            ...storage,
            accounts: [...storage.accounts, account],
          };
        }),
      ),
    createGroup: (draft) =>
      updateStorage((storage) =>
        Effect.gen(function* () {
          const group = yield* normalizeGroupDraft(draft, storage.accounts);
          if (hasGroupName(storage.groups, group.name)) {
            return yield* accountError(
              "create-group",
              "A group with this name already exists",
            );
          }

          return {
            ...storage,
            groups: {
              ...storage.groups,
              [group.name]: group.usernames,
            },
          };
        }),
      ),
    deleteAccount: (username) =>
      updateStorage((storage) =>
        Effect.gen(function* () {
          const accountUsername = yield* normalizeRequiredString(
            username,
            "username",
            "delete-account",
          );
          const accounts = storage.accounts.filter(
            (account) => account.username !== accountUsername,
          );
          if (accounts.length === storage.accounts.length) {
            return yield* accountError("delete-account", "Account not found");
          }

          return {
            accounts,
            groups: removeGroupMemberUsername(storage.groups, accountUsername),
          };
        }),
      ),
    deleteGroup: (name) =>
      updateStorage((storage) =>
        Effect.gen(function* () {
          const groupName = yield* normalizeRequiredString(
            name,
            "group name",
            "delete-group",
          );
          const existingName = findGroupName(storage.groups, groupName);
          if (existingName === undefined) {
            return yield* accountError("delete-group", "Group not found");
          }

          const groups: Record<string, readonly string[]> = {};
          for (const [currentName, usernames] of Object.entries(
            storage.groups,
          )) {
            if (currentName !== existingName) {
              groups[currentName] = usernames;
            }
          }

          return {
            ...storage,
            groups,
          };
        }),
      ),
    focusGameWindow: (gameWindowId) =>
      windows.revealBrowserWindow(gameWindowId).pipe(
        Effect.flatMap((revealed) =>
          revealed ? Effect.void : removeWindowSession(gameWindowId),
        ),
        Effect.flatMap(() => getState),
        Effect.mapError((cause) =>
          accountError(
            "focus-game-window",
            `Failed to focus game window: ${gameWindowId}`,
            cause,
          ),
        ),
      ),
    getGameLaunch: (gameWindowId) =>
      Effect.sync(() => claimPendingLaunch(gameWindowId)).pipe(
        Effect.tap((payload) =>
          payload === null ? Effect.void : publishCurrentState,
        ),
        Effect.mapError((cause) =>
          accountError(
            "get-game-launch",
            `Failed to read game launch payload: ${gameWindowId}`,
            cause,
          ),
        ),
      ),
    getServerPings,
    getServers,
    getState,
    launch: (request) =>
      Effect.gen(function* () {
        const username = yield* normalizeRequiredString(
          request.username,
          "username",
          "launch",
        );
        const storage = yield* getStorage;
        const account = storage.accounts.find(
          (candidate) => candidate.username === username,
        );
        if (account === undefined) {
          return yield* accountError("launch", "Account not found");
        }

        const launchServer = normalizeOptionalString(request.server);
        const pending: PendingAccountLaunch = {
          account,
          ...(request.script === null || request.script === undefined
            ? {}
            : { script: request.script }),
          ...(launchServer === undefined ? {} : { server: launchServer }),
          requestedAt: now(),
        };
        let gameWindowId: number | undefined;
        const launchWindowOptions = resolveLaunchWindowOptions(request);

        const instanceId = yield* windows
          .open("game", {
            ...launchWindowOptions,
            onCreated: ({ browserWindowId }) =>
              Effect.sync(() => {
                gameWindowId = browserWindowId;
                trackLaunchPayload(browserWindowId, pending);
              }).pipe(Effect.andThen(publishCurrentState)),
          })
          .pipe(
            Effect.catch((cause) => {
              if (gameWindowId === undefined) {
                return Effect.fail(cause);
              }

              return removeWindowSession(gameWindowId).pipe(
                Effect.andThen(Effect.fail(cause)),
              );
            }),
          );
        const resolvedGameWindowId =
          gameWindowId ?? (yield* windows.getBrowserWindowId(instanceId));
        if (!gameLaunchPayloads.has(resolvedGameWindowId)) {
          trackLaunchPayload(resolvedGameWindowId, pending);
          yield* publishCurrentState;
        }

        return { gameWindowId: resolvedGameWindowId };
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof DesktopAccountsError
            ? cause
            : accountError("launch", "Failed to launch account", cause),
        ),
      ),
    load,
    onChanged: (listener) =>
      Effect.sync(() => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }),
    refreshServers,
    updateAccount: (username, patch) =>
      updateStorage((storage) =>
        Effect.gen(function* () {
          const currentUsername = yield* normalizeRequiredString(
            username,
            "username",
            "update-account",
          );
          const accountPatch = yield* normalizeAccountPatch(patch);
          const nextUsername = accountPatch.username ?? currentUsername;
          if (
            hasAccountUsername(storage.accounts, nextUsername, {
              exceptUsername: currentUsername,
            })
          ) {
            return yield* accountError(
              "update-account",
              "An account with this username already exists",
            );
          }

          let found = false;
          const accounts = storage.accounts.map((account) => {
            if (account.username !== currentUsername) {
              return account;
            }

            found = true;
            return {
              ...account,
              ...accountPatch,
              label: accountPatch.label ?? account.label,
            };
          });

          if (!found) {
            return yield* accountError("update-account", "Account not found");
          }

          return {
            accounts,
            groups: renameGroupMemberUsername(
              storage.groups,
              currentUsername,
              nextUsername,
            ),
          };
        }),
      ),
    updateGroup: (name, patch) =>
      updateStorage((storage) =>
        Effect.gen(function* () {
          const currentName = yield* normalizeRequiredString(
            name,
            "group name",
            "update-group",
          );
          const existingName = findGroupName(storage.groups, currentName);
          if (existingName === undefined) {
            return yield* accountError("update-group", "Group not found");
          }

          const groupPatch = yield* normalizeGroupPatch(
            patch,
            storage.accounts,
          );
          const nextName = groupPatch.name ?? existingName;
          if (
            hasGroupName(storage.groups, nextName, {
              exceptName: existingName,
            })
          ) {
            return yield* accountError(
              "update-group",
              "A group with this name already exists",
            );
          }

          const groups: Record<string, readonly string[]> = {};
          for (const [groupName, usernames] of Object.entries(storage.groups)) {
            groups[groupName === existingName ? nextName : groupName] =
              groupName === existingName
                ? (groupPatch.usernames ?? usernames)
                : usernames;
          }

          return {
            ...storage,
            groups,
          };
        }),
      ),
    updateScriptStatus: (gameWindowId, update) =>
      Effect.gen(function* () {
        const previous = sessions.get(gameWindowId);
        const payload = gameLaunchPayloads.get(gameWindowId);
        const payloadScriptName = scriptName(payload?.script);
        const updateScriptName =
          update.scriptName === undefined
            ? undefined
            : scriptName({ source: "", name: update.scriptName });
        sessions.set(gameWindowId, {
          gameWindowId,
          ...(payload === undefined
            ? {}
            : { launchUsername: payload.account.username }),
          ...(previous?.launchUsername === undefined
            ? {}
            : { launchUsername: previous.launchUsername }),
          ...(update.currentUsername === undefined
            ? previous?.currentUsername === undefined
              ? {}
              : { currentUsername: previous.currentUsername }
            : { currentUsername: update.currentUsername }),
          ...(update.scriptName === undefined
            ? previous?.scriptName === undefined
              ? payloadScriptName === undefined
                ? {}
                : { scriptName: payloadScriptName }
              : { scriptName: previous.scriptName }
            : updateScriptName === undefined
              ? {}
              : { scriptName: updateScriptName }),
          status: update.status,
          ...(update.message === undefined ? {} : { message: update.message }),
          updatedAt: now(),
        });
        yield* publishCurrentState;
      }).pipe(
        Effect.mapError((cause) =>
          accountError(
            "update-script-status",
            `Failed to update script status for game window: ${gameWindowId}`,
            cause,
          ),
        ),
      ),
  });
});

export const layer = Layer.effect(DesktopAccounts, makeDesktopAccounts);
