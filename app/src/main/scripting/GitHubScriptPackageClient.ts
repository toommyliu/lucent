import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  GitHubApiClient,
  GitHubApiClientError,
  GitHubApiErrorKind,
} from "../github/GitHubApiClient";
import { firstHttpHeader } from "../http/DesktopHttpClient";
import {
  parseGitHubRepositoryInput,
  type GitHubRepository as ParsedGitHubRepository,
} from "../../shared/githubRepositoryUrl";
import { GitHubCredentials } from "./GitHubCredentials";

const API_ORIGIN = "https://api.github.com";
const ARCHIVE_MAX_BYTES = 64 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const MAX_METADATA_ATTEMPTS = 3;
const MAX_ARCHIVE_ATTEMPTS = 2;
const QUEUE_LIMIT = 32;

const GitHubCommitPayloadSchema = Schema.Struct({
  sha: Schema.String.check(Schema.isNonEmpty()),
});
const decodeCommitPayload = Schema.decodeUnknownSync(GitHubCommitPayloadSchema);

export type GitHubRepository = ParsedGitHubRepository;

export const normalizeGitHubRepositoryUrl = (
  value: string,
): GitHubRepository => {
  const input = parseGitHubRepositoryInput(value);
  if (input.kind !== "repository") {
    throw new Error("Enter an https://github.com/<owner>/<repository> URL.");
  }
  return input.repository;
};

export class GitHubScriptPackageClientError extends Schema.TaggedErrorClass<GitHubScriptPackageClientError>()(
  "GitHubScriptPackageClientError",
  {
    kind: GitHubApiErrorKind,
    detail: Schema.String,
    retryAt: Schema.optionalKey(Schema.String),
    statusCode: Schema.optionalKey(Schema.Number),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export type GitHubCommitResolution =
  | {
      readonly status: "modified";
      readonly commit: string;
      readonly etag?: string;
    }
  | {
      readonly status: "not-modified";
      readonly etag?: string;
    };

export interface GitHubScriptPackageClientShape {
  readonly downloadArchive: (input: {
    readonly credentialId?: string;
    readonly repositoryUrl: string;
    readonly ref?: string;
    readonly targetPath: string;
  }) => Effect.Effect<void, GitHubScriptPackageClientError>;
  readonly resolveCommit: (input: {
    readonly credentialId?: string;
    readonly etag?: string;
    readonly repositoryUrl: string;
    readonly ref?: string;
  }) => Effect.Effect<GitHubCommitResolution, GitHubScriptPackageClientError>;
}

export class GitHubScriptPackageClient extends Context.Service<
  GitHubScriptPackageClient,
  GitHubScriptPackageClientShape
>()("lucent/desktop/scripting/GitHubScriptPackageClient") {}

export class GitHubRequestQueue {
  #pending = 0;
  #tail: Promise<void> = Promise.resolve();

  constructor(private readonly limit: number = QUEUE_LIMIT) {}

  enqueue<Value>(task: () => Promise<Value>): Promise<Value> {
    if (this.#pending >= this.limit) {
      return Promise.reject(new Error("GitHub request queue is full."));
    }
    this.#pending += 1;
    const result = this.#tail.then(task, task);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.#pending -= 1;
    });
  }
}

const clientError = (cause: unknown): GitHubScriptPackageClientError =>
  cause instanceof GitHubScriptPackageClientError
    ? cause
    : cause instanceof GitHubApiClientError
      ? new GitHubScriptPackageClientError({
          kind: cause.kind,
          detail: cause.message,
          ...(cause.retryAt === undefined ? {} : { retryAt: cause.retryAt }),
          ...(cause.statusCode === undefined
            ? {}
            : { statusCode: cause.statusCode }),
          cause,
        })
      : new GitHubScriptPackageClientError({
          kind: "unavailable",
          detail:
            cause instanceof Error && cause.message.trim() !== ""
              ? cause.message
              : "GitHub request failed.",
          cause,
        });

export const layer = Layer.effect(
  GitHubScriptPackageClient,
  Effect.gen(function* () {
    const api = yield* GitHubApiClient;
    const credentials = yield* GitHubCredentials;
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const queue = new GitHubRequestQueue();
    const inFlightMetadata = new Map<string, Promise<GitHubCommitResolution>>();

    const resolveCommit: GitHubScriptPackageClientShape["resolveCommit"] = (
      input,
    ) =>
      Effect.gen(function* () {
        const repository = yield* Effect.try({
          try: () => normalizeGitHubRepositoryUrl(input.repositoryUrl),
          catch: (cause) =>
            new GitHubScriptPackageClientError({
              kind: "invalid-request",
              detail: "Enter a valid GitHub.com repository URL.",
              cause,
            }),
        });
        const token = yield* credentials.resolveToken(input.credentialId).pipe(
          Effect.mapError(
            (cause) =>
              new GitHubScriptPackageClientError({
                kind: "authentication",
                detail: cause.message,
                cause,
              }),
          ),
        );
        const ref = input.ref?.trim() || "HEAD";
        const key = JSON.stringify({
          credentialId: input.credentialId ?? null,
          etag: input.etag ?? null,
          ref,
          repository: repository.url,
        });
        const pending = inFlightMetadata.get(key);
        if (pending !== undefined) {
          return yield* Effect.tryPromise({
            try: () => pending,
            catch: clientError,
          });
        }

        const url = new URL(
          `${API_ORIGIN}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/commits/${encodeURIComponent(ref)}`,
        );
        const operation = queue.enqueue(() =>
          runPromise(
            Effect.gen(function* () {
              const response = yield* api.get({
                attempts: MAX_METADATA_ATTEMPTS,
                ...(input.credentialId === undefined
                  ? {}
                  : { credentialId: input.credentialId }),
                ...(input.etag === undefined ? {} : { etag: input.etag }),
                timeoutMs: REQUEST_TIMEOUT_MS,
                ...(token === undefined ? {} : { token }),
                url,
              });
              const etag = firstHttpHeader(response.headers, "etag");
              if (response.statusCode === 304) {
                return {
                  status: "not-modified",
                  ...(etag === undefined ? {} : { etag }),
                } satisfies GitHubCommitResolution;
              }

              return yield* Effect.try({
                try: () => {
                  const payload = decodeCommitPayload(
                    JSON.parse(response.body.toString("utf8")),
                  );
                  return {
                    status: "modified",
                    commit: payload.sha,
                    ...(etag === undefined ? {} : { etag }),
                  } satisfies GitHubCommitResolution;
                },
                catch: clientError,
              });
            }).pipe(Effect.mapError(clientError)),
          ),
        );
        inFlightMetadata.set(key, operation);
        return yield* Effect.tryPromise({
          try: () =>
            operation.finally(() => {
              if (inFlightMetadata.get(key) === operation) {
                inFlightMetadata.delete(key);
              }
            }),
          catch: clientError,
        });
      });

    const downloadArchive: GitHubScriptPackageClientShape["downloadArchive"] = (
      input,
    ) =>
      Effect.gen(function* () {
        const repository = yield* Effect.try({
          try: () => normalizeGitHubRepositoryUrl(input.repositoryUrl),
          catch: (cause) =>
            new GitHubScriptPackageClientError({
              kind: "invalid-request",
              detail: "Enter a valid GitHub.com repository URL.",
              cause,
            }),
        });
        const token = yield* credentials.resolveToken(input.credentialId).pipe(
          Effect.mapError(
            (cause) =>
              new GitHubScriptPackageClientError({
                kind: "authentication",
                detail: cause.message,
                cause,
              }),
          ),
        );
        const ref = input.ref?.trim() || "HEAD";
        return yield* Effect.tryPromise({
          try: () =>
            queue.enqueue(() =>
              runPromise(
                api
                  .download({
                    attempts: MAX_ARCHIVE_ATTEMPTS,
                    ...(input.credentialId === undefined
                      ? {}
                      : { credentialId: input.credentialId }),
                    maxBytes: ARCHIVE_MAX_BYTES,
                    maxRedirects: MAX_REDIRECTS,
                    targetPath: input.targetPath,
                    timeoutMs: REQUEST_TIMEOUT_MS,
                    ...(token === undefined ? {} : { token }),
                    url: new URL(
                      `${API_ORIGIN}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/tarball/${encodeURIComponent(ref)}`,
                    ),
                  })
                  .pipe(Effect.mapError(clientError), Effect.asVoid),
              ),
            ),
          catch: clientError,
        });
      });

    return GitHubScriptPackageClient.of({
      downloadArchive,
      resolveCommit,
    });
  }),
);
