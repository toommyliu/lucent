import { Schema } from "effect";

import { ScriptInputsDefinitionSchema } from "./scriptInputs";

export const ACCOUNT_MANAGER_STORAGE_FILE = "accounts.json";
export const ACCOUNT_SERVER_REFRESH_COOLDOWN_MS = 15_000;

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

export const ScriptExecutePayloadSchema = Schema.Struct({
  source: Schema.String,
  path: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  inputs: Schema.optionalKey(Schema.NullOr(ScriptInputsDefinitionSchema)),
});

export type ScriptExecutePayload = typeof ScriptExecutePayloadSchema.Type;

export const AccountScriptStatusSchema = Schema.Literals([
  "idle",
  "starting",
  "running",
  "stopped",
  "failed",
]);

export type AccountScriptStatus = typeof AccountScriptStatusSchema.Type;

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

export const AccountScriptSessionSchema = Schema.Struct({
  gameWindowId: Schema.Number,
  launchUsername: Schema.optionalKey(Schema.String),
  currentUsername: Schema.optionalKey(Schema.String),
  scriptName: Schema.optionalKey(Schema.String),
  status: AccountScriptStatusSchema,
  message: Schema.optionalKey(Schema.String),
  updatedAt: Schema.Number,
});

export type AccountScriptSession = typeof AccountScriptSessionSchema.Type;

export const AccountManagerStateSchema = Schema.Struct({
  accounts: Schema.Array(ManagedAccountSchema),
  groups: ManagedAccountGroupsSchema,
  sessions: Schema.Array(AccountScriptSessionSchema),
  storagePath: Schema.String,
});

export type AccountManagerState = typeof AccountManagerStateSchema.Type;

export const AccountLaunchTilingAlgorithmSchema = Schema.Literals([
  "none",
  "auto-grid",
  "horizontal",
  "vertical",
]);

export type AccountLaunchTilingAlgorithm =
  typeof AccountLaunchTilingAlgorithmSchema.Type;

export const AccountLaunchTilingPlacementSchema = Schema.Struct({
  algorithm: AccountLaunchTilingAlgorithmSchema,
  index: Schema.Number,
  count: Schema.Number,
});

export type AccountLaunchTilingPlacement =
  typeof AccountLaunchTilingPlacementSchema.Type;

export const AccountLaunchRequestSchema = Schema.Struct({
  username: Schema.String,
  script: Schema.optionalKey(Schema.NullOr(ScriptExecutePayloadSchema)),
  server: Schema.optionalKey(Schema.String),
  tiling: Schema.optionalKey(AccountLaunchTilingPlacementSchema),
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
  script: Schema.optionalKey(ScriptExecutePayloadSchema),
  server: Schema.optionalKey(Schema.String),
  gameWindowId: Schema.Number,
  requestedAt: Schema.Number,
});

export type AccountGameLaunchPayload =
  typeof AccountGameLaunchPayloadSchema.Type;

export const AccountScriptStatusUpdateSchema = Schema.Struct({
  currentUsername: Schema.optionalKey(Schema.String),
  scriptName: Schema.optionalKey(Schema.String),
  status: AccountScriptStatusSchema,
  message: Schema.optionalKey(Schema.String),
});

export type AccountScriptStatusUpdate =
  typeof AccountScriptStatusUpdateSchema.Type;

export interface AccountManagerStorage {
  readonly accounts: readonly ManagedAccount[];
  readonly groups: ManagedAccountGroups;
}

const emptyStorage: AccountManagerStorage = {
  accounts: [],
  groups: {},
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isManagedAccount = (value: unknown): value is ManagedAccount => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["label"] === "string" &&
    typeof value["username"] === "string" &&
    typeof value["password"] === "string"
  );
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
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeAccountsByUsername(
    value.filter(isManagedAccount).map(normalizeStoredAccount),
  );
};

const normalizeStoredGroupMembers = (
  value: unknown,
  accounts: readonly ManagedAccount[],
): readonly string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const accountUsernames = new Set(accounts.map((account) => account.username));
  const seen = new Set<string>();
  const usernames: string[] = [];

  for (const member of value) {
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
  if (!isRecord(value)) {
    return {};
  }

  const groups: Record<string, readonly string[]> = {};
  const seen = new Set<string>();

  for (const [rawName, rawMembers] of Object.entries(value)) {
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
  if (!isRecord(value)) {
    return emptyStorage;
  }

  const accounts = normalizeAccounts(value["accounts"]);

  return {
    accounts,
    groups: normalizeGroups(value["groups"], accounts),
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
