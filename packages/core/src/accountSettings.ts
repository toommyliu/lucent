import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const ACCOUNT_SETTINGS_VERSION = 1;

export const MINIMUM_ROOM_NUMBER = 1;
export const MINIMUM_PRIVATE_ROOM = 1_001;
export const MINIMUM_RANDOM_PRIVATE_ROOM = 10_000;
export const MAXIMUM_ROOM_NUMBER = 99_999;

export const RoomNumberSchema = Schema.Int.check(
  Schema.isBetween({
    minimum: MINIMUM_ROOM_NUMBER,
    maximum: MAXIMUM_ROOM_NUMBER,
  }),
);

export const RoomPolicySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("public") }),
  Schema.Struct({ kind: Schema.Literal("random-private") }),
  Schema.Struct({
    kind: Schema.Literal("specific"),
    roomNumber: RoomNumberSchema,
  }),
]);

export type RoomPolicy = typeof RoomPolicySchema.Type;

export const AccountScriptSettingsSchema = Schema.Struct({
  restartAfterReconnect: Schema.Boolean,
  roomPolicy: RoomPolicySchema,
  safeStartStop: Schema.Boolean,
});

export type AccountScriptSettings = typeof AccountScriptSettingsSchema.Type;

export const AccountSettingsSchema = Schema.Struct({
  version: Schema.Literal(ACCOUNT_SETTINGS_VERSION),
  scripts: AccountScriptSettingsSchema,
});

export type AccountSettings = typeof AccountSettingsSchema.Type;

export const AccountScriptSettingsPatchSchema = Schema.Struct({
  restartAfterReconnect: Schema.optionalKey(Schema.Boolean),
  roomPolicy: Schema.optionalKey(RoomPolicySchema),
  safeStartStop: Schema.optionalKey(Schema.Boolean),
});

export type AccountScriptSettingsPatch =
  typeof AccountScriptSettingsPatchSchema.Type;

export const AccountSettingsPatchSchema = Schema.Struct({
  scripts: Schema.optionalKey(AccountScriptSettingsPatchSchema),
});

export type AccountSettingsPatch = typeof AccountSettingsPatchSchema.Type;

export const PUBLIC_ROOM_POLICY: RoomPolicy = { kind: "public" };
export const RANDOM_PRIVATE_ROOM_POLICY: RoomPolicy = {
  kind: "random-private",
};

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
  version: ACCOUNT_SETTINGS_VERSION,
  scripts: {
    restartAfterReconnect: false,
    roomPolicy: RANDOM_PRIVATE_ROOM_POLICY,
    safeStartStop: true,
  },
};

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const decodeRecord = Schema.decodeUnknownOption(UnknownRecordSchema);
const decodeBoolean = Schema.decodeUnknownOption(Schema.Boolean);
const decodeRoomPolicy = Schema.decodeUnknownOption(RoomPolicySchema);

const recordOrEmpty = (value: unknown): Record<string, unknown> => {
  const decoded = decodeRecord(value);
  return Option.isSome(decoded) ? decoded.value : {};
};

const booleanOr = (value: unknown, fallback: boolean): boolean => {
  const decoded = decodeBoolean(value);
  return Option.isSome(decoded) ? decoded.value : fallback;
};

const roomPolicyOr = (value: unknown, fallback: RoomPolicy): RoomPolicy => {
  const decoded = decodeRoomPolicy(value);
  return Option.isSome(decoded) ? decoded.value : fallback;
};

export const normalizeAccountSettings = (value: unknown): AccountSettings => {
  const document = recordOrEmpty(value);
  const scripts = recordOrEmpty(document["scripts"]);

  return {
    version: ACCOUNT_SETTINGS_VERSION,
    scripts: {
      restartAfterReconnect: booleanOr(
        scripts["restartAfterReconnect"],
        DEFAULT_ACCOUNT_SETTINGS.scripts.restartAfterReconnect,
      ),
      roomPolicy: roomPolicyOr(
        scripts["roomPolicy"],
        DEFAULT_ACCOUNT_SETTINGS.scripts.roomPolicy,
      ),
      safeStartStop: booleanOr(
        scripts["safeStartStop"],
        DEFAULT_ACCOUNT_SETTINGS.scripts.safeStartStop,
      ),
    },
  };
};

export const applyAccountSettingsPatch = (
  current: AccountSettings,
  patch: AccountSettingsPatch,
): AccountSettings =>
  normalizeAccountSettings({
    ...current,
    scripts: {
      ...current.scripts,
      ...patch.scripts,
    },
  });

export const serializeAccountSettings = (
  settings: AccountSettings,
): AccountSettings => normalizeAccountSettings(settings);
