const INTEGER_TOKEN_PATTERN = /^[1-9]\d*$/;

export const resolveItemIdentifier = (
  item: ItemIdentifierToken,
): ItemIdentifierToken | undefined => {
  if (typeof item === "number") {
    return Number.isFinite(item) && item > 0 ? Math.trunc(item) : undefined;
  }

  const trimmed = item.trim();
  if (trimmed === "") {
    return undefined;
  }

  if (INTEGER_TOKEN_PATTERN.test(trimmed)) {
    const itemId = Number.parseInt(trimmed, 10);
    return Number.isFinite(itemId) && itemId > 0 ? itemId : undefined;
  }

  return trimmed;
};

export const normalizeItemQuantity = (
  quantity?: number,
): number | undefined => {
  if (quantity === undefined || !Number.isFinite(quantity)) {
    return undefined;
  }

  const normalized = Math.trunc(quantity);
  return normalized > 0 ? normalized : undefined;
};
