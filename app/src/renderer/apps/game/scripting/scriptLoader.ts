import { Effect, Schema } from "effect";

import type { ScriptLucentStd, ScriptMain } from "./ScriptApi";
import { scriptEffectStd } from "./ScriptEffectStd";

export class ScriptLoadError extends Schema.TaggedErrorClass<ScriptLoadError>()(
  "ScriptLoadError",
  {
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface LoadedScriptModule {
  readonly main: ScriptMain;
}

interface CommonJsModule {
  exports: unknown;
}

type CommonJsRequire = (id: string) => unknown;

const CommonJsFunction = Function as unknown as new (
  ...args: string[]
) => (
  module: CommonJsModule,
  exports: unknown,
  require: CommonJsRequire,
) => void;

export const sanitizeScriptSourceUrl = (
  name: string | undefined,
  revision?: string,
): string => {
  const fallback = "anonymous-script";
  const normalized = (name ?? fallback)
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop();
  const slug = (normalized ?? fallback)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const sourceUrl = `lucent-script://${encodeURIComponent(slug === "" ? fallback : slug)}`;
  const normalizedRevision = revision?.trim();
  return normalizedRevision === undefined || normalizedRevision === ""
    ? sourceUrl
    : `${sourceUrl}?v=${encodeURIComponent(normalizedRevision)}`;
};

const isGeneratorFunction = (value: unknown): value is ScriptMain =>
  typeof value === "function" &&
  value.constructor?.name === "GeneratorFunction";

const makeRequire =
  (lucent: ScriptLucentStd): CommonJsRequire =>
  (id) => {
    switch (id) {
      case "effect":
        return scriptEffectStd;
      case "lucent":
        return lucent;
      default:
        throw new ScriptLoadError({
          detail: `Unsupported script import: ${id}.`,
        });
    }
  };

export const loadScriptModule = (input: {
  readonly lucent: ScriptLucentStd;
  readonly name?: string;
  readonly revision?: string;
  readonly source: string;
}): Effect.Effect<LoadedScriptModule, ScriptLoadError> =>
  Effect.try({
    try: () => {
      const module: CommonJsModule = { exports: {} };
      const sourceUrl = sanitizeScriptSourceUrl(input.name, input.revision);
      const execute = new CommonJsFunction(
        "module",
        "exports",
        "require",
        `"use strict";\n${input.source}\n//# sourceURL=${sourceUrl}`,
      );
      execute(module, module.exports, makeRequire(input.lucent));

      if (!isGeneratorFunction(module.exports)) {
        throw new ScriptLoadError({
          detail: "Script must export a generator function.",
        });
      }

      return { main: module.exports };
    },
    catch: (cause) =>
      cause instanceof ScriptLoadError
        ? cause
        : new ScriptLoadError({
            detail: "Script failed to load.",
            cause,
          }),
  });
