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
