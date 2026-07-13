import { describe, expect, it } from "@effect/vitest";

import {
  fatalScriptAlertFromError,
  fatalScriptAlertFromStatus,
} from "./fatalAlert";

describe("fatal script alerts", () => {
  it("maps failed runner status into the dialog payload", () => {
    expect(
      fatalScriptAlertFromStatus({
        detailsText: "Error: failed\n    at script.js:1:1",
        failedAt: "2026-07-12T00:00:00.000Z",
        message: "failed",
        name: "Example",
        path: "/scripts/example.js",
        state: "failed",
      }),
    ).toEqual({
      detailsText: "Error: failed\n    at script.js:1:1",
      key: "status:2026-07-12T00:00:00.000Z:Example",
      message: "failed",
      sourceName: "Example",
      sourcePath: "/scripts/example.js",
    });
  });

  it("uses the error stack for rejected script starts", () => {
    const error = new Error("failed to start");
    error.stack = "Error: failed to start\n    at script.js:1:1";

    expect(
      fatalScriptAlertFromError("Example", error, "/scripts/example.js"),
    ).toMatchObject({
      detailsText: error.stack,
      message: "failed to start",
      sourceName: "Example",
      sourcePath: "/scripts/example.js",
    });
  });
});
