import { describe, expect, it } from "@effect/vitest";

import {
  fatalScriptAlertFromError,
  fatalScriptAlertFromStatus,
} from "./fatalAlert";

describe("fatal script alerts", () => {
  it.each(["error", "status"] as const)(
    "maps a fatal %s to the dialog with readable source attribution",
    (kind) => {
      const message = "lucent-script://loose/error.js?v=abc:2:9: hello world";
      const stack =
        "Error: " +
        message +
        "\n    at lucent-script://loose/error.js?v=abc:2:9";
      const error = new Error(message);
      error.stack = stack;
      const alert =
        kind === "error"
          ? fatalScriptAlertFromError("error.js", error, "/scripts/error.js")
          : fatalScriptAlertFromStatus({
              state: "failed",
              name: "error.js",
              path: "/scripts/error.js",
              failedAt: "now",
              message,
              detailsText: stack,
            });
      expect(alert).toMatchObject({
        sourceName: "error.js",
        sourcePath: "/scripts/error.js",
        message: "error.js:2:9: hello world",
        detailsText: "Error: error.js:2:9: hello world\n    at error.js:2:9",
      });
      if (kind === "status") expect(alert.key).toBe("status:now:error.js");
    },
  );
});
