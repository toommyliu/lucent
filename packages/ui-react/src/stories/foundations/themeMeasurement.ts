import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributeFilter: ["data-theme", "style"],
    attributes: true,
  });
  return () => observer.disconnect();
}

function themeKey(): string {
  const root = document.documentElement;
  return `${root.dataset["theme"] ?? "light"}|${root.getAttribute("style") ?? ""}`;
}

export function createThemeMeasurement<T>(measure: () => T): () => T {
  let cached: { readonly key: string; readonly value: T } | null = null;
  const getSnapshot = (): T => {
    const key = themeKey();
    if (cached === null || cached.key !== key) {
      cached = { key, value: measure() };
    }
    return cached.value;
  };
  return () => useSyncExternalStore(subscribe, getSnapshot);
}
