import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { GitHubApiClient } from "../github/GitHubApiClient";
import type { DesktopHttpResponse } from "../http/DesktopHttpClient";
import { GitHubCredentials } from "./GitHubCredentials";
import {
  GitHubRequestQueue,
  GitHubScriptPackageClient,
  layer as gitHubScriptPackageClientLayer,
  normalizeGitHubRepositoryUrl,
} from "./GitHubScriptPackageClient";

const jsonResponse = (value: unknown): DesktopHttpResponse => ({
  body: Buffer.from(JSON.stringify(value)),
  headers: {},
  statusCode: 200,
  statusMessage: "OK",
  url: "https://api.github.com/test",
});

const makeClientHarness = (responses: readonly DesktopHttpResponse[]) => {
  const pending = [...responses];
  const requests: URL[] = [];
  const api = GitHubApiClient.of({
    download: () => Effect.die("Unexpected download."),
    get: (options) =>
      Effect.sync(() => {
        requests.push(options.url);
        const response = pending.shift();
        if (response === undefined)
          throw new Error("Unexpected GitHub request.");
        return response;
      }),
  });
  const credentials = GitHubCredentials.of({
    delete: () => Effect.die("Unexpected credential deletion."),
    list: Effect.succeed([]),
    resolveToken: () => Effect.succeed(undefined),
    save: () => Effect.die("Unexpected credential save."),
  });
  const layer = gitHubScriptPackageClientLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(GitHubApiClient, api),
        Layer.succeed(GitHubCredentials, credentials),
      ),
    ),
  );
  return { layer, requests };
};

describe("GitHubScriptPackageClient", () => {
  it("accepts only normalized GitHub.com repository sources", () => {
    expect(
      normalizeGitHubRepositoryUrl("https://github.com/example/tools.git/"),
    ).toEqual({
      owner: "example",
      repository: "tools",
      url: "https://github.com/example/tools",
    });

    for (const source of [
      "http://github.com/example/tools",
      "https://token@github.com/example/tools",
      "https://github.com:444/example/tools",
      "https://github.com/example/tools/path",
      "https://github.com/example/tools?ref=main",
      "https://gitlab.com/example/tools",
    ]) {
      expect(() => normalizeGitHubRepositoryUrl(source)).toThrow();
    }
  });

  it("serializes queued requests and enforces its bound", async () => {
    const queue = new GitHubRequestQueue(2);
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          order.push("first:start");
          releaseFirst = () => {
            order.push("first:end");
            resolve();
          };
        }),
    );
    const second = queue.enqueue(async () => {
      order.push("second");
    });
    await Promise.resolve();
    await expect(queue.enqueue(async () => undefined)).rejects.toThrow(
      "queue is full",
    );
    expect(order).toEqual(["first:start"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it.effect("resolves a package directory from the Contents API", () =>
    Effect.gen(function* () {
      const harness = makeClientHarness([
        jsonResponse([
          {
            name: "example",
            path: "packages/example",
            sha: "selected-tree",
            type: "dir",
          },
        ]),
      ]);
      const client = yield* GitHubScriptPackageClient.pipe(
        Effect.provide(harness.layer),
      );

      const result = yield* client.resolveDirectory({
        repositoryUrl: "https://github.com/example/monorepo",
        ref: "main",
        subdirectory: "packages/example",
      });

      expect(result).toEqual({ tree: "selected-tree" });
      expect(harness.requests.map(String)).toEqual([
        "https://api.github.com/repos/example/monorepo/contents/packages?ref=main",
      ]);
    }),
  );

  it.effect(
    "walks Git trees when a Contents listing reaches 1,000 entries",
    () =>
      Effect.gen(function* () {
        const listing = Array.from({ length: 1_000 }, (_, index) => ({
          name: `entry-${index}`,
          path: `packages/entry-${index}`,
          sha: `tree-${index}`,
          type: "dir",
        }));
        const harness = makeClientHarness([
          jsonResponse(listing),
          jsonResponse({
            sha: "root-tree",
            tree: [{ path: "packages", sha: "packages-tree", type: "tree" }],
            truncated: false,
          }),
          jsonResponse({
            sha: "packages-tree",
            tree: [{ path: "example", sha: "selected-tree", type: "tree" }],
            truncated: false,
          }),
        ]);
        const client = yield* GitHubScriptPackageClient.pipe(
          Effect.provide(harness.layer),
        );

        const result = yield* client.resolveDirectory({
          repositoryUrl: "https://github.com/example/monorepo",
          ref: "main",
          subdirectory: "packages/example",
        });

        expect(result).toEqual({ tree: "selected-tree" });
        expect(harness.requests.map(String)).toEqual([
          "https://api.github.com/repos/example/monorepo/contents/packages?ref=main",
          "https://api.github.com/repos/example/monorepo/git/trees/main",
          "https://api.github.com/repos/example/monorepo/git/trees/packages-tree",
        ]);
      }),
  );
});
