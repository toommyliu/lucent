import type { ScriptCatalogEntry } from "@lucent/core/scriptPackages";

export const SCRIPT_CATALOG_PAGE_SIZE = 256;
export const SCRIPT_CATALOG_PAGE_CACHE_SIZE = 16;
export const SCRIPT_CATALOG_PAGES_PER_REQUEST = 4;

export type ScriptCatalogPageCache = ReadonlyMap<
  number,
  readonly ScriptCatalogEntry[]
>;

export const scriptCatalogPageOffset = (index: number): number =>
  Math.floor(index / SCRIPT_CATALOG_PAGE_SIZE) * SCRIPT_CATALOG_PAGE_SIZE;

export const scriptCatalogEntryAt = (
  cache: ScriptCatalogPageCache,
  index: number,
): ScriptCatalogEntry | undefined => {
  const offset = scriptCatalogPageOffset(index);
  return cache.get(offset)?.[index - offset];
};

export const scriptCatalogPageOffsetsForRange = (input: {
  readonly endIndex: number;
  readonly startIndex: number;
  readonly total: number;
}): readonly number[] => {
  if (input.total <= 0 || input.endIndex < input.startIndex) return [];
  const lastIndex = input.total - 1;
  const firstVisible = Math.min(Math.max(0, input.startIndex), lastIndex);
  const lastVisible = Math.min(
    Math.max(firstVisible, input.endIndex),
    lastIndex,
  );
  const firstPage = scriptCatalogPageOffset(firstVisible);
  const lastPage = scriptCatalogPageOffset(lastVisible);
  const firstPrefetch = Math.max(0, firstPage - SCRIPT_CATALOG_PAGE_SIZE);
  const lastPrefetch = Math.min(
    scriptCatalogPageOffset(lastIndex),
    lastPage + SCRIPT_CATALOG_PAGE_SIZE,
  );
  const offsets: number[] = [];
  for (
    let offset = firstPrefetch;
    offset <= lastPrefetch;
    offset += SCRIPT_CATALOG_PAGE_SIZE
  ) {
    offsets.push(offset);
  }
  return offsets;
};

export const groupScriptCatalogPageOffsets = (
  offsets: readonly number[],
  maximumPages = SCRIPT_CATALOG_PAGES_PER_REQUEST,
): readonly (readonly number[])[] => {
  const groups: number[][] = [];
  const pageLimit = Math.max(1, Math.floor(maximumPages));
  for (const offset of [...new Set(offsets)].toSorted(
    (left, right) => left - right,
  )) {
    const group = groups.at(-1);
    const previousOffset = group?.at(-1);
    if (
      group === undefined ||
      group.length >= pageLimit ||
      previousOffset === undefined ||
      offset !== previousOffset + SCRIPT_CATALOG_PAGE_SIZE
    ) {
      groups.push([offset]);
    } else {
      group.push(offset);
    }
  }
  return groups;
};

/** Promotes pages in the LRU without notifying Solid when order is unchanged. */
export const touchScriptCatalogPages = (
  current: ScriptCatalogPageCache,
  offsets: readonly number[],
  maximumPages = SCRIPT_CATALOG_PAGE_CACHE_SIZE,
): ScriptCatalogPageCache => {
  const presentOffsets = [...new Set(offsets)].filter((offset) =>
    current.has(offset),
  );
  const currentOffsets = [...current.keys()];
  const recentOffset = currentOffsets.length - presentOffsets.length;
  if (
    current.size <= maximumPages &&
    presentOffsets.every(
      (offset, index) => currentOffsets[recentOffset + index] === offset,
    )
  ) {
    return current;
  }

  let next: Map<number, readonly ScriptCatalogEntry[]> | undefined;
  for (const offset of presentOffsets) {
    const page = (next ?? current).get(offset);
    if (page === undefined) continue;
    next ??= new Map(current);
    next.delete(offset);
    next.set(offset, page);
  }
  if (next === undefined) return current;
  while (next.size > maximumPages) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
};

export const storeScriptCatalogPage = (
  current: ScriptCatalogPageCache,
  offset: number,
  entries: readonly ScriptCatalogEntry[],
  maximumPages = SCRIPT_CATALOG_PAGE_CACHE_SIZE,
): ScriptCatalogPageCache => {
  const next = new Map(current);
  next.delete(offset);
  next.set(offset, entries);
  while (next.size > maximumPages) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
};

export const storeScriptCatalogPageRange = (
  current: ScriptCatalogPageCache,
  responseOffset: number,
  entries: readonly ScriptCatalogEntry[],
  pageOffsets: readonly number[],
  maximumPages = SCRIPT_CATALOG_PAGE_CACHE_SIZE,
): ScriptCatalogPageCache => {
  const next = new Map(current);
  for (const pageOffset of pageOffsets) {
    const entryOffset = pageOffset - responseOffset;
    if (entryOffset < 0) continue;
    next.delete(pageOffset);
    next.set(
      pageOffset,
      entries.slice(entryOffset, entryOffset + SCRIPT_CATALOG_PAGE_SIZE),
    );
  }
  while (next.size > maximumPages) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
};
