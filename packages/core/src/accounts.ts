import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ScriptFileReferenceSchema } from "./scriptInputs";

export const ManagedAccountSchema = Schema.Struct({
  label: Schema.String,
  username: Schema.String,
  password: Schema.String,
});

export type ManagedAccount = typeof ManagedAccountSchema.Type;

export const ManagedAccountDraftSchema = Schema.Struct({
  label: Schema.optionalKey(Schema.String),
  username: Schema.String,
  password: Schema.String,
});

export type ManagedAccountDraft = typeof ManagedAccountDraftSchema.Type;

export const ManagedAccountPatchSchema = Schema.Struct({
  label: Schema.optionalKey(Schema.String),
  username: Schema.optionalKey(Schema.String),
  password: Schema.optionalKey(Schema.String),
});

export type ManagedAccountPatch = typeof ManagedAccountPatchSchema.Type;

export const ManagedAccountGroupsSchema = Schema.Record(
  Schema.String,
  Schema.Array(Schema.String),
);

export type ManagedAccountGroups = typeof ManagedAccountGroupsSchema.Type;

export const ManagedAccountGroupDraftSchema = Schema.Struct({
  name: Schema.String,
  usernames: Schema.Array(Schema.String),
});

export type ManagedAccountGroupDraft =
  typeof ManagedAccountGroupDraftSchema.Type;

export const ManagedAccountGroupPatchSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  usernames: Schema.optionalKey(Schema.Array(Schema.String)),
});

export type ManagedAccountGroupPatch =
  typeof ManagedAccountGroupPatchSchema.Type;

export const AccountScriptReferenceSchema = ScriptFileReferenceSchema;

export type AccountScriptReference = typeof AccountScriptReferenceSchema.Type;

export const AccountScriptStatusSchema = Schema.Literals([
  "idle",
  "starting",
  "running",
  "stopped",
  "failed",
]);

export type AccountScriptStatus = typeof AccountScriptStatusSchema.Type;

export const AccountGameConnectionStateSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("offline"),
    lastUsername: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    state: Schema.Literal("connecting"),
    lastUsername: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    state: Schema.Literal("online"),
    username: Schema.String,
  }),
]);

export type AccountGameConnectionState =
  typeof AccountGameConnectionStateSchema.Type;

export const AccountGameLoginStateSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("idle") }),
  Schema.Struct({ state: Schema.Literal("waiting-for-game") }),
  Schema.Struct({ state: Schema.Literal("authenticating") }),
  Schema.Struct({
    state: Schema.Literal("connecting"),
    server: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ state: Schema.Literal("waiting-for-player") }),
  Schema.Struct({ state: Schema.Literal("select-server") }),
  Schema.Struct({
    state: Schema.Literal("failed"),
    message: Schema.String,
  }),
]);

export type AccountGameLoginState = typeof AccountGameLoginStateSchema.Type;

export const AccountGameScriptStateSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("idle") }),
  Schema.Struct({
    state: Schema.Literal("starting"),
    name: Schema.optionalKey(Schema.String),
    message: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    state: Schema.Literal("running"),
    name: Schema.optionalKey(Schema.String),
    message: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    state: Schema.Literal("stopped"),
    name: Schema.optionalKey(Schema.String),
    reason: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    state: Schema.Literal("failed"),
    name: Schema.optionalKey(Schema.String),
    message: Schema.String,
  }),
]);

export type AccountGameScriptState = typeof AccountGameScriptStateSchema.Type;

export const AccountGameServerSchema = Schema.Struct({
  name: Schema.String,
  language: Schema.String,
  online: Schema.Boolean,
  upgrade: Schema.Boolean,
  playerCount: Schema.Number,
  maxPlayers: Schema.Number,
});

export type AccountGameServer = typeof AccountGameServerSchema.Type;

export const AccountGameServersResultSchema = Schema.Struct({
  servers: Schema.Array(AccountGameServerSchema),
  refreshAvailableAt: Schema.Number,
});

export type AccountGameServersResult =
  typeof AccountGameServersResultSchema.Type;

export const AccountGameServerPingSchema = Schema.Union([
  Schema.Struct({
    serverName: Schema.String,
    status: Schema.Literal("ok"),
    latencyMs: Schema.Number,
  }),
  Schema.Struct({
    serverName: Schema.String,
    status: Schema.Literals(["offline", "timeout", "unreachable"]),
  }),
]);

export type AccountGameServerPing = typeof AccountGameServerPingSchema.Type;

export const AccountGameServerPingsResultSchema = Schema.Struct({
  pings: Schema.Array(AccountGameServerPingSchema),
  measuredAt: Schema.Number,
  expiresAt: Schema.Number,
});

export type AccountGameServerPingsResult =
  typeof AccountGameServerPingsResultSchema.Type;

export const AccountGameLaunchIntentSchema = Schema.Struct({
  username: Schema.String,
  script: Schema.optionalKey(AccountScriptReferenceSchema),
  server: Schema.optionalKey(Schema.String),
  requestedAt: Schema.Number,
});

export type AccountGameLaunchIntent = typeof AccountGameLaunchIntentSchema.Type;

export const AccountGameSessionReportSchema = Schema.Struct({
  rendererGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  connection: AccountGameConnectionStateSchema,
  login: AccountGameLoginStateSchema,
  script: AccountGameScriptStateSchema,
});

export type AccountGameSessionReport =
  typeof AccountGameSessionReportSchema.Type;

export const AccountGameSessionSchema = Schema.Struct({
  gameWindowId: Schema.Number,
  gameWindowGroupId: Schema.optionalKey(Schema.Number),
  rendererGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  launch: Schema.optionalKey(AccountGameLaunchIntentSchema),
  connection: AccountGameConnectionStateSchema,
  login: AccountGameLoginStateSchema,
  script: AccountGameScriptStateSchema,
  updatedAt: Schema.Number,
});

export type AccountGameSession = typeof AccountGameSessionSchema.Type;

export const AccountManagerStateSchema = Schema.Struct({
  accounts: Schema.Array(ManagedAccountSchema),
  groups: ManagedAccountGroupsSchema,
  sessions: Schema.Array(AccountGameSessionSchema),
  storagePath: Schema.String,
});

export type AccountManagerState = typeof AccountManagerStateSchema.Type;

export const AccountWindowTilingAlgorithmSchema = Schema.Literals([
  "auto-grid",
  "horizontal",
  "vertical",
]);

export type AccountWindowTilingAlgorithm =
  typeof AccountWindowTilingAlgorithmSchema.Type;

export const AccountLaunchTilingAlgorithmSchema = Schema.Union([
  Schema.Literal("none"),
  AccountWindowTilingAlgorithmSchema,
]);

export type AccountLaunchTilingAlgorithm =
  typeof AccountLaunchTilingAlgorithmSchema.Type;

const AccountLaunchTilingCountSchema = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(2),
);

export const AccountLaunchTilingPlacementSchema = Schema.Struct({
  algorithm: AccountWindowTilingAlgorithmSchema,
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  count: AccountLaunchTilingCountSchema,
}).check(
  Schema.makeFilter(({ count, index }) => index < count, {
    expected: "tiling index to be less than tiling count",
  }),
);

export type AccountLaunchTilingPlacement =
  typeof AccountLaunchTilingPlacementSchema.Type;

export const AccountLaunchWindowTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("new") }),
  Schema.Struct({
    kind: Schema.Literal("same-as-game"),
    gameWindowId: Schema.Number,
  }),
]);

export type AccountLaunchWindowTarget =
  typeof AccountLaunchWindowTargetSchema.Type;

export const AccountLaunchRequestSchema = Schema.Struct({
  username: Schema.String,
  script: Schema.optionalKey(Schema.NullOr(AccountScriptReferenceSchema)),
  server: Schema.optionalKey(Schema.String),
  tiling: Schema.optionalKey(AccountLaunchTilingPlacementSchema),
  windowTarget: Schema.optionalKey(AccountLaunchWindowTargetSchema),
});

export type AccountLaunchRequest = typeof AccountLaunchRequestSchema.Type;

export const AccountLaunchResultSchema = Schema.Struct({
  gameWindowId: Schema.Number,
});

export type AccountLaunchResult = typeof AccountLaunchResultSchema.Type;

export const AccountGameWindowTargetRequestSchema = Schema.Struct({
  gameWindowId: Schema.Number,
});

export type AccountGameWindowTargetRequest =
  typeof AccountGameWindowTargetRequestSchema.Type;

export const AccountGameLaunchPayloadSchema = Schema.Struct({
  account: ManagedAccountSchema,
  script: Schema.optionalKey(AccountScriptReferenceSchema),
  server: Schema.optionalKey(Schema.String),
  gameWindowId: Schema.Number,
  requestedAt: Schema.Number,
});

export type AccountGameLaunchPayload =
  typeof AccountGameLaunchPayloadSchema.Type;

export interface AccountManagerStorage {
  readonly accounts: readonly ManagedAccount[];
  readonly groups: ManagedAccountGroups;
}

const emptyStorage: AccountManagerStorage = {
  accounts: [],
  groups: {},
};

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const UnknownArraySchema = Schema.Array(Schema.Unknown);
const decodeUnknownArray = Schema.decodeUnknownOption(UnknownArraySchema);
const decodeUnknownRecord = Schema.decodeUnknownOption(UnknownRecordSchema);
const isManagedAccount = Schema.is(ManagedAccountSchema);

const decodeArrayOrEmpty = (value: unknown): readonly unknown[] => {
  const decoded = decodeUnknownArray(value);
  return Option.isSome(decoded) ? decoded.value : [];
};

const decodeRecordOrEmpty = (
  value: unknown,
): Readonly<Record<string, unknown>> => {
  const decoded = decodeUnknownRecord(value);
  return Option.isSome(decoded) ? decoded.value : {};
};

export const normalizeStoredAccount = (
  account: ManagedAccount,
): ManagedAccount => ({
  label: account.label,
  username: account.username,
  password: account.password,
});

export const dedupeAccountsByUsername = (
  accounts: readonly ManagedAccount[],
): readonly ManagedAccount[] => {
  const seen = new Set<string>();
  const nextAccounts: ManagedAccount[] = [];

  for (const account of accounts) {
    const key = account.username.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextAccounts.push(account);
  }

  return nextAccounts;
};

const normalizeAccounts = (value: unknown): readonly ManagedAccount[] => {
  return dedupeAccountsByUsername(
    decodeArrayOrEmpty(value)
      .filter(isManagedAccount)
      .map(normalizeStoredAccount),
  );
};

const normalizeStoredGroupMembers = (
  value: unknown,
  accounts: readonly ManagedAccount[],
): readonly string[] => {
  const accountUsernames = new Set(accounts.map((account) => account.username));
  const seen = new Set<string>();
  const usernames: string[] = [];

  for (const member of decodeArrayOrEmpty(value)) {
    if (typeof member !== "string" || !accountUsernames.has(member)) {
      continue;
    }

    const key = member.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    usernames.push(member);
  }

  return usernames;
};

const normalizeGroups = (
  value: unknown,
  accounts: readonly ManagedAccount[],
): ManagedAccountGroups => {
  const groups: Record<string, readonly string[]> = {};
  const seen = new Set<string>();

  for (const [rawName, rawMembers] of Object.entries(
    decodeRecordOrEmpty(value),
  )) {
    const name = rawName.trim();
    const key = name.toLowerCase();
    if (name === "" || seen.has(key)) {
      continue;
    }

    seen.add(key);
    groups[name] = normalizeStoredGroupMembers(rawMembers, accounts);
  }

  return groups;
};

export const normalizeAccountManagerStorage = (
  value: unknown,
): AccountManagerStorage => {
  const storage = decodeUnknownRecord(value);
  if (Option.isNone(storage)) {
    return emptyStorage;
  }
  const accounts = normalizeAccounts(storage.value["accounts"]);

  return {
    accounts,
    groups: normalizeGroups(storage.value["groups"], accounts),
  };
};

export const renameGroupMemberUsername = (
  groups: ManagedAccountGroups,
  currentUsername: string,
  nextUsername: string,
): ManagedAccountGroups => {
  if (currentUsername === nextUsername) {
    return groups;
  }

  const nextGroups: Record<string, readonly string[]> = {};
  for (const [name, usernames] of Object.entries(groups)) {
    const seen = new Set<string>();
    const nextUsernames: string[] = [];
    for (const username of usernames) {
      const next = username === currentUsername ? nextUsername : username;
      const key = next.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      nextUsernames.push(next);
    }
    nextGroups[name] = nextUsernames;
  }

  return nextGroups;
};

export const removeGroupMemberUsername = (
  groups: ManagedAccountGroups,
  accountUsername: string,
): ManagedAccountGroups => {
  const nextGroups: Record<string, readonly string[]> = {};
  for (const [name, usernames] of Object.entries(groups)) {
    nextGroups[name] = usernames.filter(
      (username) => username !== accountUsername,
    );
  }

  return nextGroups;
};

export const serializeAccountManagerStorage = (
  storage: AccountManagerStorage,
): AccountManagerStorage => {
  const accounts = dedupeAccountsByUsername(
    storage.accounts.map(normalizeStoredAccount),
  );
  return {
    accounts,
    groups: normalizeGroups(storage.groups, accounts),
  };
};

export const emptyAccountManagerStorage = (): AccountManagerStorage =>
  normalizeAccountManagerStorage(emptyStorage);

const accountScriptName = (
  script: AccountScriptReference | undefined,
): string | undefined => {
  const name = script?.name?.trim();
  if (name !== undefined && name !== "") return name;
  const path = script?.path?.trim();
  return path === undefined || path === "" ? undefined : path;
};

export interface AccountGameSessionPresentation {
  readonly username?: string;
  readonly scriptName?: string;
  readonly status: AccountScriptStatus;
  readonly message?: string;
}

/** Derives the Account Manager's compact status view from runtime state. */
export const presentAccountGameSession = (
  session: AccountGameSession,
): AccountGameSessionPresentation => {
  const scriptName = accountScriptName(session.launch?.script);
  const username =
    session.connection.state === "online"
      ? session.connection.username
      : session.connection.state === "offline" ||
          session.connection.state === "connecting"
        ? (session.connection.lastUsername ?? session.launch?.username)
        : session.launch?.username;

  if (session.login.state === "select-server") {
    return {
      ...(username === undefined ? {} : { username }),
      ...(scriptName === undefined ? {} : { scriptName }),
      message: "Select a server",
      status: "stopped",
    };
  }

  if (session.login.state === "failed") {
    return {
      ...(username === undefined ? {} : { username }),
      ...(scriptName === undefined ? {} : { scriptName }),
      message: session.login.message,
      status: "failed",
    };
  }

  switch (session.login.state) {
    case "waiting-for-game":
      return {
        ...(username === undefined ? {} : { username }),
        ...(scriptName === undefined ? {} : { scriptName }),
        message: "Waiting...",
        status: "starting",
      };
    case "authenticating":
      return {
        ...(username === undefined ? {} : { username }),
        ...(scriptName === undefined ? {} : { scriptName }),
        message: "Logging in...",
        status: "starting",
      };
    case "connecting":
      return {
        ...(username === undefined ? {} : { username }),
        ...(scriptName === undefined ? {} : { scriptName }),
        message:
          session.login.server === undefined
            ? "Connecting..."
            : `Connecting to ${session.login.server}...`,
        status: "starting",
      };
    case "waiting-for-player":
      return {
        ...(username === undefined ? {} : { username }),
        ...(scriptName === undefined ? {} : { scriptName }),
        message: "Waiting for player...",
        status: "starting",
      };
    case "idle":
      break;
  }

  switch (session.script.state) {
    case "starting":
      return {
        ...(username === undefined ? {} : { username }),
        ...(session.script.name === undefined
          ? scriptName === undefined
            ? {}
            : { scriptName }
          : { scriptName: session.script.name }),
        ...(session.script.message === undefined
          ? {}
          : { message: session.script.message }),
        status: "starting",
      };
    case "running":
      return {
        ...(username === undefined ? {} : { username }),
        ...(session.script.name === undefined
          ? scriptName === undefined
            ? {}
            : { scriptName }
          : { scriptName: session.script.name }),
        ...(session.script.message === undefined
          ? {}
          : { message: session.script.message }),
        status: "running",
      };
    case "failed":
      return {
        ...(username === undefined ? {} : { username }),
        ...(session.script.name === undefined
          ? scriptName === undefined
            ? {}
            : { scriptName }
          : { scriptName: session.script.name }),
        message: session.script.message,
        status: "failed",
      };
    case "stopped":
      return {
        ...(username === undefined ? {} : { username }),
        ...(session.script.name === undefined
          ? scriptName === undefined
            ? {}
            : { scriptName }
          : { scriptName: session.script.name }),
        ...(session.script.reason === undefined
          ? {}
          : { message: session.script.reason }),
        status: "stopped",
      };
    case "idle":
      return {
        ...(username === undefined ? {} : { username }),
        ...(scriptName === undefined ? {} : { scriptName }),
        ...(session.connection.state === "online"
          ? { message: "Logged in" }
          : {}),
        status: session.connection.state === "connecting" ? "starting" : "idle",
      };
  }
};
