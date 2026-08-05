import { describe, expect, it } from "@effect/vitest";

import type { ScriptCatalogEntry } from "@lucent/core/scriptPackages";
import {
  SCRIPT_CATALOG_PAGE_SIZE,
  groupScriptCatalogPageOffsets,
  scriptCatalogEntryAt,
  scriptCatalogPageOffsetsForRange,
  storeScriptCatalogPage,
  storeScriptCatalogPageRange,
  touchScriptCatalogPages,
} from "./scriptCatalogPages";

const entry = (index: number): ScriptCatalogEntry => ({
  name: `script-${index}.js`,
  path: `/scripts/script-${index}.js`,
  reference: { kind: "loose", path: `script-${index}.js` },
  relativePath: `script-${index}.js`,
});

describe("script catalog page cache", () => {
  it("requests the visible page and one adjacent page on either side", () => {
    expect(
      scriptCatalogPageOffsetsForRange({
        endIndex: 10,
        startIndex: 0,
        total: 20_000,
      }),
    ).toEqual([0, SCRIPT_CATALOG_PAGE_SIZE]);
    expect(
      scriptCatalogPageOffsetsForRange({
        endIndex: 10_010,
        startIndex: 10_000,
        total: 20_000,
      }),
    ).toEqual([9728, 9984, 10_240]);
  });

  it("coalesces adjacent misses into bounded requests", () => {
    expect(
      groupScriptCatalogPageOffsets([
        0,
        SCRIPT_CATALOG_PAGE_SIZE,
        SCRIPT_CATALOG_PAGE_SIZE * 2,
        SCRIPT_CATALOG_PAGE_SIZE * 4,
      ]),
    ).toEqual([
      [0, SCRIPT_CATALOG_PAGE_SIZE, SCRIPT_CATALOG_PAGE_SIZE * 2],
      [SCRIPT_CATALOG_PAGE_SIZE * 4],
    ]);
  });

  it("stores a bounded LRU and resolves entries by virtual index", () => {
    let cache = new Map<number, readonly ScriptCatalogEntry[]>();
    for (let page = 0; page < 4; page += 1) {
      const offset = page * SCRIPT_CATALOG_PAGE_SIZE;
      cache = new Map(
        storeScriptCatalogPage(cache, offset, [entry(offset)], 3),
      );
    }
    expect([...cache.keys()]).toEqual([256, 512, 768]);

    cache = new Map(touchScriptCatalogPages(cache, [256], 3));
    cache = new Map(storeScriptCatalogPage(cache, 1024, [entry(1024)], 3));
    expect([...cache.keys()]).toEqual([768, 256, 1024]);
    expect(scriptCatalogEntryAt(cache, 256)?.name).toBe("script-256.js");
    expect(scriptCatalogEntryAt(cache, 512)).toBeUndefined();

    const current = touchScriptCatalogPages(cache, [256, 1024], 3);
    expect(current).toBe(cache);
  });

  it("splits a coalesced response back into cache pages", () => {
    const entries = Array.from(
      { length: SCRIPT_CATALOG_PAGE_SIZE * 2 },
      (_, index) => entry(index),
    );
    const cache = storeScriptCatalogPageRange(new Map(), 0, entries, [
      0,
      SCRIPT_CATALOG_PAGE_SIZE,
    ]);

    expect(scriptCatalogEntryAt(cache, 0)?.name).toBe("script-0.js");
    expect(scriptCatalogEntryAt(cache, SCRIPT_CATALOG_PAGE_SIZE)?.name).toBe(
      `script-${SCRIPT_CATALOG_PAGE_SIZE}.js`,
    );
  });
});
