import { Schema } from "effect";

export class UpdateReleaseInfo extends Schema.Class<UpdateReleaseInfo>(
  "UpdateReleaseInfo",
)({
  version: Schema.String,
  tagName: Schema.String,
  htmlUrl: Schema.String,
  name: Schema.optionalKey(Schema.String),
  publishedAt: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(Schema.String),
}) {}

export type UpdateReleaseCache = {
  readonly release: UpdateReleaseInfo;
  readonly etag?: string;
};

export const UpdateCheckStateSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("idle"),
    currentVersion: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("disabled"),
    currentVersion: Schema.String,
    reason: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("checking"),
    currentVersion: Schema.String,
    startedAt: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("current"),
    currentVersion: Schema.String,
    latestVersion: Schema.String,
    checkedAt: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("available"),
    currentVersion: Schema.String,
    latestVersion: Schema.String,
    checkedAt: Schema.String,
    release: UpdateReleaseInfo,
  }),
  Schema.Struct({
    status: Schema.Literal("error"),
    currentVersion: Schema.String,
    checkedAt: Schema.String,
    message: Schema.String,
  }),
]);

export type UpdateCheckState =
  | {
      readonly status: "idle";
      readonly currentVersion: string;
    }
  | {
      readonly status: "disabled";
      readonly currentVersion: string;
      readonly reason: string;
    }
  | {
      readonly status: "checking";
      readonly currentVersion: string;
      readonly startedAt: string;
    }
  | {
      readonly status: "current";
      readonly currentVersion: string;
      readonly latestVersion: string;
      readonly checkedAt: string;
    }
  | {
      readonly status: "available";
      readonly currentVersion: string;
      readonly latestVersion: string;
      readonly checkedAt: string;
      readonly release: UpdateReleaseInfo;
    }
  | {
      readonly status: "error";
      readonly currentVersion: string;
      readonly checkedAt: string;
      readonly message: string;
    };
