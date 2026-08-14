import type { WebContents } from "electron";

export type RendererReloadContentTarget = Pick<
  WebContents,
  "getType" | "isDestroyed" | "reloadIgnoringCache"
>;

type RendererContentType = ReturnType<WebContents["getType"]>;

const reloadableRendererTypes: ReadonlySet<RendererContentType> = new Set([
  "browserView",
  "window",
]);

export const reloadUsableRendererContents = (
  contents: Iterable<RendererReloadContentTarget>,
): number => {
  let reloadCount = 0;
  for (const renderer of contents) {
    if (
      renderer.isDestroyed() ||
      !reloadableRendererTypes.has(renderer.getType())
    ) {
      continue;
    }

    renderer.reloadIgnoringCache();
    reloadCount += 1;
  }
  return reloadCount;
};
