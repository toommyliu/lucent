import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  SCRIPT_BUILTIN_MODULE_SPECIFIERS,
  ScriptPackageDirectorySchema,
  ScriptPackageNameSchema,
  isScriptBuiltinModuleSpecifier,
} from "./scriptPackages";

const isScriptPackageName = Schema.is(ScriptPackageNameSchema);
const isScriptPackageDirectory = Schema.is(ScriptPackageDirectorySchema);

describe("scriptPackages", () => {
  it("recognizes every built-in scripting module", () => {
    expect(SCRIPT_BUILTIN_MODULE_SPECIFIERS).toEqual([
      "effect",
      "lucent/api",
      "lucent/autorelogin",
      "lucent/autozone",
      "lucent/script",
    ]);

    for (const specifier of SCRIPT_BUILTIN_MODULE_SPECIFIERS) {
      expect(isScriptBuiltinModuleSpecifier(specifier)).toBe(true);
    }
    expect(isScriptBuiltinModuleSpecifier("lucent")).toBe(false);
    expect(isScriptBuiltinModuleSpecifier("@lucent/api")).toBe(false);
    expect(isScriptBuiltinModuleSpecifier("lucent/unknown")).toBe(false);
  });

  it("reserves built-in and future lucent package names", () => {
    for (const packageName of [
      "lucent",
      "effect",
      "lucent/api",
      "lucent/future-module",
    ]) {
      expect(isScriptPackageName(packageName)).toBe(false);
    }

    expect(isScriptPackageName("utilities")).toBe(true);
    expect(isScriptPackageName("@lucent/utilities")).toBe(true);
    expect(isScriptPackageName("@author/utilities")).toBe(true);
  });

  it("accepts portable package folder names without paths", () => {
    expect(isScriptPackageDirectory("daily-package")).toBe(true);
    expect(isScriptPackageDirectory("@lucent-dailies")).toBe(true);
    expect(isScriptPackageDirectory("@lucent/dailies")).toBe(false);
    expect(isScriptPackageDirectory("../dailies")).toBe(false);
    expect(isScriptPackageDirectory("con")).toBe(false);
  });
});
