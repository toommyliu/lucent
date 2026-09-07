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

  it.each([
    ["trimmed string", TrimmedString, "  Hero ", "Hero"],
    ["trimmed nonempty", TrimmedNonEmptyString, "  Hero ", "Hero"],
    ["whitespace only", TrimmedNonEmptyString, "   ", undefined],
    ["nonnegative zero", NonNegativeInt, 0, 0],
    ["negative integer", NonNegativeInt, -1, undefined],
    ["positive integer", PositiveInt, 1, 1],
    ["positive zero", PositiveInt, 0, undefined],
    ["below lower bound", SmallInt, 1, undefined],
    ["inclusive lower bound", SmallInt, 2, 2],
    ["inclusive upper bound", SmallInt, 4, 4],
    ["above upper bound", SmallInt, 5, undefined],
  ] as const)("validates %s", (_name, schema, input, expected) => {
    const decode = () => Schema.decodeUnknownSync(schema)(input);
    if (expected === undefined) expect(decode).toThrow();
    else expect(decode()).toBe(expected);
  });
});
