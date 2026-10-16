import type { WebContents } from "electron";

export type RendererReloadContentTarget = Pick<
  WebContents,
  "isDestroyed" | "reloadIgnoringCache"
>;

export const reloadUsableRendererContents = (
  contents: Iterable<RendererReloadContentTarget>,
): number => {
  let reloadCount = 0;
  for (const renderer of contents) {
    if (renderer.isDestroyed()) {
      continue;
    }

    renderer.reloadIgnoringCache();
    reloadCount += 1;
  }
  return reloadCount;
};
