if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, "at", {
    configurable: true,
    value<T>(this: ArrayLike<T>, index: number): T | undefined {
      const length = this.length;
      const relativeIndex = Math.trunc(index) || 0;
      const resolvedIndex =
        relativeIndex < 0 ? length + relativeIndex : relativeIndex;

      if (resolvedIndex < 0 || resolvedIndex >= length) {
        return undefined;
      }

      return this[resolvedIndex];
    },
    writable: true,
  });
}

if (!Array.prototype.toReversed) {
  Object.defineProperty(Array.prototype, "toReversed", {
    configurable: true,
    value<T>(this: ArrayLike<T>): T[] {
      const length = this.length;
      const output = Array.from<T>({ length });

      for (let index = 0; index < length; index += 1) {
        output[index] = this[length - index - 1] as T;
      }

      return output;
    },
    writable: true,
  });
}
