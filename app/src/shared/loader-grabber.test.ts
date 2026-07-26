import { describe, expect, it } from "vitest";

import {
  loaderGrabberLoadRequiresId,
  normalizeLoaderGrabberGrabRequest,
  normalizeLoaderGrabberLoadRequest,
} from "./loader-grabber";

describe("loader grabber requests", () => {
  it("normalizes ID-based loader requests", () => {
    expect(
      normalizeLoaderGrabberLoadRequest({ id: " 42 ", type: "shop" }),
    ).toEqual({ id: 42, type: "shop" });
  });

  it("does not require an ID for the armor customizer", () => {
    expect(loaderGrabberLoadRequiresId("armor-customizer")).toBe(false);
    expect(
      normalizeLoaderGrabberLoadRequest({
        id: "ignored",
        type: "armor-customizer",
      }),
    ).toEqual({ type: "armor-customizer" });
  });

  it("rejects malformed loader IDs and grabber sources", () => {
    expect(() =>
      normalizeLoaderGrabberLoadRequest({ id: "1.5", type: "quest" }),
    ).toThrow("positive integer");
    expect(() => normalizeLoaderGrabberGrabRequest({ type: "house" })).toThrow(
      "valid grabber source",
    );
  });
});
