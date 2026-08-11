/** Appends a packet batch while retaining only the newest entries. */
export const appendPacketLogBatch = <T>(
  current: readonly T[],
  batch: readonly T[],
  limit: number,
): readonly T[] => {
  if (batch.length === 0) {
    return current;
  }

  const batchStart = Math.max(0, batch.length - limit);
  const retainedBatchLength = batch.length - batchStart;
  const retainedCurrentLength = Math.min(
    current.length,
    limit - retainedBatchLength,
  );
  const currentStart = current.length - retainedCurrentLength;
  const next: T[] = [];

  for (let index = 0; index < retainedCurrentLength; index += 1) {
    next.push(current[currentStart + index]!);
  }
  for (let index = 0; index < retainedBatchLength; index += 1) {
    next.push(batch[batchStart + index]!);
  }

  return next;
};
