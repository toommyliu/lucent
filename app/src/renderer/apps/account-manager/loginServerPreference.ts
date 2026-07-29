import type { AccountGameServer } from "@lucent/core/accounts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  readLocalStorageValue,
  writeLocalStorageValue,
} from "../../localStorage";

const AccountLoginServerPreferenceSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("none"),
  }),
  Schema.Struct({
    type: Schema.Literal("server"),
    name: Schema.String.check(Schema.isPattern(/\S/u)),
  }),
]);

export type AccountLoginServerPreference =
  typeof AccountLoginServerPreferenceSchema.Type;

export type AccountLoginServerResolution =
  | {
      readonly type: "server";
      readonly name: string;
    }
  | {
      readonly type: "none";
    }
  | {
      readonly type: "unavailable";
    };

const ACCOUNT_LOGIN_SERVER_STORAGE_KEY = "lucent.account-manager.login-server";
const StoredAccountLoginServerPreferenceSchema = Schema.fromJsonString(
  AccountLoginServerPreferenceSchema,
);
const decodeStoredAccountLoginServerPreference = Schema.decodeUnknownOption(
  StoredAccountLoginServerPreferenceSchema,
);
const encodeStoredAccountLoginServerPreference = Schema.encodeSync(
  StoredAccountLoginServerPreferenceSchema,
);

export function readStoredAccountLoginServerPreference():
  | AccountLoginServerPreference
  | undefined {
  const storedValue = readLocalStorageValue(ACCOUNT_LOGIN_SERVER_STORAGE_KEY);
  if (storedValue === undefined) {
    return undefined;
  }

  const decoded = decodeStoredAccountLoginServerPreference(storedValue);
  return Option.isSome(decoded) ? decoded.value : undefined;
}

export function writeStoredAccountLoginServerPreference(
  preference: AccountLoginServerPreference,
): void {
  try {
    writeLocalStorageValue(
      ACCOUNT_LOGIN_SERVER_STORAGE_KEY,
      encodeStoredAccountLoginServerPreference(preference),
    );
  } catch (error) {
    console.warn("Failed to encode account login server preference:", error);
  }
}

export function resolveAccountLoginServerPreference(
  servers: readonly AccountGameServer[],
  preference: AccountLoginServerPreference | undefined,
): AccountLoginServerResolution {
  if (preference?.type === "none") {
    return { type: "none" };
  }

  if (preference?.type === "server") {
    const preferredServer = servers.find(
      (server) => server.name === preference.name,
    );
    if (preferredServer?.online === true) {
      return { type: "server", name: preferredServer.name };
    }
  }

  const fallbackServer = servers.find(
    (server) => server.online && server.playerCount < server.maxPlayers,
  );
  return fallbackServer === undefined
    ? { type: "unavailable" }
    : { type: "server", name: fallbackServer.name };
}
