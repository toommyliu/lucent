import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import type { BridgeService } from "../../flash/bridge/Bridge";
import {
  makeScriptRecipesApi,
  ScriptEnhanceItemOptionsSchema,
} from "./Recipes";
import type { ScriptRuntimeServices } from "./Services";

describe("makeScriptRecipesApi", () => {
  it.effect("normalizes valid enhance-item arguments", () =>
    Effect.gen(function* () {
      const inventorySelectors: unknown[] = [];
      const recipes = makeScriptRecipesApi(
        {
          inventory: {
            get: (selector: unknown) =>
              Effect.sync(() => {
                inventorySelectors.push(selector);
                return null;
              }),
          },
        } as unknown as ScriptRuntimeServices,
        {} as BridgeService,
      );

      expect(
        yield* recipes.enhanceItem("  Test Weapon ", {
          enhancement: "  forge ",
          special: " dauntless  ",
        }),
      ).toBe(false);
      expect(inventorySelectors).toEqual([{ name: "Test Weapon" }]);
    }),
  );

  it.effect(
    "rejects invalid enhance-item arguments at the script boundary",
    () =>
      Effect.gen(function* () {
        const recipes = makeScriptRecipesApi(
          {} as ScriptRuntimeServices,
          {} as BridgeService,
        );
        const enhanceItem = recipes.enhanceItem as (
          item: unknown,
          options: unknown,
        ) => Effect.Effect<boolean>;
        const invalidRequests: ReadonlyArray<readonly [unknown, unknown]> = [
          [null, { enhancement: "forge" }],
          ["   ", { enhancement: "forge" }],
          [0, { enhancement: "forge" }],
          [Number.MAX_SAFE_INTEGER + 1, { enhancement: "forge" }],
          [{ itemId: 100, name: "Test Weapon" }, { enhancement: "forge" }],
          ["Test Weapon", null],
          ["Test Weapon", { enhancement: "   " }],
          ["Test Weapon", { enhancement: "forge", special: 14 }],
        ];

        for (const [item, options] of invalidRequests) {
          expect(yield* enhanceItem(item, options)).toBe(false);
        }
      }),
  );

  it("normalizes enhance-item option strings", () => {
    expect(
      Schema.decodeUnknownSync(ScriptEnhanceItemOptionsSchema)({
        enhancement: "  forge ",
        special: " dauntless  ",
      }),
    ).toEqual({ enhancement: "forge", special: "dauntless" });
  });
});
