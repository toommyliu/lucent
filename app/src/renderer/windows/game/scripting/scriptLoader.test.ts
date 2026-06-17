import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { ScriptLoadError } from "./Errors";
import { loadScriptModule } from "./scriptLoader";

describe("script loader", () => {
  it.effect("loads a CommonJS generator export", () =>
    Effect.gen(function* () {
      const loaded = yield* loadScriptModule(
        `
const { features, script, api } = require("lucent")

module.exports = function* run() {
  script.log("ready")
}
`,
        "loader.test.js",
      );

      expect(loaded.main.constructor.name).toBe("GeneratorFunction");
    }),
  );

  it.effect("loads the lucent runtime import during module evaluation", () =>
    Effect.gen(function* () {
      const loaded = yield* loadScriptModule(
        `
const { features, script, api } = require("lucent")
const useSkill = api.combat.useSkill

module.exports = function* run() {
  script.log(String(Boolean(api.wait.forSkillReady)))
  yield* useSkill(1)
}
`,
        "lucent-import.test.js",
      );

      expect(loaded.main.constructor.name).toBe("GeneratorFunction");
    }),
  );

  it.effect("rejects missing exports", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        loadScriptModule("const x = 1", "missing.test.js"),
      );
      expect(error).toBeInstanceOf(ScriptLoadError);
    }),
  );

  it.effect("rejects async exports", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        loadScriptModule(
          "module.exports = async function run() {}",
          "async.test.js",
        ),
      );
      expect(error).toBeInstanceOf(ScriptLoadError);
    }),
  );
});
