import type { ObservabilitySource } from "../shared/observability";

interface StartupTimingOptions {
  readonly source?: ObservabilitySource;
}

const now = (): number =>
  typeof performance === "undefined" ? Date.now() : performance.now();

const roundMs = (value: number): number => Number(value.toFixed(2));

const readNavigationTiming = (): Record<string, number> | undefined => {
  if (typeof performance === "undefined") {
    return undefined;
  }

  const [navigation] = performance.getEntriesByType(
    "navigation",
  ) as PerformanceNavigationTiming[];
  if (!navigation) {
    return undefined;
  }

  return {
    domInteractiveMs: roundMs(navigation.domInteractive),
    domContentLoadedMs: roundMs(navigation.domContentLoadedEventEnd),
    loadEventMs: roundMs(navigation.loadEventEnd),
    responseEndMs: roundMs(navigation.responseEnd),
  };
};

export const startupNow = now;

export const writeRendererStartupTiming = (
  component: string,
  message: string,
  data: Record<string, unknown>,
  options?: StartupTimingOptions,
): void => {
  if (typeof window === "undefined") {
    return;
  }

  const observability = window.ipc?.observability;
  if (!observability) {
    return;
  }

  void observability
    .write({
      level: "info",
      source: options?.source ?? "renderer",
      component,
      message,
      data: {
        ...data,
        navigation: readNavigationTiming(),
        pathname: window.location.pathname,
        atMs: roundMs(now()),
      },
    })
    .catch(() => undefined);
};

export const durationSince = (startMs: number): number =>
  roundMs(now() - startMs);

export const roundStartupMs = roundMs;
