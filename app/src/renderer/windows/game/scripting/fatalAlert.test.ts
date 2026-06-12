import { describe, expect, it } from "vitest";
import { toDiagnosticDetails } from "./errorDetails";
import {
  diagnosticDetailsText,
  stoppedScriptFatalAlertCandidate,
} from "./fatalAlert";
import type { ScriptDiagnostic } from "./Types";

const diagnostic = (patch: Partial<ScriptDiagnostic>): ScriptDiagnostic => ({
  id: 1,
  sourceName: "test-script",
  severity: "error",
  message: "boom",
  createdAt: 1,
  ...patch,
});

describe("fatal script alerts", () => {
  it("extracts nested stack traces from diagnostic details", () => {
    expect(
      diagnosticDetailsText({
        tag: "Cause",
        reasons: [
          {
            tag: "Fail",
            error: {
              message: "boom",
              cause: { stack: "Error: boom\n    at main" },
            },
          },
        ],
      }),
    ).toBe("Error: boom\n    at main");
  });

  it("falls back to JSON details when no stack exists", () => {
    expect(diagnosticDetailsText({ message: "boom", code: "E_TEST" })).toBe(
      '{\n  "message": "boom",\n  "code": "E_TEST"\n}',
    );
  });

  it("preserves long stack traces beyond ordinary string truncation", () => {
    const longMessage = `boom\n${"x".repeat(900)}`;
    const details = toDiagnosticDetails(new Error(longMessage));
    const text = diagnosticDetailsText(details);

    expect(text).toContain(longMessage);
    expect(text?.length).toBeGreaterThan(500);
  });

  it("opens only when a running script stops with a new error diagnostic", () => {
    const alert = stoppedScriptFatalAlertCandidate({
      wasRunning: true,
      isRunning: false,
      diagnostics: [diagnostic({ id: 42 })],
      lastShownKey: "",
      sourcePath: "/scripts/test-script.js",
    });

    expect(alert).toMatchObject({
      key: "diagnostic:42",
      sourceName: "test-script",
      sourcePath: "/scripts/test-script.js",
      message: "boom",
    });
  });

  it("ignores repeated refreshes for the same diagnostic", () => {
    expect(
      stoppedScriptFatalAlertCandidate({
        wasRunning: true,
        isRunning: false,
        diagnostics: [diagnostic({ id: 42 })],
        lastShownKey: "diagnostic:42",
      }),
    ).toBeUndefined();
  });

  it("ignores non-error diagnostics", () => {
    expect(
      stoppedScriptFatalAlertCandidate({
        wasRunning: true,
        isRunning: false,
        diagnostics: [diagnostic({ severity: "warning" })],
        lastShownKey: "",
      }),
    ).toBeUndefined();
  });
});
