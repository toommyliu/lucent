import { describe, expect, it, vi } from "@effect/vitest";

import {
  attributedScriptErrorDetails,
  attributedScriptErrorMessage,
  firstScriptSourceFrame,
  displayScriptSourceText,
  normalizeScriptSourceStack,
} from "./scriptSourceAttribution";

describe("script source attribution", () => {
  it("displays paths without revisions and preserves message locations", () => {
    expect(
      displayScriptSourceText(
        "lucent-script://loose/error.js?v=abc:2:9: hello world",
      ),
    ).toBe("error.js:2:9: hello world");
    expect(
      displayScriptSourceText(
        "Failed in lucent-script://package/%40a%2Fb/lib/my%20script.js?v=abc:18:11",
      ),
    ).toBe("Failed in @a/b/lib/my script.js:18:11");
    expect(
      displayScriptSourceText("Request to https://example.com failed"),
    ).toBe("Request to https://example.com failed");
  });

  it("formats source URLs when the renderer URL constructor rejects custom schemes", () => {
    vi.stubGlobal("URL", function URL() {
      throw new TypeError("Invalid URL");
    });
    try {
      expect(
        displayScriptSourceText(
          "lucent-script://loose/error.js?v=abc:2:9: hello world",
        ),
      ).toBe("error.js:2:9: hello world");
      expect(
        attributedScriptErrorMessage(
          new Error("lucent-script://loose/error.js?v=abc:2:9: hello world"),
        ),
      ).toBe("error.js:2:9: hello world");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not absorb location numbers into a URL followed by an error message", () => {
    expect(
      firstScriptSourceFrame(
        "lucent-script://loose/error.js?v=abc:5:9: hello world",
      ),
    ).toMatchObject({ displayPath: "error.js", line: 2, column: 9 });
  });

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
