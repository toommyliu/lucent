import {
  roundStartupMs,
  startupNow,
  writeRendererStartupTiming,
} from "../../startup-timing";

const marks = new Map<string, number>();
const oneShotEvents = new Set<string>();

export const markGameStartup = (name: string): void => {
  if (!marks.has(name)) {
    marks.set(name, startupNow());
  }
};

export const writeGameStartupTiming = (
  message: string,
  data?: Record<string, unknown>,
): void => {
  const entries = Array.from(marks.entries());
  const firstMark = entries[0]?.[1] ?? startupNow();
  const markData: Record<string, number> = {};

  for (const [name, time] of entries) {
    markData[name] = roundStartupMs(time);
  }

  writeRendererStartupTiming(
    "game-startup",
    message,
    {
      ...data,
      marks: markData,
      sinceFirstGameMarkMs: roundStartupMs(startupNow() - firstMark),
    },
    {
      source: "game",
    },
  );
};

export const writeGameStartupTimingOnce = (
  key: string,
  message: string,
  data?: Record<string, unknown>,
): void => {
  if (oneShotEvents.has(key)) {
    return;
  }

  oneShotEvents.add(key);
  writeGameStartupTiming(message, data);
};

markGameStartup("bundle-evaluation-start");
