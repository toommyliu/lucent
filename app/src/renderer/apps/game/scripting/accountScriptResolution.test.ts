import { describe, expect, it } from "@effect/vitest";

import type { ScriptFileResolution } from "../../../../shared/ipc/scripting";
import {
  AccountScriptResolutionError,
  resolveAccountScript,
} from "./accountScriptResolution";

const resolveWith = (resolution: ScriptFileResolution) => async () =>
  resolution;

describe("account script resolution", () => {
  it.each(["missing", "found"] as const)(
    "resolves a %s file",
    async (status) => {
      const file = {
        inputs: null,
        name: "farm.js",
        path: "/scripts/farm.js",
        revision: "abc123",
        source: "module.exports = function* run() {};",
      };
      const resolution: ScriptFileResolution =
        status === "found" ? { status, file } : { status, path: file.path };
      await expect(
        resolveAccountScript(resolveWith(resolution), file.path),
      ).resolves.toEqual(status === "found" ? file : null);
    },
  );

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
