import { describe, expect, it } from "@effect/vitest";

import { createRandomId } from "./randomId";

describe("createRandomId", () => {
  it("creates an opaque id without a prefix", () => {
    expect(createRandomId()).toMatch(/^[a-f0-9]{32}$/u);
  });

  it("adds a readable prefix when provided", () => {
    expect(createRandomId("profile")).toMatch(/^profile-[a-f0-9]{32}$/u);
  });
});
