export type DesktopWindowKind = "game";
export type DesktopViewId = "game";

export interface DesktopWindowDefinition {
  readonly height: number;
  readonly kind: DesktopWindowKind;
  readonly minHeight?: number;
  readonly minWidth?: number;
  readonly requiresFlashPlugin: boolean;
  readonly view: DesktopViewId;
  readonly width: number;
}

const desktopWindowCatalog: ReadonlyMap<
  DesktopWindowKind,
  DesktopWindowDefinition
> = new Map([
  [
    "game",
    {
      kind: "game",
      view: "game",
      width: 1024,
      height: 768,
      minWidth: 800,
      minHeight: 600,
      requiresFlashPlugin: true,
    },
  ],
]);

export const getDesktopWindowDefinition = (
  kind: DesktopWindowKind,
): DesktopWindowDefinition => {
  const definition = desktopWindowCatalog.get(kind);
  if (definition === undefined) {
    throw new Error(`Unknown desktop window kind: ${kind}`);
  }

  return definition;
};
