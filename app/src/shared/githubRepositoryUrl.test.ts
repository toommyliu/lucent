import { describe, expect, it } from "vitest";

import { parseGitHubRepositoryInput } from "./githubRepositoryUrl";

describe("parseGitHubRepositoryInput", () => {
  it("normalizes GitHub repository URLs", () => {
    expect(
      parseGitHubRepositoryInput("https://github.com/example/tools.git/"),
    ).toEqual({
      kind: "repository",
      repository: {
        owner: "example",
        repository: "tools",
        url: "https://github.com/example/tools",
      },
    });
  });

  it.each([
    {
      ref: "9141d4488219b3351f6ce3eee6a76783cdf1e15d",
      repository: "lucent-script-package-example",
      source:
        "https://github.com/toommyliu/lucent-script-package-example/tree/9141d4488219b3351f6ce3eee6a76783cdf1e15d",
    },
    {
      ref: "main",
      repository: "lucent-script-package-example",
      source:
        "https://github.com/toommyliu/lucent-script-package-example/tree/main",
    },
    {
      ref: "feature/install",
      repository: "example",
      source: "https://github.com/toommyliu/example/tree/feature%2Finstall",
    },
  ])(
    "suggests the repository and ref for $source",
    ({ ref, repository, source }) => {
      expect(parseGitHubRepositoryInput(source)).toEqual({
        kind: "tree",
        ref,
        repository: {
          owner: "toommyliu",
          repository,
          url: `https://github.com/toommyliu/${repository}`,
        },
      });
    },
  );

  it.each([
    "",
    "http://github.com/example/tools",
    "https://token@github.com/example/tools",
    "https://github.com:444/example/tools",
    "https://github.com/example/tools/tree/main/packages/scripts",
    "https://github.com/example/tools?ref=main",
    "https://gitlab.com/example/tools",
  ])("rejects invalid or ambiguous input %s", (source) => {
    expect(parseGitHubRepositoryInput(source)).toEqual({ kind: "invalid" });
  });
});
