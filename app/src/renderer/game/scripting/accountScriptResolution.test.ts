import { describe, expect, it } from "vitest";

import type { ScriptFileResolution } from "../../../shared/ipc/scripting";
import {
  AccountScriptResolutionError,
  resolveAccountScript,
} from "./accountScriptResolution";

const resolveWith = (resolution: ScriptFileResolution) => async () =>
  resolution;

describe("account script resolution", () => {
  it("treats a missing file as no script", async () => {
    await expect(
      resolveAccountScript(
        resolveWith({ status: "missing", path: "/scripts/farm.js" }),
        "/scripts/farm.js",
      ),
    ).resolves.toBeNull();
  });

  it("returns the current immutable file snapshot", async () => {
    const file = {
      inputs: null,
      name: "farm.js",
      path: "/scripts/farm.js",
      revision: "abc123",
      source: "module.exports = function* run() {};",
    } as const;

    await expect(
      resolveAccountScript(resolveWith({ status: "found", file }), file.path),
    ).resolves.toEqual(file);
  });

  it("preserves processing details for the script error dialog", async () => {
    const result = resolveAccountScript(
      resolveWith({
        status: "failed",
        path: "/scripts/farm.js",
        message: "Script source could not be parsed.",
        detailsText: "SyntaxError: Unexpected token\n    at farm.js:1:1",
      }),
      "/scripts/farm.js",
    );

    await expect(result).rejects.toMatchObject({
      name: "AccountScriptResolutionError",
      message: "Script source could not be parsed.",
      stack: "SyntaxError: Unexpected token\n    at farm.js:1:1",
    } satisfies Partial<AccountScriptResolutionError>);
  });
});
