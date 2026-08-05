import { describe, expect, it } from "@effect/vitest";

import {
  attributedScriptErrorDetails,
  attributedScriptErrorMessage,
  firstScriptSourceFrame,
  normalizeScriptSourceStack,
} from "./scriptSourceAttribution";

describe("script source attribution", () => {
  it("maps CommonJS wrapper lines back to package source", () => {
    const stack = [
      "Error: failed",
      "    at run (lucent-script://package/%40a%2Fb/lib/quests.js?v=abc:21:11)",
    ].join("\n");

    expect(normalizeScriptSourceStack(stack)).toContain(
      "lucent-script://package/%40a%2Fb/lib/quests.js?v=abc:18:11",
    );
    expect(firstScriptSourceFrame(stack)).toEqual({
      column: 11,
      displayPath: "@a/b/lib/quests.js",
      line: 18,
      url: "lucent-script://package/%40a%2Fb/lib/quests.js?v=abc",
    });
  });

  it("uses an attributed cause in the primary message and preserves both stacks", () => {
    const cause = new Error("boom");
    cause.stack = [
      "Error: boom",
      "    at run (lucent-script://loose/farming/example.js?v=abc:7:5)",
    ].join("\n");
    const outer = new Error("Script execution failed");
    Reflect.set(outer, "cause", cause);

    expect(attributedScriptErrorMessage(outer)).toBe(
      "farming/example.js:4:5: Script execution failed",
    );
    expect(attributedScriptErrorDetails(outer)).toContain("Caused by:");
    expect(attributedScriptErrorDetails(outer)).toContain(
      "lucent-script://loose/farming/example.js?v=abc:4:5",
    );
  });
});
