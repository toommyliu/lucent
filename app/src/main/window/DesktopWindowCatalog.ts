export type DesktopWindowKind =
  | "account-manager"
  | "combat-profiles"
  | "environment"
  | "game"
  | "settings";
export type DesktopWindowCloseBehavior = "destroy" | "hide";
export type DesktopWindowScope = "application" | "game" | "game-child";

export interface DesktopWindowDefinition {
  readonly closeBehavior: DesktopWindowCloseBehavior;
  readonly height: number;
  readonly kind: DesktopWindowKind;
  readonly minHeight?: number;
  readonly minWidth?: number;
  readonly requiresFlashPlugin: boolean;
  readonly scope: DesktopWindowScope;
  readonly singleInstance: boolean;
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
      width: 1024,
      height: 768,
      closeBehavior: "destroy",
      requiresFlashPlugin: true,
      scope: "game",
      singleInstance: false,
    },
  ],
  [
    "settings",
    {
      kind: "settings",
      width: 651,
       height: 654,
      minWidth: 560,
      minHeight: 520,
      closeBehavior: "hide",
      requiresFlashPlugin: false,
      scope: "application",
      singleInstance: true,
    },
  ],
  [
    "account-manager",
    {
      kind: "account-manager",
      width: 980,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      closeBehavior: "hide",
      requiresFlashPlugin: false,
      scope: "application",
      singleInstance: true,
    },
  ],
  [
    "combat-profiles",
    {
      kind: "combat-profiles",
      width: 760,
      height: 560,
      minWidth: 560,
      minHeight: 460,
      closeBehavior: "hide",
      requiresFlashPlugin: false,
      scope: "application",
      singleInstance: true,
    },
  ],
  [
    "environment",
    {
      kind: "environment",
      width: 778,
      height: 613,
      closeBehavior: "hide",
      requiresFlashPlugin: false,
      scope: "game-child",
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
