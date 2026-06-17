import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  args0,
  args1,
  args2,
  defineDesktopIpcInvokeContract,
  defineIpcInvokeContract,
  nullableReturn,
  voidReturn,
} from "./ipc-contract";

const parseString = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new Error("Expected string");
  }

  return value;
};

const parseNumber = (value: unknown): number => {
  if (typeof value !== "number") {
    throw new Error("Expected number");
  }

  return value;
};

describe("ipc-contract", () => {
  it("parses zero-argument tuples", () => {
    const contract = defineIpcInvokeContract({
      channel: "test:zero",
      parseArgs: args0(),
      parseReturn: voidReturn,
    });

    expect(contract.parseArgs([])).toEqual([]);
    expect(() => contract.parseArgs(["extra"])).toThrow(
      "test:zero expected 0 argument(s), received 1",
    );
  });

  it("reports the channel and argument index for parser failures", () => {
    const contract = defineIpcInvokeContract({
      channel: "test:one",
      parseArgs: args1(parseString),
      parseReturn: voidReturn,
    });

    expect(() => contract.parseArgs([1])).toThrow(
      "test:one argument 0: Expected string",
    );
  });

  it("parses two-argument tuples", () => {
    const contract = defineIpcInvokeContract({
      channel: "test:two",
      parseArgs: args2(parseString, parseNumber),
      parseReturn: voidReturn,
    });

    expect(contract.parseArgs(["value", 2])).toEqual(["value", 2]);
    expect(() => contract.parseArgs(["value"])).toThrow(
      "test:two expected 2 argument(s), received 1",
    );
  });

  it("validates void and nullable returns", () => {
    expect(voidReturn(undefined)).toBeUndefined();
    expect(() => voidReturn(null)).toThrow("Expected void return value");

    const parseNullableString = nullableReturn(parseString);
    expect(parseNullableString(null)).toBeNull();
    expect(parseNullableString("ok")).toBe("ok");
    expect(() => parseNullableString(1)).toThrow("Expected string");
  });

  it.effect("decodes and encodes schema-backed desktop contracts", () =>
    Effect.gen(function* () {
      const contract = defineDesktopIpcInvokeContract({
        channel: "desktop:test:schema",
        argsSchema: Schema.Tuple([Schema.String]) as unknown as Schema.Codec<
          [string],
          unknown
        >,
        returnSchema: Schema.Number as Schema.Codec<number, unknown>,
      });

      expect(yield* contract.decodeArgsEffect(["ok"])).toEqual(["ok"]);
      expect(yield* contract.decodeReturnEffect(1)).toBe(1);
      expect(yield* contract.encodeReturnEffect(2)).toBe(2);
    }),
  );

  it.effect("fails schema-backed desktop contracts on invalid args", () =>
    Effect.gen(function* () {
      const contract = defineDesktopIpcInvokeContract({
        channel: "desktop:test:schema-args",
        argsSchema: Schema.Tuple([Schema.String]) as unknown as Schema.Codec<
          [string],
          unknown
        >,
        returnSchema: Schema.Void as Schema.Codec<void, unknown>,
      });
      const error = yield* Effect.flip(contract.decodeArgsEffect([1]));

      expect(Schema.isSchemaError(error)).toBe(true);
    }),
  );

  it.effect("fails schema-backed desktop contracts on invalid returns", () =>
    Effect.gen(function* () {
      const contract = defineDesktopIpcInvokeContract({
        channel: "desktop:test:schema-return",
        argsSchema: Schema.Tuple([]) as unknown as Schema.Codec<[], unknown>,
        returnSchema: Schema.String as Schema.Codec<string, unknown>,
      });
      const error = yield* Effect.flip(
        contract.encodeReturnEffect(1 as unknown as string),
      );

      expect(Schema.isSchemaError(error)).toBe(true);
    }),
  );
});
