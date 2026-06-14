import { describe, expect, it } from "@effect/vitest";
import {
  args0,
  args1,
  args2,
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
});
