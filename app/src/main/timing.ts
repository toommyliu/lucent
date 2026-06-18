import { performance } from "perf_hooks";

export const timingNow = (): number => performance.now();

export const roundTimingMs = (value: number): number =>
  Number(value.toFixed(2));
