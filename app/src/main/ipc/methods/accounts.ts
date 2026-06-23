import { type IpcMainInvokeEvent, type Rectangle } from "electron";
import { get } from "https";
import { ServerDataSchema, type ServerData } from "@lucent/game";
import { Data, Effect, Schema, Scope } from "effect";
import {
  ACCOUNT_SERVER_REFRESH_COOLDOWN_MS,
  AccountManagerIpcChannels,
  type AccountGameLaunchPayload,
  type AccountGameServer,
  type AccountGameServerPingsResult,
  type AccountGameServersResult,
  type AccountGameWindowIdentityUpdate,
  type AccountGameWindowShutdownResponse,
  type AccountGameWindowTargetRequest,
  type AccountLaunchResult,
  type AccountLaunchRequest,
  type AccountLaunchTilingAlgorithm,
  type AccountLaunchTilingPlacement,
  type AccountManagerState,
  type AccountScriptSession,
  type AccountScriptStatusUpdate,
  type ManagedAccount,
  type ManagedAccountGroupDraft,
  type ManagedAccountGroups,
  type ManagedAccountGroupPatch,
  type ManagedAccountDraft,
  type ManagedAccountPatch,
  type ScriptExecutePayload,
} from "../../../shared/ipc";
import { makeRandomId } from "../../../shared/random-id";
import { WindowIds } from "../../../shared/windows";
import {
  type AccountManagerRepositoryShape,
  AccountManagerRepository,
} from "../../backend/accounts/AccountRepository";
import {
  type AccountManagerStorage,
  removeGroupMemberUsername,
  renameGroupMemberUsername,
} from "../../backend/accounts/AccountStore";
import { getArtixLauncherRequestHeaders } from "../../artix-launcher-headers";
import {
  DesktopObservability,
  type DesktopObservabilityShape,
} from "../../app/DesktopObservability";
import { DesktopIpc } from "../DesktopIpc";
import {
  getSenderWindowId,
  requireAccountManagerSender as requireAccountManagerSenderEffect,
  requireGameWindowSender,
} from "../DesktopIpcRequest";
import {
  AccountSessions,
  mergeAccountSessionDisplayMetadata,
  type AccountSessionsShape,
} from "../../backend/accounts/AccountSessions";
import {
  accountServerPingCacheKey,
  ACCOUNT_SERVER_PING_CACHE_TTL_MS,
  pingAccountServers,
} from "../../backend/accounts/ServerPing";
import {
  ScriptLibrary,
  type ScriptLibraryShape,
} from "../../backend/scripting/ScriptLibrary";
import {
  WindowService,
  type CatalogWindowRef,
  type GameWindowRef,
  type WindowEffectRunner,
} from "../../window/WindowService";

const SERVERS_API_URL = "https://game.aq.com/game/api/data/servers";
const SERVERS_CACHE_TTL_MS = 5 * 60 * 1_000;
const SERVER_REQUEST_TIMEOUT_MS = 10_000;
const ACCOUNT_GAME_WINDOW_SHUTDOWN_TIMEOUT_MS = 12_000;

const launchTilingAlgorithms = new Set<AccountLaunchTilingAlgorithm>([
  "none",
  "auto-grid",
  "horizontal",
  "vertical",
]);

const now = (): number => Date.now();

const isLaunchTilingAlgorithm = (
  value: unknown,
): value is AccountLaunchTilingAlgorithm =>
  typeof value === "string" &&
  launchTilingAlgorithms.has(value as AccountLaunchTilingAlgorithm);

class AccountServersFetchError extends Data.TaggedError(
  "AccountServersFetchError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

class AccountServersPayloadError extends Data.TaggedError(
  "AccountServersPayloadError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const normalizeRequiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }

  const normalized = value.trim();
  if (normalized === "") {
    throw new Error(`${field} is required`);
  }

  return normalized;
};

const normalizeOptionalString = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const optionalTrimmedString = (value: unknown): string | undefined => {
  const normalized = normalizeOptionalString(value);
  return normalized === "" ? undefined : normalized;
};

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const hasAccountUsername = (
  accounts: readonly ManagedAccount[],
  username: string,
  options?: { readonly exceptUsername?: string },
): boolean => {
  const normalized = username.toLowerCase();
  const except = options?.exceptUsername?.toLowerCase();

  return accounts.some(
    (account) =>
      account.username.toLowerCase() === normalized &&
      account.username.toLowerCase() !== except,
  );
};

const readStorage = async (
  repository: AccountManagerRepositoryShape,
): Promise<AccountManagerStorage> => Effect.runPromise(repository.get);

const updateStorage = async (
  repository: AccountManagerRepositoryShape,
  f: (storage: AccountManagerStorage) => AccountManagerStorage,
): Promise<AccountManagerStorage> => Effect.runPromise(repository.update(f));

const readAccounts = async (
  repository: AccountManagerRepositoryShape,
): Promise<readonly ManagedAccount[]> =>
  (await readStorage(repository)).accounts;

const groupNameKey = (name: string): string => name.toLowerCase();

const findGroupName = (
  groups: ManagedAccountGroups,
  name: string,
): string | undefined => {
  const key = groupNameKey(name);
  return Object.keys(groups).find(
    (groupName) => groupNameKey(groupName) === key,
  );
};

const hasGroupName = (
  groups: ManagedAccountGroups,
  name: string,
  options?: { readonly exceptName?: string },
): boolean => {
  const existingName = findGroupName(groups, name);
  return (
    existingName !== undefined &&
    groupNameKey(existingName) !== groupNameKey(options?.exceptName ?? "")
  );
};

const normalizeGroupMembersInput = (
  value: unknown,
  accounts: readonly ManagedAccount[],
): readonly string[] => {
  if (!Array.isArray(value)) {
    throw new Error("Group usernames must be an array");
  }

  const usernames = new Set(accounts.map((account) => account.username));
  const seen = new Set<string>();
  const members: string[] = [];

  for (const username of value) {
    if (typeof username !== "string") {
      throw new Error("Group username must be a string");
    }

    const normalized = normalizeRequiredString(username, "group username");
    if (!usernames.has(normalized)) {
      throw new Error(`Account not found: ${normalized}`);
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate group member: ${normalized}`);
    }

    seen.add(key);
    members.push(normalized);
  }

  return members;
};

const normalizeGroupDraft = (
  draft: unknown,
  accounts: readonly ManagedAccount[],
): ManagedAccountGroupDraft => {
  if (typeof draft !== "object" || draft === null) {
    throw new Error("Group draft must be an object");
  }

  const input = draft as Partial<ManagedAccountGroupDraft>;
  return {
    name: normalizeRequiredString(input.name, "group name"),
    usernames: normalizeGroupMembersInput(input.usernames, accounts),
  };
};

const normalizeGroupPatch = (
  patch: unknown,
  accounts: readonly ManagedAccount[],
): ManagedAccountGroupPatch => {
  if (typeof patch !== "object" || patch === null) {
    throw new Error("Group patch must be an object");
  }

  const input = patch as Partial<ManagedAccountGroupPatch>;
  return {
    ...(input.name === undefined
      ? {}
      : { name: normalizeRequiredString(input.name, "group name") }),
    ...(input.usernames === undefined
      ? {}
      : { usernames: normalizeGroupMembersInput(input.usernames, accounts) }),
  };
};

const visibleSessions = (
  runtime: AccountSessionsShape,
): readonly AccountScriptSession[] => runtime.getSessionsState();

const toState = async (
  repository: AccountManagerRepositoryShape,
  runtime: AccountSessionsShape,
): Promise<AccountManagerState> => {
  const storage = await readStorage(repository);
  return {
    accounts: storage.accounts,
    groups: storage.groups,
    sessions: visibleSessions(runtime),
    storagePath: repository.storagePath,
  };
};

const toAccountGameServer = (server: {
  readonly bOnline: number;
  readonly bUpg: number;
  readonly iCount: number;
  readonly iMax: number;
  readonly sLang: string;
  readonly sName: string;
}): AccountGameServer => ({
  name: server.sName,
  language: server.sLang,
  online: server.bOnline === 1,
  upgrade: server.bUpg === 1,
  playerCount: server.iCount,
  maxPlayers: server.iMax,
});

const isServerData = Schema.is(ServerDataSchema);

const fetchJson = (url: string): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const request = get(
      url,
      {
        headers: {
          Accept: "application/json",
          ...getArtixLauncherRequestHeaders(),
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

const fetchServersJson = Effect.tryPromise({
  try: () => fetchJson(SERVERS_API_URL),
  catch: (cause) =>
    new AccountServersFetchError({
      message:
        cause instanceof Error ? cause.message : "Failed to fetch servers",
      cause,
    }),
});

const getCachedAccountServers = (
  runtime: AccountSessionsShape,
  observability: DesktopObservabilityShape,
): Effect.Effect<
  readonly ServerData[],
  AccountServersFetchError | AccountServersPayloadError
> =>
  Effect.gen(function* () {
    const timestamp = now();
    const cache = runtime.getServerCache();
    if (
      cache.servers.length > 0 &&
      timestamp - cache.lastFetchTime < SERVERS_CACHE_TTL_MS
    ) {
      return cache.servers;
    }

    const data = yield* fetchServersJson.pipe(
      Effect.catch((error: AccountServersFetchError) =>
        cache.servers.length > 0
          ? observability
              .warn("accounts", "Failed to fetch servers; using cache", {
                error,
                cachedServerCount: cache.servers.length,
              })
              .pipe(Effect.as(cache.servers as unknown))
          : Effect.fail(error),
      ),
    );

    if (!Array.isArray(data)) {
      if (cache.servers.length > 0) {
        yield* observability.warn(
          "accounts",
          "Invalid servers payload; using cache",
          {
            payload: data,
            cachedServerCount: cache.servers.length,
          },
        );
        return cache.servers;
      }

      return yield* new AccountServersPayloadError({
        message: "Invalid servers payload",
        cause: data,
      });
    }

    yield* Effect.sync(() => {
      runtime.setCachedServers(data.filter(isServerData), now());
    });

    return runtime.getServerCache().servers;
  });

const refreshAccountServers = (
  runtime: AccountSessionsShape,
  observability: DesktopObservabilityShape,
): Effect.Effect<
  readonly ServerData[],
  AccountServersFetchError | AccountServersPayloadError
> =>
  Effect.sync(() => {
    runtime.resetServerFetchTime();
  }).pipe(
    Effect.flatMap(() => getCachedAccountServers(runtime, observability)),
  );

const getOpenAccountManagerWindow = (
  runWindowEffect: WindowEffectRunner,
): Promise<CatalogWindowRef | null> =>
  runWindowEffect(
    Effect.gen(function* () {
      const windows = yield* WindowService;
      return yield* windows.getOpenWindow(WindowIds.AccountManager);
    }),
  );

const requireAccountManagerSender = async (
  event: IpcMainInvokeEvent,
  runWindowEffect: WindowEffectRunner,
): Promise<void> =>
  runWindowEffect(requireAccountManagerSenderEffect(event.sender)).catch(
    (cause) => {
      throw new Error(
        "Account credentials are only available to Account Manager",
        { cause },
      );
    },
  );

const publishStateToAccountManager = async (
  runWindowEffect: WindowEffectRunner,
  repository: AccountManagerRepositoryShape,
  runtime: AccountSessionsShape,
): Promise<AccountManagerState> => {
  const state = await toState(repository, runtime);
  const window = await getOpenAccountManagerWindow(runWindowEffect);

  if (window) {
    await runWindowEffect(
      Effect.gen(function* () {
        const windows = yield* WindowService;
        yield* windows
          .sendToWindow(window, AccountManagerIpcChannels.changed, state)
          .pipe(Effect.ignore);
      }),
    );
  }

  return state;
};

const normalizeDraft = (draft: unknown): ManagedAccount => {
  if (typeof draft !== "object" || draft === null) {
    throw new Error("Account draft must be an object");
  }

  const input = draft as Partial<ManagedAccountDraft>;
  const username = normalizeRequiredString(input.username, "username");
  const label =
    typeof input.label === "string" && input.label.trim() !== ""
      ? input.label.trim()
      : username;

  return {
    label,
    username,
    password: normalizeRequiredString(input.password, "password"),
  };
};

const normalizePatch = (patch: unknown): ManagedAccountPatch => {
  if (typeof patch !== "object" || patch === null) {
    throw new Error("Account patch must be an object");
  }

  const input = patch as Partial<ManagedAccountPatch>;
  const output: Record<string, string> = {};

  for (const key of ["label", "username", "password"] as const) {
    if (input[key] !== undefined) {
      output[key] = normalizeRequiredString(input[key], key);
    }
  }

  return output;
};

const scriptName = (script: ScriptExecutePayload | null | undefined): string =>
  script?.name || script?.path || "script";

const scriptRefreshErrorMessage = (
  script: ScriptExecutePayload,
  error: unknown,
): string => {
  const message = error instanceof Error ? error.message : "";
  const name = scriptName(script);
  return message
    ? `Failed to refresh ${name}: ${message}`
    : `Failed to refresh ${name}`;
};

const isScriptPayload = (value: unknown): value is ScriptExecutePayload => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as Partial<ScriptExecutePayload>;
  return (
    typeof payload.source === "string" &&
    (payload.path === undefined || typeof payload.path === "string") &&
    (payload.name === undefined || typeof payload.name === "string")
  );
};

export const normalizeLaunchRequest = (
  request: unknown,
): AccountLaunchRequest => {
  if (typeof request !== "object" || request === null) {
    throw new Error("Launch request must be an object");
  }

  const input = request as Partial<AccountLaunchRequest>;
  const username = normalizeRequiredString(input.username, "username");
  const server = normalizeOptionalString(input.server);
  const script =
    input.script === null || input.script === undefined
      ? null
      : isScriptPayload(input.script)
        ? input.script
        : undefined;

  if (script === undefined) {
    throw new Error("Invalid launch script payload");
  }

  return {
    username,
    script,
    ...(server === "" ? {} : { server }),
    ...(input.tiling === undefined
      ? {}
      : { tiling: normalizeLaunchTilingPlacement(input.tiling) }),
  };
};

const normalizeLaunchTilingPlacement = (
  value: unknown,
): AccountLaunchTilingPlacement => {
  if (typeof value !== "object" || value === null) {
    throw new Error("Launch tiling must be an object");
  }

  const input = value as Partial<AccountLaunchTilingPlacement>;
  if (!isLaunchTilingAlgorithm(input.algorithm)) {
    throw new Error("Invalid launch tiling algorithm");
  }

  const count = input.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
    throw new Error("Launch tiling count must be a positive integer");
  }

  const index = input.index;
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= count
  ) {
    throw new Error("Launch tiling index is out of range");
  }

  return {
    algorithm: input.algorithm,
    index,
    count,
  };
};

const normalizeGameWindowId = (value: unknown): number => {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error("gameWindowId is required");
  }

  return value as number;
};

const normalizeGameWindowTargetRequest = (
  request: unknown,
): AccountGameWindowTargetRequest => {
  if (typeof request !== "object" || request === null) {
    throw new Error("Game window target request must be an object");
  }

  const input = request as Partial<AccountGameWindowTargetRequest>;
  return {
    gameWindowId: normalizeGameWindowId(input.gameWindowId),
  };
};

type AccountRuntimeSessionUpdate = AccountScriptStatusUpdate & {
  readonly gameWindowId: number;
  readonly launchUsername?: string;
};

type GameWindowIdentityCleanupRegistry = Map<number, () => void>;

const setSession = async (
  update: AccountRuntimeSessionUpdate,
  runWindowEffect: WindowEffectRunner,
  repository: AccountManagerRepositoryShape,
  runtime: AccountSessionsShape,
): Promise<void> => {
  const gameWindowId = normalizeGameWindowId(update.gameWindowId);
  const previous = runtime.getSession(gameWindowId);

  runtime.upsertSession(
    mergeAccountSessionDisplayMetadata(previous, {
      gameWindowId,
      ...(update.launchUsername === undefined
        ? {}
        : { launchUsername: update.launchUsername }),
      ...(update.currentUsername === undefined
        ? {}
        : { currentUsername: update.currentUsername }),
      status: update.status,
      updatedAt: now(),
      ...(update.scriptName === undefined
        ? {}
        : { scriptName: update.scriptName }),
      ...(update.message === undefined ? {} : { message: update.message }),
    }),
  );

  await publishStateToAccountManager(runWindowEffect, repository, runtime);
};

const setGameWindowIdentity = async (
  gameWindowId: number,
  currentUsername: string,
  runWindowEffect: WindowEffectRunner,
  repository: AccountManagerRepositoryShape,
  runtime: AccountSessionsShape,
): Promise<boolean> => {
  const previousIdentity = runtime.getGameWindowIdentity(gameWindowId);
  const previousSession = runtime.getSession(gameWindowId);
  const shouldStoreIdentity =
    currentUsername !== "" ||
    previousIdentity !== undefined ||
    previousSession?.currentUsername !== undefined;

  if (
    shouldStoreIdentity &&
    previousIdentity?.currentUsername !== currentUsername
  ) {
    runtime.setGameWindowIdentity(gameWindowId, {
      currentUsername,
      updatedAt: now(),
    });
  }

  if (!runtime.hasSession(gameWindowId)) {
    return runtime.getGameWindowIdentity(gameWindowId) !== undefined;
  }

  if (
    !shouldStoreIdentity ||
    previousSession?.currentUsername === currentUsername
  ) {
    return runtime.getGameWindowIdentity(gameWindowId) !== undefined;
  }

  await setSession(
    {
      gameWindowId,
      currentUsername,
      status: previousSession?.status ?? "idle",
      ...(previousSession?.scriptName === undefined
        ? {}
        : { scriptName: previousSession.scriptName }),
      ...(previousSession?.message === undefined
        ? {}
        : { message: previousSession.message }),
    },
    runWindowEffect,
    repository,
    runtime,
  );
  return runtime.getGameWindowIdentity(gameWindowId) !== undefined;
};

const ensureGameWindowIdentityCleanup = async (
  gameWindowId: number,
  runWindowEffect: WindowEffectRunner,
  runtime: AccountSessionsShape,
  cleanupRegistry: GameWindowIdentityCleanupRegistry,
): Promise<void> => {
  if (cleanupRegistry.has(gameWindowId)) {
    return;
  }

  const gameWindow: GameWindowRef = { kind: "game", id: gameWindowId };
  const removeClosedListener = await runWindowEffect(
    Effect.gen(function* () {
      const windows = yield* WindowService;
      return yield* windows.onWindowClosed(gameWindow, () => {
        runtime.deleteGameWindowIdentity(gameWindowId);
        cleanupRegistry.delete(gameWindowId);
      });
    }),
  ).catch(() => {
    runtime.deleteGameWindowIdentity(gameWindowId);
    return null;
  });

  if (removeClosedListener === null) {
    return;
  }

  cleanupRegistry.set(gameWindowId, () => {
    removeClosedListener();
    runtime.deleteGameWindowIdentity(gameWindowId);
    cleanupRegistry.delete(gameWindowId);
  });
};

const clearSession = async (
  gameWindowId: number,
  runWindowEffect: WindowEffectRunner,
  repository: AccountManagerRepositoryShape,
  runtime: AccountSessionsShape,
): Promise<void> => {
  const normalizedGameWindowId = normalizeGameWindowId(gameWindowId);
  runtime.deleteSession(normalizedGameWindowId);
  runtime.deleteGameWindowIdentity(normalizedGameWindowId);
  await publishStateToAccountManager(runWindowEffect, repository, runtime);
};

const getEventWindowId = (event: IpcMainInvokeEvent): number | null =>
  getSenderWindowId(event.sender) ?? null;

const sendGameLaunchPayload = (
  runWindowEffect: WindowEffectRunner,
  window: GameWindowRef,
  payload: AccountGameLaunchPayload,
): Promise<boolean> =>
  runWindowEffect(
    Effect.gen(function* () {
      const windows = yield* WindowService;
      return yield* windows.sendToWindow(
        window,
        AccountManagerIpcChannels.gameLaunch,
        payload,
      );
    }),
  );

const shutdownErrorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : "Game window shutdown request failed";

const requestGameWindowShutdown = (
  runtime: AccountSessionsShape,
  runWindowEffect: WindowEffectRunner,
  window: GameWindowRef,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const requestId = makeRandomId();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let removeClosedListener: (() => void) | undefined;
    const handleClosed = () => {
      cleanup();
      reject(
        new Error("Game window closed before responding to shutdown request"),
      );
    };
    const cleanup = () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      removeClosedListener?.();
      runtime.deleteShutdownRequest(requestId);
    };

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Game window did not respond to shutdown request"));
    }, ACCOUNT_GAME_WINDOW_SHUTDOWN_TIMEOUT_MS);

    runtime.registerShutdownRequest(requestId, { resolve, reject, cleanup });
    void runWindowEffect(
      Effect.gen(function* () {
        const windows = yield* WindowService;
        removeClosedListener = yield* windows.onWindowClosed(
          window,
          handleClosed,
        );
        yield* windows.sendToWindow(
          window,
          AccountManagerIpcChannels.gameWindowShutdownRequest,
          { requestId, gameWindowId: window.id },
        );
      }),
    ).catch((cause) => {
      cleanup();
      reject(new Error(shutdownErrorMessage(cause), { cause }));
    });
  });

export const handleAccountGameWindowShutdownResponse = (
  response: unknown,
  runtime: AccountSessionsShape,
): void => {
  const shutdownResponse = response as Partial<
    AccountGameWindowShutdownResponse & { readonly error?: unknown }
  >;
  const requestId = shutdownResponse.requestId;
  if (typeof requestId !== "string") {
    return;
  }

  if (shutdownResponse.ok) {
    runtime.resolveShutdownRequest(requestId);
    return;
  }

  runtime.rejectShutdownRequest(
    requestId,
    new Error(
      typeof shutdownResponse.error === "string" &&
        shutdownResponse.error !== ""
        ? shutdownResponse.error
        : "Game window shutdown request failed",
    ),
  );
};

const refreshGameLaunchScript = async (
  payload: AccountGameLaunchPayload,
  scripts: ScriptLibraryShape,
  runtime: AccountSessionsShape,
): Promise<AccountGameLaunchPayload> => {
  if (payload.script === undefined) {
    return payload;
  }

  const script = await Effect.runPromise(scripts.refresh(payload.script));
  const nextPayload: AccountGameLaunchPayload = {
    ...payload,
    script,
  };

  runtime.setGameLaunchPayload(payload.gameWindowId, nextPayload);
  return nextPayload;
};

export interface AccountGameLaunchInput {
  readonly account: ManagedAccount;
  readonly script?: ScriptExecutePayload | null;
  readonly server?: string;
  readonly tiling?: AccountLaunchTilingPlacement;
}

export interface AccountGameLaunchDependencies {
  readonly runWindowEffect: WindowEffectRunner;
  readonly repository: AccountManagerRepositoryShape;
  readonly runtime: AccountSessionsShape;
  readonly scripts: ScriptLibraryShape;
  readonly observability: Pick<DesktopObservabilityShape, "error">;
}

interface TileGridPlacement {
  readonly columns: number;
  readonly rows: number;
  readonly column: number;
  readonly row: number;
}

const resolveAutoGridPlacement = (
  index: number,
  count: number,
): TileGridPlacement => {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return {
    columns,
    rows,
    column: index % columns,
    row: Math.floor(index / columns),
  };
};

const resolveTilePlacement = (
  tiling: AccountLaunchTilingPlacement,
): TileGridPlacement | null => {
  if (tiling.algorithm === "none") {
    return null;
  }

  if (tiling.algorithm === "horizontal") {
    return {
      columns: tiling.count,
      rows: 1,
      column: tiling.index,
      row: 0,
    };
  }

  if (tiling.algorithm === "vertical") {
    return {
      columns: 1,
      rows: tiling.count,
      column: 0,
      row: tiling.index,
    };
  }

  return resolveAutoGridPlacement(tiling.index, tiling.count);
};

export const resolveAccountLaunchTileBounds = (
  workArea: Rectangle,
  tiling: AccountLaunchTilingPlacement,
): Rectangle | null => {
  const placement = resolveTilePlacement(tiling);
  if (placement === null) {
    return null;
  }

  const workAreaRight = workArea.x + workArea.width;
  const workAreaBottom = workArea.y + workArea.height;
  const x = Math.floor(
    workArea.x + (workArea.width * placement.column) / placement.columns,
  );
  const y = Math.floor(
    workArea.y + (workArea.height * placement.row) / placement.rows,
  );
  const nextX = Math.floor(
    workArea.x + (workArea.width * (placement.column + 1)) / placement.columns,
  );
  const nextY = Math.floor(
    workArea.y + (workArea.height * (placement.row + 1)) / placement.rows,
  );

  return {
    x,
    y,
    width: Math.max(1, Math.min(nextX, workAreaRight) - x),
    height: Math.max(1, Math.min(nextY, workAreaBottom) - y),
  };
};

const resolveAccountLaunchInitialBounds = async (
  tiling: AccountLaunchTilingPlacement | undefined,
  runWindowEffect: WindowEffectRunner,
): Promise<Rectangle | undefined> => {
  if (tiling === undefined || tiling.algorithm === "none") {
    return undefined;
  }

  const workArea = await runWindowEffect(
    Effect.gen(function* () {
      const windows = yield* WindowService;
      return yield* windows.getCursorDisplayWorkArea();
    }),
  );
  return resolveAccountLaunchTileBounds(workArea, tiling) ?? undefined;
};

export const startAccountGameLaunch = async (
  input: AccountGameLaunchInput,
  dependencies: AccountGameLaunchDependencies,
): Promise<AccountLaunchResult> => {
  const requestedScript = input.script ?? null;
  const launchScript =
    requestedScript === null
      ? null
      : await Effect.runPromise(dependencies.scripts.refresh(requestedScript));

  const initialBounds = await resolveAccountLaunchInitialBounds(
    input.tiling,
    dependencies.runWindowEffect,
  );
  const gameWindow = await dependencies.runWindowEffect(
    Effect.gen(function* () {
      const windows = yield* WindowService;
      return yield* windows.openGameWindow(
        initialBounds === undefined ? undefined : { bounds: initialBounds },
      );
    }),
  );
  const gameWindowId = gameWindow.id;
  const gameLaunchPayload: AccountGameLaunchPayload = {
    account: input.account,
    ...(launchScript === null ? {} : { script: launchScript }),
    ...(input.server === undefined ? {} : { server: input.server }),
    gameWindowId,
    requestedAt: now(),
  };

  let gameWindowClosed = false;
  const cleanupGameWindowLaunch = (): void => {
    gameWindowClosed = true;
    dependencies.runtime.deleteGameLaunchPayload(gameWindowId);
    void clearSession(
      gameWindowId,
      dependencies.runWindowEffect,
      dependencies.repository,
      dependencies.runtime,
    ).catch((error) => {
      void Effect.runPromise(
        dependencies.observability.error(
          "accounts",
          "Failed to clear account session on close",
          error,
          { gameWindowId },
        ),
      );
    });
  };

  await dependencies.runWindowEffect(
    Effect.gen(function* () {
      const windows = yield* WindowService;
      yield* windows.onWindowClosed(gameWindow, cleanupGameWindowLaunch);
    }),
  );
  dependencies.runtime.setGameLaunchPayload(gameWindowId, gameLaunchPayload);

  await setSession(
    {
      gameWindowId,
      launchUsername: input.account.username,
      status: "starting",
      message:
        launchScript === null
          ? "Signing in"
          : `Queued ${scriptName(launchScript)}`,
      ...(launchScript === null
        ? {}
        : { scriptName: scriptName(launchScript) }),
    },
    dependencies.runWindowEffect,
    dependencies.repository,
    dependencies.runtime,
  );

  const stillOpen = await dependencies.runWindowEffect(
    Effect.gen(function* () {
      const windows = yield* WindowService;
      return yield* windows.getGameWindowRefById(gameWindowId);
    }),
  );
  if (gameWindowClosed || !stillOpen) {
    dependencies.runtime.deleteGameLaunchPayload(gameWindowId);
    await clearSession(
      gameWindowId,
      dependencies.runWindowEffect,
      dependencies.repository,
      dependencies.runtime,
    );
    throw new Error("Game window closed before launch completed");
  }

  await sendGameLaunchPayload(
    dependencies.runWindowEffect,
    gameWindow,
    gameLaunchPayload,
  );

  return { gameWindowId };
};

export interface AccountGameWindowFocusDependencies {
  readonly runWindowEffect: WindowEffectRunner;
  readonly repository: AccountManagerRepositoryShape;
  readonly runtime: AccountSessionsShape;
}

export const focusTrackedAccountGameWindow = async (
  request: unknown,
  dependencies: AccountGameWindowFocusDependencies,
): Promise<AccountManagerState> => {
  const { gameWindowId } = normalizeGameWindowTargetRequest(request);
  if (!dependencies.runtime.hasSession(gameWindowId)) {
    throw new Error("Tracked game window not found");
  }

  const gameWindow = await dependencies.runWindowEffect(
    Effect.gen(function* () {
      const windows = yield* WindowService;
      return yield* windows.getGameWindowRefById(gameWindowId);
    }),
  );

  if (!gameWindow) {
    await clearSession(
      gameWindowId,
      dependencies.runWindowEffect,
      dependencies.repository,
      dependencies.runtime,
    );
    throw new Error("Tracked game window is no longer open");
  }

  await dependencies.runWindowEffect(
    Effect.gen(function* () {
      const windows = yield* WindowService;
      yield* windows.revealWindow(gameWindow);
    }),
  );

  return await toState(dependencies.repository, dependencies.runtime);
};

export interface AccountGameWindowCloseDependencies {
  readonly runWindowEffect: WindowEffectRunner;
  readonly repository: AccountManagerRepositoryShape;
  readonly runtime: AccountSessionsShape;
  readonly observability: DesktopObservabilityShape;
}

export const closeTrackedAccountGameWindow = async (
  request: unknown,
  dependencies: AccountGameWindowCloseDependencies,
): Promise<AccountManagerState> => {
  const { gameWindowId } = normalizeGameWindowTargetRequest(request);
  const session = dependencies.runtime.getSession(gameWindowId);
  if (!session) {
    throw new Error("Tracked game window not found");
  }

  const gameWindow = await dependencies.runWindowEffect(
    Effect.gen(function* () {
      const windows = yield* WindowService;
      return yield* windows.getGameWindowRefById(gameWindowId);
    }),
  );

  if (!gameWindow) {
    await clearSession(
      gameWindowId,
      dependencies.runWindowEffect,
      dependencies.repository,
      dependencies.runtime,
    );
    return await toState(dependencies.repository, dependencies.runtime);
  }

  await setSession(
    {
      gameWindowId,
      ...(session.launchUsername === undefined
        ? {}
        : { launchUsername: session.launchUsername }),
      ...(session.currentUsername === undefined
        ? {}
        : { currentUsername: session.currentUsername }),
      status: session.status,
      ...(session.scriptName === undefined
        ? {}
        : { scriptName: session.scriptName }),
      message: "Closing game client",
    },
    dependencies.runWindowEffect,
    dependencies.repository,
    dependencies.runtime,
  );

  try {
    await requestGameWindowShutdown(
      dependencies.runtime,
      dependencies.runWindowEffect,
      gameWindow,
    );
  } catch (error) {
    await Effect.runPromise(
      dependencies.observability.warn(
        "accounts",
        "Graceful game window shutdown failed; closing anyway",
        {
          gameWindowId,
          error: shutdownErrorMessage(error),
        },
      ),
    );
  }

  await dependencies.runWindowEffect(
    Effect.gen(function* () {
      const windows = yield* WindowService;
      yield* windows.requestCloseGameWindow(gameWindow);
    }),
  );

  return await toState(dependencies.repository, dependencies.runtime);
};

const serverLoadErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "";
  const statusCode = /Failed to fetch servers: (\d{3})/.exec(message)?.[1];

  return statusCode === undefined
    ? message || "Unable to load servers"
    : `Unable to load login servers (HTTP ${statusCode})`;
};

const runAccountServersEffect = async (
  runtime: AccountSessionsShape,
  effect: Effect.Effect<readonly ServerData[], unknown>,
): Promise<AccountGameServersResult> => {
  try {
    const servers = await Effect.runPromise(effect);
    return {
      refreshAvailableAt: runtime.getServerRefreshAvailableAt(
        ACCOUNT_SERVER_REFRESH_COOLDOWN_MS,
      ),
      servers: servers.map(toAccountGameServer),
    };
  } catch (error) {
    throw new Error(serverLoadErrorMessage(error), { cause: error });
  }
};

const runAccountServerPingsEffect = async (
  runtime: AccountSessionsShape,
  effect: Effect.Effect<readonly ServerData[], unknown>,
): Promise<AccountGameServerPingsResult> => {
  try {
    const servers = await Effect.runPromise(effect);
    const cacheKey = accountServerPingCacheKey(servers);
    const timestamp = now();
    const cached = runtime.getServerPingCache();

    if (
      cached !== null &&
      cached.cacheKey === cacheKey &&
      timestamp < cached.result.expiresAt
    ) {
      return cached.result;
    }

    const pings = await pingAccountServers(servers);
    const measuredAt = now();
    const result: AccountGameServerPingsResult = {
      expiresAt: measuredAt + ACCOUNT_SERVER_PING_CACHE_TTL_MS,
      measuredAt,
      pings,
    };

    runtime.setCachedServerPings({
      cacheKey,
      result,
    });

    return result;
  } catch (error) {
    throw new Error(serverLoadErrorMessage(error), { cause: error });
  }
};

export const registerAccountManagerIpcHandlers = (
  runWindowEffect: WindowEffectRunner,
): Effect.Effect<
  void,
  never,
  | AccountManagerRepository
  | AccountSessions
  | DesktopIpc
  | DesktopObservability
  | ScriptLibrary
  | Scope.Scope
> =>
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc;
    const observability = yield* DesktopObservability;
    const runtime = yield* AccountSessions;
    const gameWindowIdentityCleanupRegistry: GameWindowIdentityCleanupRegistry =
      new Map();

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const removeCleanup of gameWindowIdentityCleanupRegistry.values()) {
          removeCleanup();
        }
        gameWindowIdentityCleanupRegistry.clear();
      }),
    );

    const withServices = <A>(
      run: (services: {
        readonly repository: AccountManagerRepositoryShape;
        readonly runtime: AccountSessionsShape;
        readonly scripts: ScriptLibraryShape;
      }) => Promise<A>,
    ) =>
      Effect.gen(function* () {
        const repository = yield* AccountManagerRepository;
        const scripts = yield* ScriptLibrary;
        return yield* Effect.promise(() =>
          run({ repository, runtime, scripts }),
        );
      });

    yield* ipc.on(
      AccountManagerIpcChannels.gameWindowShutdownResponse,
      (event, response) =>
        Effect.promise(() =>
          runWindowEffect(requireGameWindowSender(event.sender)),
        ).pipe(
          Effect.flatMap(() =>
            Effect.sync(() => {
              handleAccountGameWindowShutdownResponse(response, runtime);
            }),
          ),
        ),
    );

    yield* ipc.handle(AccountManagerIpcChannels.getState, (event) =>
      withServices(async ({ repository }) => {
        // Full account state includes passwords; only Account Manager can request it.
        await requireAccountManagerSender(event, runWindowEffect);
        return await toState(repository, runtime);
      }),
    );

    yield* ipc.handle(AccountManagerIpcChannels.getServers, () =>
      Effect.promise(() =>
        runAccountServersEffect(
          runtime,
          getCachedAccountServers(runtime, observability),
        ),
      ),
    );

    yield* ipc.handle(AccountManagerIpcChannels.getServerPings, () =>
      Effect.promise(() =>
        runAccountServerPingsEffect(
          runtime,
          getCachedAccountServers(runtime, observability),
        ),
      ),
    );

    yield* ipc.handle(AccountManagerIpcChannels.refreshServers, () =>
      Effect.promise(async () => {
        const timestamp = now();
        if (
          !runtime.canRefreshServers(
            timestamp,
            ACCOUNT_SERVER_REFRESH_COOLDOWN_MS,
          )
        ) {
          return await runAccountServersEffect(
            runtime,
            getCachedAccountServers(runtime, observability),
          );
        }

        runtime.markServerRefreshRequest(timestamp);
        runtime.resetServerPingCache();
        return await runAccountServersEffect(
          runtime,
          refreshAccountServers(runtime, observability),
        );
      }),
    );

    yield* ipc.handle(AccountManagerIpcChannels.getGameLaunch, (event) =>
      withServices(async ({ repository, scripts }) => {
        const gameWindowId = getEventWindowId(event);
        if (gameWindowId === null) {
          return null;
        }

        const payload = runtime.getGameLaunchPayload(gameWindowId);
        if (!payload) {
          return null;
        }

        try {
          return await refreshGameLaunchScript(payload, scripts, runtime);
        } catch (error) {
          if (payload.script !== undefined) {
            await setSession(
              {
                gameWindowId,
                launchUsername: payload.account.username,
                status: "failed",
                scriptName: scriptName(payload.script),
                message: scriptRefreshErrorMessage(payload.script, error),
              },
              runWindowEffect,
              repository,
              runtime,
            );
          }
          throw error;
        }
      }),
    );

    yield* ipc.handle(AccountManagerIpcChannels.createAccount, (event, draft) =>
      withServices(async ({ repository }) => {
        await requireAccountManagerSender(event, runWindowEffect);
        const accountDraft = normalizeDraft(draft);
        await updateStorage(repository, (storage) => {
          if (hasAccountUsername(storage.accounts, accountDraft.username)) {
            throw new Error("An account with this username already exists");
          }

          return {
            ...storage,
            accounts: [...storage.accounts, accountDraft],
          };
        });

        return await publishStateToAccountManager(
          runWindowEffect,
          repository,
          runtime,
        );
      }),
    );

    yield* ipc.handle(
      AccountManagerIpcChannels.updateAccount,
      (event, username, patch) =>
        withServices(async ({ repository }) => {
          await requireAccountManagerSender(event, runWindowEffect);
          const currentUsername = normalizeRequiredString(username, "username");
          const accountPatch = normalizePatch(patch);
          const nextUsername = accountPatch.username ?? currentUsername;
          await updateStorage(repository, (storage) => {
            if (
              hasAccountUsername(storage.accounts, nextUsername, {
                exceptUsername: currentUsername,
              })
            ) {
              throw new Error("An account with this username already exists");
            }

            let found = false;
            const nextAccounts = storage.accounts.map((account) => {
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
              throw new Error("Account not found");
            }

            return {
              accounts: nextAccounts,
              groups: renameGroupMemberUsername(
                storage.groups,
                currentUsername,
                nextUsername,
              ),
            };
          });

          return await publishStateToAccountManager(
            runWindowEffect,
            repository,
            runtime,
          );
        }),
    );

    yield* ipc.handle(
      AccountManagerIpcChannels.deleteAccount,
      (event, username) =>
        withServices(async ({ repository }) => {
          await requireAccountManagerSender(event, runWindowEffect);
          const accountUsername = normalizeRequiredString(username, "username");
          await updateStorage(repository, (storage) => {
            const nextAccounts = storage.accounts.filter(
              (account) => account.username !== accountUsername,
            );

            if (nextAccounts.length === storage.accounts.length) {
              throw new Error("Account not found");
            }

            return {
              accounts: nextAccounts,
              groups: removeGroupMemberUsername(
                storage.groups,
                accountUsername,
              ),
            };
          });
          return await publishStateToAccountManager(
            runWindowEffect,
            repository,
            runtime,
          );
        }),
    );

    yield* ipc.handle(AccountManagerIpcChannels.createGroup, (event, draft) =>
      withServices(async ({ repository }) => {
        await requireAccountManagerSender(event, runWindowEffect);
        await updateStorage(repository, (storage) => {
          const groupDraft = normalizeGroupDraft(draft, storage.accounts);
          if (hasGroupName(storage.groups, groupDraft.name)) {
            throw new Error("A group with this name already exists");
          }

          return {
            ...storage,
            groups: {
              ...storage.groups,
              [groupDraft.name]: groupDraft.usernames,
            },
          };
        });

        return await publishStateToAccountManager(
          runWindowEffect,
          repository,
          runtime,
        );
      }),
    );

    yield* ipc.handle(
      AccountManagerIpcChannels.updateGroup,
      (event, name, patch) =>
        withServices(async ({ repository }) => {
          await requireAccountManagerSender(event, runWindowEffect);
          const currentName = normalizeRequiredString(name, "group name");
          await updateStorage(repository, (storage) => {
            const existingName = findGroupName(storage.groups, currentName);
            if (existingName === undefined) {
              throw new Error("Group not found");
            }

            const groupPatch = normalizeGroupPatch(patch, storage.accounts);
            const nextName = groupPatch.name ?? existingName;
            if (
              hasGroupName(storage.groups, nextName, {
                exceptName: existingName,
              })
            ) {
              throw new Error("A group with this name already exists");
            }

            const groups: Record<string, readonly string[]> = {};
            for (const [groupName, usernames] of Object.entries(
              storage.groups,
            )) {
              if (groupName === existingName) {
                groups[nextName] = groupPatch.usernames ?? usernames;
              } else {
                groups[groupName] = usernames;
              }
            }

            return {
              ...storage,
              groups,
            };
          });

          return await publishStateToAccountManager(
            runWindowEffect,
            repository,
            runtime,
          );
        }),
    );

    yield* ipc.handle(AccountManagerIpcChannels.deleteGroup, (event, name) =>
      withServices(async ({ repository }) => {
        await requireAccountManagerSender(event, runWindowEffect);
        const groupName = normalizeRequiredString(name, "group name");
        await updateStorage(repository, (storage) => {
          const existingName = findGroupName(storage.groups, groupName);
          if (existingName === undefined) {
            throw new Error("Group not found");
          }

          const groups: Record<string, readonly string[]> = {};
          for (const [name, usernames] of Object.entries(storage.groups)) {
            if (name !== existingName) {
              groups[name] = usernames;
            }
          }

          return {
            ...storage,
            groups,
          };
        });

        return await publishStateToAccountManager(
          runWindowEffect,
          repository,
          runtime,
        );
      }),
    );

    yield* ipc.handle(AccountManagerIpcChannels.launch, (event, request) =>
      withServices(async ({ repository, scripts }) => {
        await requireAccountManagerSender(event, runWindowEffect);
        const launchRequest = normalizeLaunchRequest(request);
        const accounts = await readAccounts(repository);
        const account = accounts.find(
          (candidate) => candidate.username === launchRequest.username,
        );

        if (!account) {
          throw new Error("Account not found");
        }

        return await startAccountGameLaunch(
          {
            account,
            ...(launchRequest.script === undefined
              ? {}
              : { script: launchRequest.script }),
            ...(launchRequest.server === undefined
              ? {}
              : { server: launchRequest.server }),
            ...(launchRequest.tiling === undefined
              ? {}
              : { tiling: launchRequest.tiling }),
          },
          {
            runWindowEffect,
            repository,
            runtime,
            scripts,
            observability,
          },
        );
      }),
    );

    yield* ipc.handle(
      AccountManagerIpcChannels.focusGameWindow,
      (event, request) =>
        withServices(async ({ repository }) => {
          await requireAccountManagerSender(event, runWindowEffect);
          return await focusTrackedAccountGameWindow(request, {
            runWindowEffect,
            repository,
            runtime,
          });
        }),
    );

    yield* ipc.handle(
      AccountManagerIpcChannels.closeGameWindow,
      (event, request) =>
        withServices(async ({ repository }) => {
          await requireAccountManagerSender(event, runWindowEffect);
          return await closeTrackedAccountGameWindow(request, {
            runWindowEffect,
            repository,
            runtime,
            observability,
          });
        }),
    );

    yield* ipc.handle(
      AccountManagerIpcChannels.updateScriptStatus,
      (event, update) =>
        withServices(async ({ repository }) => {
          await runWindowEffect(requireGameWindowSender(event.sender));
          if (typeof update !== "object" || update === null) {
            throw new Error("Status update must be an object");
          }

          const gameWindowId = getEventWindowId(event);
          if (gameWindowId === null) {
            throw new Error("Missing sender game window");
          }

          if (!runtime.hasSession(gameWindowId)) {
            return;
          }

          const input = update as Partial<AccountScriptStatusUpdate>;
          const status = input.status;
          if (
            status !== "idle" &&
            status !== "starting" &&
            status !== "running" &&
            status !== "stopped" &&
            status !== "failed"
          ) {
            throw new Error("Invalid script status");
          }

          const hasCurrentUsername = hasOwn(input, "currentUsername");
          const currentUsername = hasCurrentUsername
            ? normalizeOptionalString(input.currentUsername)
            : undefined;
          const previousSession = runtime.getSession(gameWindowId);
          const shouldIncludeCurrentUsername =
            hasCurrentUsername &&
            (currentUsername !== "" ||
              previousSession?.currentUsername !== undefined);
          const scriptName = optionalTrimmedString(input.scriptName);
          const message = optionalTrimmedString(input.message);
          const sessionUpdate: AccountRuntimeSessionUpdate = {
            status,
            gameWindowId,
            ...(shouldIncludeCurrentUsername
              ? { currentUsername: currentUsername ?? "" }
              : {}),
            ...(scriptName === undefined ? {} : { scriptName }),
            ...(message === undefined ? {} : { message }),
          };

          await setSession(sessionUpdate, runWindowEffect, repository, runtime);
        }),
    );

    yield* ipc.handle(
      AccountManagerIpcChannels.updateGameWindowIdentity,
      (event, update) =>
        withServices(async ({ repository }) => {
          await runWindowEffect(requireGameWindowSender(event.sender));
          if (typeof update !== "object" || update === null) {
            throw new Error("Identity update must be an object");
          }

          const gameWindowId = getEventWindowId(event);
          if (gameWindowId === null) {
            throw new Error("Missing sender game window");
          }

          const input = update as Partial<AccountGameWindowIdentityUpdate>;
          const hasIdentity = await setGameWindowIdentity(
            gameWindowId,
            normalizeOptionalString(input.currentUsername),
            runWindowEffect,
            repository,
            runtime,
          );
          if (hasIdentity) {
            await ensureGameWindowIdentityCleanup(
              gameWindowId,
              runWindowEffect,
              runtime,
              gameWindowIdentityCleanupRegistry,
            );
          }
        }),
    );
  });
