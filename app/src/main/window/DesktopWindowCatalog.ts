export type DesktopWindowKind = "game" | "settings";
export type DesktopViewId = "game" | "settings";
export type DesktopWindowCloseBehavior = "destroy" | "hide";

export interface DesktopWindowDefinition {
  readonly closeBehavior: DesktopWindowCloseBehavior;
  readonly height: number;
  readonly kind: DesktopWindowKind;
  readonly minHeight?: number;
  readonly minWidth?: number;
  readonly requiresFlashPlugin: boolean;
  readonly singleInstance: boolean;
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
      closeBehavior: "destroy",
      requiresFlashPlugin: true,
      singleInstance: false,
    },
  ],
  [
    "settings",
    {
      kind: "settings",
      view: "settings",
      width: 651,
      height: 654,
      minWidth: 560,
      minHeight: 520,
      closeBehavior: "hide",
      requiresFlashPlugin: false,
      singleInstance: true,
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
