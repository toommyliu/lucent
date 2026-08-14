export type GameViewDropEdge = "before" | "after";
export type GameViewTabNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End";

/** Returns the tab reached by a standard horizontal tablist navigation key. */
export const gameViewTabNavigationTargetId = (
  ids: readonly string[],
  currentId: string,
  key: GameViewTabNavigationKey,
): string | null => {
  const index = ids.indexOf(currentId);
  if (index < 0 || ids.length === 0) return null;

  const lastIndex = ids.length - 1;
  const targetIndex =
    key === "ArrowLeft"
      ? index === 0
        ? lastIndex
        : index - 1
      : key === "ArrowRight"
        ? index === lastIndex
          ? 0
          : index + 1
        : key === "Home"
          ? 0
          : lastIndex;
  return ids[targetIndex] ?? null;
};

/** Moves the dragged tabs as one block while preserving their current order. */
export const reorderedGameViewIds = (
  currentIds: readonly string[],
  draggedIds: readonly string[],
  targetId: string,
  edge: GameViewDropEdge,
): readonly string[] => {
  const draggedIdSet = new Set(draggedIds);
  if (draggedIdSet.has(targetId)) {
    return currentIds;
  }

  const orderedDraggedIds = currentIds.filter((id) => draggedIdSet.has(id));
  if (orderedDraggedIds.length === 0) {
    return currentIds;
  }

  const ids = currentIds.filter((id) => !draggedIdSet.has(id));
  const targetIndex = ids.indexOf(targetId);
  if (targetIndex < 0) {
    return currentIds;
  }
  ids.splice(targetIndex + (edge === "after" ? 1 : 0), 0, ...orderedDraggedIds);
  return ids.every((id, index) => id === currentIds[index]) ? currentIds : ids;
};
