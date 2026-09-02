import { join } from "path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { gt, valid } from "semver";

import {
  UpdateReleaseInfo,
  type UpdateCheckState,
  type UpdateReleaseCache,
} from "../../shared/updates";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { makeListenerRegistry } from "../app/ListenerRegistry";
import { DesktopObservability } from "../app/observability/DesktopObservability";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronShell } from "../electron/ElectronShell";
import {
  GitHubApiClient,
  type GitHubApiClientShape,
} from "../github/GitHubApiClient";
import { firstHttpHeader } from "../http/DesktopHttpClient";
import { DesktopFileSystem } from "../filesystem/DesktopFileSystem";
import { makeJsonFile } from "../filesystem/JsonFile";
import { DesktopSettings } from "../settings/DesktopSettings";
import { parseAllowedUpdateReleaseUrl } from "./UpdateReleaseOpenPolicy";

const RELEASE_URL =
  "https://api.github.com/repos/toommyliu/lucent/releases/latest";
const CHECK_TIMEOUT_MS = 10_000;
const CHECK_ATTEMPTS = 3;

export class DesktopUpdateError extends Schema.TaggedError<DesktopUpdateError>()(
  "DesktopUpdateError",
  {
    detail: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

type UpdateReleaseFetchResult =
  | {
      readonly status: "modified";
      readonly release: UpdateReleaseInfo;
      readonly etag?: string;
    }
  | {
      readonly status: "not-modified";
      readonly etag?: string;
    };

export interface DesktopUpdatesShape {
  readonly checkNow: (options?: {
    readonly force?: boolean;
  }) => Effect.Effect<UpdateCheckState>;
  readonly getState: Effect.Effect<UpdateCheckState>;
  readonly onStateChanged: (
    listener: (state: UpdateCheckState) => void,
  ) => Effect.Effect<() => void>;
  readonly openReleasePage: Effect.Effect<boolean>;
  readonly shouldPromptForAvailableRelease: (
    version: string,
  ) => Effect.Effect<boolean>;
  readonly skipAvailableRelease: (version: string) => Effect.Effect<boolean>;
}

export class DesktopUpdates extends Context.Service<
  DesktopUpdates,
  DesktopUpdatesShape
>()("lucent/desktop/updates/DesktopUpdates") {}

const GitHubReleasePayloadSchema = Schema.Struct({
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  draft: Schema.Boolean,
  html_url: Schema.String,
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  prerelease: Schema.Boolean,
  published_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  tag_name: Schema.String,
});
type GitHubReleasePayload = typeof GitHubReleasePayloadSchema.Type;
const decodeGitHubReleasePayload = Schema.decodeUnknownSync(
  GitHubReleasePayloadSchema,
);

const UpdateReleaseCacheSchema = Schema.Struct({
  release: UpdateReleaseInfo,
  etag: Schema.optionalKey(Schema.String),
  skippedVersion: Schema.optionalKey(Schema.String),
});
const decodeUpdateReleaseCache = Schema.decodeUnknownOption(
  UpdateReleaseCacheSchema,
);

const normalizeVersion = (version: string): string => {
  const value = version.trim();
  const normalized = value.startsWith("v") ? value.slice(1) : value;
  const parsed = valid(normalized);
  if (parsed === null) {
    throw new Error(`Invalid semantic version: ${JSON.stringify(version)}.`);
  }
  return parsed;
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const errorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;

const parseGitHubReleasePayload = (
  payload: GitHubReleasePayload,
): UpdateReleaseInfo => {
  if (payload.draft === true || payload.prerelease === true) {
    throw new Error("Latest release is not a stable release.");
  }

  const tagName = payload.tag_name.trim();
  const releaseUrl = parseAllowedUpdateReleaseUrl(payload.html_url.trim());
  if (tagName.length === 0)
    throw new Error("Release payload is missing tag_name.");
  if (releaseUrl === null)
    throw new Error("Release payload has an invalid html_url.");

  const name = optionalString(payload.name);
  const publishedAt = optionalString(payload.published_at);
  const body = typeof payload.body === "string" ? payload.body : undefined;

  return new UpdateReleaseInfo({
    version: normalizeVersion(tagName),
    tagName,
    htmlUrl: releaseUrl.href,
    ...(name === undefined ? {} : { name }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(body === undefined ? {} : { body }),
  });
};

const desktopUpdateError = (cause: unknown): DesktopUpdateError =>
  cause instanceof DesktopUpdateError
    ? cause
    : new DesktopUpdateError({
        detail: errorMessage(cause, "Failed to check for updates."),
        cause,
      });

const fetchLatestGitHubRelease = Effect.fn(
  "DesktopUpdates.fetchLatestGitHubRelease",
)(function* (
  api: GitHubApiClientShape,
  options?: { readonly etag?: string },
): Effect.fn.Return<UpdateReleaseFetchResult, DesktopUpdateError> {
  const response = yield* api
    .get({
      attempts: CHECK_ATTEMPTS,
      ...(options?.etag === undefined ? {} : { etag: options.etag }),
      timeoutMs: CHECK_TIMEOUT_MS,
      url: new URL(RELEASE_URL),
    })
    .pipe(Effect.mapError(desktopUpdateError));
  const etag = firstHttpHeader(response.headers, "etag");
  if (response.statusCode === 304) {
    return {
      status: "not-modified",
      ...(etag === undefined ? {} : { etag }),
    };
  }

  return yield* Effect.try({
    try: () => ({
      status: "modified" as const,
      release: parseGitHubReleasePayload(
        decodeGitHubReleasePayload(JSON.parse(response.body.toString("utf8"))),
      ),
      ...(etag === undefined ? {} : { etag }),
    }),
    catch: desktopUpdateError,
  });
});

const normalizeUpdateReleaseCache = (
  value: unknown,
): UpdateReleaseCache | null => {
  const decoded = decodeUpdateReleaseCache(value);
  return Option.isSome(decoded) ? decoded.value : null;
};

const serializeUpdateReleaseCache = (cache: UpdateReleaseCache): unknown => ({
  release: {
    version: cache.release.version,
    tagName: cache.release.tagName,
    htmlUrl: cache.release.htmlUrl,
    ...(cache.release.name === undefined ? {} : { name: cache.release.name }),
    ...(cache.release.publishedAt === undefined
      ? {}
      : { publishedAt: cache.release.publishedAt }),
    ...(cache.release.body === undefined ? {} : { body: cache.release.body }),
  },
  ...(cache.etag === undefined ? {} : { etag: cache.etag }),
  ...(cache.skippedVersion === undefined
    ? {}
    : { skippedVersion: cache.skippedVersion }),
});

interface DesktopUpdatesOptions {
  readonly currentVersion: string;
  readonly fetchRelease: (options?: {
    readonly etag?: string;
  }) => Effect.Effect<UpdateReleaseFetchResult, DesktopUpdateError>;
  readonly isEnabled: Effect.Effect<boolean, unknown>;
  readonly loadCache: Effect.Effect<UpdateReleaseCache | null, unknown>;
  readonly now?: () => Date;
  readonly saveCache: (
    cache: UpdateReleaseCache,
  ) => Effect.Effect<void, unknown>;
  readonly openExternal: (url: string) => Effect.Effect<boolean>;
}

const makeDesktopUpdates = (
  options: DesktopUpdatesOptions,
): Effect.Effect<DesktopUpdatesShape> =>
  Effect.gen(function* () {
    const currentVersion = normalizeVersion(options.currentVersion);
    const now = options.now ?? (() => new Date());
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);
    const disabledState = (): UpdateCheckState => ({
      status: "disabled",
      currentVersion,
      reason: "Update checks are disabled.",
    });
    const updatesEnabled = yield* options.isEnabled.pipe(
      Effect.catch(() => Effect.succeed(true)),
    );
    const stateRef = yield* Ref.make<UpdateCheckState>(
      updatesEnabled
        ? {
            status: "idle",
            currentVersion,
          }
        : disabledState(),
    );
    const cacheRef = yield* Ref.make<UpdateReleaseCache | null>(null);
    const cacheLoadedRef = yield* Ref.make(false);
    const stateChanges = makeListenerRegistry<UpdateCheckState>();
    let inFlight: Promise<UpdateCheckState> | null = null;

    const setState = (state: UpdateCheckState): Effect.Effect<void> =>
      Ref.set(stateRef, state).pipe(
        Effect.flatMap(() => stateChanges.publish(state)),
      );

    const loadCacheOnce = Effect.gen(function* () {
      const loaded = yield* Ref.get(cacheLoadedRef);
      if (loaded) {
        return yield* Ref.get(cacheRef);
      }

      const cache = yield* options.loadCache;
      yield* Ref.set(cacheRef, cache);
      yield* Ref.set(cacheLoadedRef, true);
      return cache;
    });

    const saveCache = (cache: UpdateReleaseCache) =>
      options.saveCache(cache).pipe(
        Effect.tap(() => Ref.set(cacheRef, cache)),
        Effect.tap(() => Ref.set(cacheLoadedRef, true)),
      );

    const stateFromRelease = (
      release: UpdateReleaseInfo,
      checkedAt: string,
    ): UpdateCheckState =>
      gt(release.version, currentVersion)
        ? {
            status: "available",
            currentVersion,
            latestVersion: release.version,
            checkedAt,
            release,
          }
        : {
            status: "current",
            currentVersion,
            latestVersion: release.version,
            checkedAt,
          };

    const runCheck = (force: boolean) =>
      Effect.gen(function* () {
        const enabled = yield* options.isEnabled;
        if (!enabled && !force) {
          const disabled = disabledState();
          yield* setState(disabled);
          return disabled;
        }

        const startedAt = now().toISOString();
        yield* setState({
          status: "checking",
          currentVersion,
          startedAt,
        });

        const cache = yield* loadCacheOnce;
        const result = yield* options.fetchRelease(
          cache?.etag === undefined ? undefined : { etag: cache.etag },
        );
        const checkedAt = now().toISOString();

        if (result.status === "not-modified") {
          const release = cache?.release;
          if (release === undefined) {
            const current: UpdateCheckState = {
              status: "current",
              currentVersion,
              latestVersion: currentVersion,
              checkedAt,
            };
            yield* setState(current);
            return current;
          }

          const next = stateFromRelease(release, checkedAt);
          yield* setState(next);
          return next;
        }

        const nextCache: UpdateReleaseCache = {
          release: result.release,
          ...(result.etag === undefined ? {} : { etag: result.etag }),
          ...(cache?.skippedVersion === result.release.version
            ? { skippedVersion: cache.skippedVersion }
            : {}),
        };
        yield* saveCache(nextCache);

        const next = stateFromRelease(result.release, checkedAt);
        yield* setState(next);
        return next;
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const checkedAt = now().toISOString();
            const next: UpdateCheckState = {
              status: "error",
              currentVersion,
              checkedAt,
              message: errorMessage(error, "Failed to check for updates."),
            };
            yield* setState(next);
            return next;
          }),
        ),
      );

    const getState: DesktopUpdatesShape["getState"] = Ref.get(stateRef);

    const onStateChanged: DesktopUpdatesShape["onStateChanged"] =
      stateChanges.subscribe;

    const openReleasePage: DesktopUpdatesShape["openReleasePage"] = Ref.get(
      stateRef,
    ).pipe(
      Effect.flatMap((state) =>
        state.status === "available"
          ? options.openExternal(state.release.htmlUrl)
          : Effect.succeed(false),
      ),
    );

    const shouldPromptForAvailableRelease: DesktopUpdatesShape["shouldPromptForAvailableRelease"] =
      Effect.fn("DesktopUpdates.shouldPromptForAvailableRelease")(
        function* (version) {
          const cache = yield* loadCacheOnce;
          return cache?.skippedVersion !== version;
        },
        Effect.orElseSucceed(() => true),
      );

    const skipAvailableRelease: DesktopUpdatesShape["skipAvailableRelease"] =
      Effect.fn("DesktopUpdates.skipAvailableRelease")(
        function* (version) {
          const state = yield* Ref.get(stateRef);
          if (state.status !== "available" || state.latestVersion !== version) {
            return false;
          }

          const cache = yield* loadCacheOnce;
          yield* saveCache({
            release: state.release,
            ...(cache?.etag === undefined ? {} : { etag: cache.etag }),
            skippedVersion: version,
          });
          return true;
        },
        Effect.orElseSucceed(() => false),
      );

    const checkNow: DesktopUpdatesShape["checkNow"] = (checkOptions) => {
      if (inFlight !== null) {
        const active = inFlight;
        return Effect.promise(() => active);
      }

      const promise = runPromise(runCheck(checkOptions?.force === true));
      inFlight = promise;
      return Effect.promise(() =>
        promise.finally(() => {
          if (inFlight === promise) {
            inFlight = null;
          }
        }),
      );
    };

    return {
      checkNow,
      getState,
      onStateChanged,
      openReleasePage,
      shouldPromptForAvailableRelease,
      skipAvailableRelease,
    };
  });

export const layer = Layer.effect(
  DesktopUpdates,
  Effect.gen(function* () {
    const app = yield* ElectronApp;
    const env = yield* DesktopEnvironment;
    const jsonFile = makeJsonFile(yield* DesktopFileSystem);
    const observability = yield* DesktopObservability;
    const shell = yield* ElectronShell;
    const settings = yield* DesktopSettings;
    const api = yield* GitHubApiClient;
    const currentVersion = yield* app.getVersion;
    const releaseCachePath = join(env.appDataDir, "release-cache.json");

    const fetchRelease: DesktopUpdatesOptions["fetchRelease"] = (options) =>
      fetchLatestGitHubRelease(api, options);

    const isEnabled: DesktopUpdatesOptions["isEnabled"] = settings.get.pipe(
      Effect.map(
        (currentSettings) => currentSettings.preferences.checkForUpdates,
      ),
    );

    const loadCache: DesktopUpdatesOptions["loadCache"] = jsonFile
      .read(releaseCachePath)
      .pipe(
        Effect.map((result) =>
          result.status === "ok"
            ? normalizeUpdateReleaseCache(result.value)
            : null,
        ),
        Effect.catch((cause) =>
          observability
            .warn("updates", "Failed to load release cache", { cause })
            .pipe(Effect.as(null)),
        ),
      );

    const saveCache: DesktopUpdatesOptions["saveCache"] = (cache) =>
      jsonFile.write(releaseCachePath, serializeUpdateReleaseCache(cache)).pipe(
        Effect.catch((cause) =>
          observability.warn("updates", "Failed to save release cache", {
            cause,
          }),
        ),
      );

    const openExternal: DesktopUpdatesOptions["openExternal"] = (rawUrl) => {
      const url = parseAllowedUpdateReleaseUrl(rawUrl);
      return url === null ? Effect.succeed(false) : shell.openExternal(url);
    };

    const updates = yield* makeDesktopUpdates({
      currentVersion,
      fetchRelease,
      isEnabled,
      loadCache,
      openExternal,
      saveCache,
    });

    return DesktopUpdates.of(updates);
  }),
);
