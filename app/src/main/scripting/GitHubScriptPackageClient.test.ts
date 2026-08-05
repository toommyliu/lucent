import { describe, expect, it } from "@effect/vitest";

import {
  GitHubRequestQueue,
  normalizeGitHubRepositoryUrl,
} from "./GitHubScriptPackageClient";

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
});
