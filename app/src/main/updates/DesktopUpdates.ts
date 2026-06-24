import type { IncomingHttpHeaders } from "http";
import { get } from "https";

import { Context, Effect, Layer, Ref, Schema } from "effect";

import {
  UpdateReleaseInfo,
  type UpdateCheckState,
  type UpdateReleaseCache,
} from "../../shared/updates";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { DesktopObservability } from "../app/DesktopObservability";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronShell } from "../electron/ElectronShell";
import { DesktopSettings } from "../settings/DesktopSettings";
import { readJsonFile, writeJsonFile } from "../settings/JsonFile";

const RELEASE_URL =
  "https://api.github.com/repos/toommyliu/lucent/releases/latest";
const CHECK_TIMEOUT_MS = 10_000;

export class DesktopUpdateError extends Schema.TaggedErrorClass<DesktopUpdateError>()(
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
}

export class DesktopUpdates extends Context.Service<
  DesktopUpdates,
  DesktopUpdatesShape
>()("lucent/desktop/updates/DesktopUpdates") {}

interface GitHubReleasePayload {
  readonly body?: unknown;
  readonly draft?: unknown;
  readonly html_url?: unknown;
  readonly name?: unknown;
  readonly prerelease?: unknown;
  readonly published_at?: unknown;
  readonly tag_name?: unknown;
}

const normalizeVersion = (version: string): string =>
  version.trim().replace(/^v/i, "");

const parseVersionParts = (version: string): readonly number[] | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(
    normalizeVersion(version),
  );
  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compareSemver = (left: string, right: string): number => {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  if (leftParts === null || rightParts === null) {
    return normalizeVersion(left).localeCompare(normalizeVersion(right));
  }

  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts[index]! - rightParts[index]!;
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
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

  const tagName = optionalString(payload.tag_name);
  const htmlUrl = optionalString(payload.html_url);
  if (tagName === undefined) {
    throw new Error("Release payload is missing tag_name.");
  }
  if (htmlUrl === undefined) {
    throw new Error("Release payload is missing html_url.");
  }

  const name = optionalString(payload.name);
  const publishedAt = optionalString(payload.published_at);
  const body = typeof payload.body === "string" ? payload.body : undefined;

  return new UpdateReleaseInfo({
    version: normalizeVersion(tagName),
    tagName,
    htmlUrl,
    ...(name === undefined ? {} : { name }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(body === undefined ? {} : { body }),
  });
};

const firstHeader = (
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined => {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value.find((entry) => entry.trim().length > 0);
  }

  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
};

const requestHeaders = (etag: string | undefined): Record<string, string> => ({
  Accept: "application/vnd.github+json",
  "User-Agent": "lucent-update-checker",
  ...(etag === undefined ? {} : { "If-None-Match": etag }),
});

const fetchLatestGitHubRelease = (options?: {
  readonly etag?: string;
}): Effect.Effect<UpdateReleaseFetchResult, DesktopUpdateError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<UpdateReleaseFetchResult>((resolve, reject) => {
        const request = get(
          RELEASE_URL,
          { headers: requestHeaders(options?.etag) },
          (response) => {
            const statusCode = response.statusCode ?? 0;
            const etag = firstHeader(response.headers, "etag");
            const chunks: Buffer[] = [];

            response.on("error", reject);
            response.on("data", (chunk: Buffer | string) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            response.on("end", () => {
              if (statusCode === 304) {
                resolve({
                  status: "not-modified",
                  ...(etag === undefined ? {} : { etag }),
                });
                return;
              }

              const source = Buffer.concat(chunks).toString("utf8");
              if (statusCode < 200 || statusCode >= 300) {
                reject(
                  new Error(
                    `GitHub Releases returned HTTP ${statusCode} ${
                      response.statusMessage ?? ""
                    }`.trim(),
                  ),
                );
                return;
              }

              try {
                resolve({
                  status: "modified",
                  release: parseGitHubReleasePayload(
                    JSON.parse(source) as GitHubReleasePayload,
                  ),
                  ...(etag === undefined ? {} : { etag }),
                });
              } catch (cause) {
                reject(cause);
              }
            });
          },
        );

        request.setTimeout(CHECK_TIMEOUT_MS, () => {
          request.destroy(new Error("Timed out while checking for updates."));
        });
        request.on("error", reject);
      }),
    catch: (cause) =>
      new DesktopUpdateError({
        detail: errorMessage(cause, "Failed to check for updates."),
        cause,
      }),
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeUpdateReleaseCache = (
  value: unknown,
): UpdateReleaseCache | null => {
  if (!isRecord(value)) {
    return null;
  }

  const release = value["release"];
  if (!isRecord(release)) {
    return null;
  }

  const version = optionalString(release["version"]);
  const tagName = optionalString(release["tagName"]);
  const htmlUrl = optionalString(release["htmlUrl"]);
  if (version === undefined || tagName === undefined || htmlUrl === undefined) {
    return null;
  }

  const etag = optionalString(value["etag"]);
  const name = optionalString(release["name"]);
  const publishedAt = optionalString(release["publishedAt"]);
  const body =
    typeof release["body"] === "string" ? release["body"] : undefined;

  return {
    release: new UpdateReleaseInfo({
      version,
      tagName,
      htmlUrl,
      ...(name === undefined ? {} : { name }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
      ...(body === undefined ? {} : { body }),
    }),
    ...(etag === undefined ? {} : { etag }),
  };
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
    const listeners = new Set<(state: UpdateCheckState) => void>();
    let inFlight: Promise<UpdateCheckState> | null = null;

    const publish = (state: UpdateCheckState): Effect.Effect<void> =>
      Effect.sync(() => {
        for (const listener of listeners) {
          listener(state);
        }
      });

    const setState = (state: UpdateCheckState): Effect.Effect<void> =>
      Ref.set(stateRef, state).pipe(Effect.flatMap(() => publish(state)));

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
      compareSemver(release.version, currentVersion) > 0
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

    return {
      getState: Ref.get(stateRef),
      onStateChanged: (listener) =>
        Effect.sync(() => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        }),
      openReleasePage: Ref.get(stateRef).pipe(
        Effect.flatMap((state) =>
          state.status === "available"
            ? options.openExternal(state.release.htmlUrl)
            : Effect.succeed(false),
        ),
      ),
      checkNow: (checkOptions) => {
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
      },
    };
  });

export const layer = Layer.effect(
  DesktopUpdates,
  Effect.gen(function* () {
    const app = yield* ElectronApp;
    const env = yield* DesktopEnvironment;
    const observability = yield* DesktopObservability;
    const shell = yield* ElectronShell;
    const settings = yield* DesktopSettings;
    const currentVersion = yield* app.getVersion;

    return DesktopUpdates.of(
      yield* makeDesktopUpdates({
        currentVersion,
        fetchRelease: fetchLatestGitHubRelease,
        isEnabled: settings.get.pipe(
          Effect.map(
            (currentSettings) => currentSettings.preferences.checkForUpdates,
          ),
        ),
        loadCache: readJsonFile(env.releaseCachePath).pipe(
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
        ),
        saveCache: (cache) =>
          writeJsonFile(
            env.releaseCachePath,
            serializeUpdateReleaseCache(cache),
          ).pipe(
            Effect.catch((cause) =>
              observability.warn("updates", "Failed to save release cache", {
                cause,
              }),
            ),
          ),
        openExternal: (url) => shell.openExternal(url),
      }),
    );
  }),
);
