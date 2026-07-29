import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  boundedInt,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas";

describe("baseSchemas", () => {
  const SmallInt = boundedInt(2, 4);

  it("decodes valid normalized primitives", () => {
    expect(Schema.decodeUnknownSync(TrimmedString)("  Hero ")).toBe("Hero");
    expect(Schema.decodeUnknownSync(TrimmedNonEmptyString)("  Hero ")).toBe(
      "Hero",
    );
    expect(Schema.decodeUnknownSync(NonNegativeInt)(0)).toBe(0);
    expect(Schema.decodeUnknownSync(PositiveInt)(1)).toBe(1);
    expect(Schema.decodeUnknownSync(SmallInt)(2)).toBe(2);
    expect(Schema.decodeUnknownSync(SmallInt)(4)).toBe(4);
  });

  it("rejects values outside primitive contracts", () => {
    expect(() =>
      Schema.decodeUnknownSync(TrimmedNonEmptyString)("   "),
    ).toThrow();
    expect(() => Schema.decodeUnknownSync(NonNegativeInt)(-1)).toThrow();
    expect(() => Schema.decodeUnknownSync(PositiveInt)(0)).toThrow();
    expect(() => Schema.decodeUnknownSync(SmallInt)(1)).toThrow();
    expect(() => Schema.decodeUnknownSync(SmallInt)(5)).toThrow();
  });
});
