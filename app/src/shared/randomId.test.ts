import { afterEach, describe, expect, it, vi } from "@effect/vitest";

import { createRandomId } from "./randomId";

afterEach(() => vi.unstubAllGlobals());

describe("createRandomId", () => {
  it.each([undefined, "", "profile"])(
    "encodes every random byte with prefix %s",
    (prefix) => {
      const getRandomValues = vi.fn((bytes: Uint8Array) => {
        bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 127, 128, 255]);
        return bytes;
      });
      vi.stubGlobal("crypto", { getRandomValues });
      expect(createRandomId(prefix)).toBe(
        (prefix ? prefix + "-" : "") + "000102030405060708090a0f107f80ff",
      );
      expect(getRandomValues).toHaveBeenCalledOnce();
    },
  );
});
