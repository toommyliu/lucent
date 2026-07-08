import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas";

describe("baseSchemas", () => {
  it("trims strings during decode", () => {
    expect(Schema.decodeUnknownSync(TrimmedString)("  Hero ")).toBe("Hero");
  });

  it("trims non-empty strings during decode", () => {
    expect(Schema.decodeUnknownSync(TrimmedNonEmptyString)("  Hero ")).toBe(
      "Hero",
    );
  });

  it("rejects empty strings after trimming", () => {
    expect(() =>
      Schema.decodeUnknownSync(TrimmedNonEmptyString)("   "),
    ).toThrow();
  });

  it("accepts zero as a non-negative integer", () => {
    expect(Schema.decodeUnknownSync(NonNegativeInt)(0)).toBe(0);
  });

  it("rejects negative non-negative integers", () => {
    expect(() => Schema.decodeUnknownSync(NonNegativeInt)(-1)).toThrow();
  });

  it("accepts one as a positive integer", () => {
    expect(Schema.decodeUnknownSync(PositiveInt)(1)).toBe(1);
  });

  it("rejects zero as a positive integer", () => {
    expect(() => Schema.decodeUnknownSync(PositiveInt)(0)).toThrow();
  });
});
