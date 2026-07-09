import { describe, expect, it } from "@effect/vitest";

import { formatGameConsoleArguments } from "./gameConsoleForwarder";

describe("game console forwarder", () => {
  it("serializes object console arguments instead of flattening them", () => {
    expect(
      formatGameConsoleArguments([
        "payload",
        { item: "drop", meta: { quantity: 2 } },
      ]),
    ).toBe(`payload {
  "item": "drop",
  "meta": {
    "quantity": 2
  }
}`);
  });

  it("serializes circular objects and errors", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const error = new Error("boom");

    const message = formatGameConsoleArguments([circular, error]);

    expect(message).toContain('"self": "[Circular]"');
    expect(message).toContain("Error: boom");
  });

  it("caps output length while formatting large object properties", () => {
    const message = formatGameConsoleArguments(
      [{ payload: "x".repeat(10_000) }],
      { maxChars: 128 },
    );

    expect(message.length).toBeLessThanOrEqual(128);
    expect(message).toContain("...[Truncated]");
  });

  it("does not read object properties beyond the configured key cap", () => {
    const reads: string[] = [];
    const payload: Record<string, string> = {};
    for (const key of ["first", "second", "third"]) {
      Object.defineProperty(payload, key, {
        enumerable: true,
        get: () => {
          reads.push(key);
          return key;
        },
      });
    }

    const message = formatGameConsoleArguments([payload], {
      maxObjectKeys: 2,
    });

    expect(reads).toEqual(["first", "second"]);
    expect(message).toContain("... more properties");
    expect(message).not.toContain('"third"');
  });

  it("does not read array items beyond the configured item cap", () => {
    const reads: string[] = [];
    const payload = ["first", "second", "third"];
    for (const index of [0, 1, 2]) {
      Object.defineProperty(payload, index, {
        enumerable: true,
        get: () => {
          const value = String(index);
          reads.push(value);
          return value;
        },
      });
    }

    const message = formatGameConsoleArguments([payload], {
      maxArrayItems: 2,
    });

    expect(reads).toEqual(["0", "1"]);
    expect(message).toContain("... 1 more items");
    expect(message).not.toContain('"2"');
  });
});
