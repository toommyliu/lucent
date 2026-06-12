import type {
  AccountManagerWindowBridge,
  AppBridge,
  BaseWindowBridge,
  BaseWindowsBridge,
  GameWindowBridge,
  ScopedAppBridge,
  ToolWindowBridge,
  WindowsBridge,
} from "../shared/ipc";
import type { PreloadWindowContext } from "../shared/window-startup-context";
import { WindowIds } from "../shared/windows";

export interface PreloadBridgeParts extends Omit<AppBridge, "windows"> {
  readonly baseWindows: BaseWindowsBridge;
  readonly gameWindows: WindowsBridge;
}

const makeBaseBridge = (parts: PreloadBridgeParts): BaseWindowBridge => ({
  observability: parts.observability,
  platform: parts.platform,
  settings: parts.settings,
  updates: parts.updates,
  windows: parts.baseWindows,
});

const makeGameBridge = (parts: PreloadBridgeParts): GameWindowBridge => ({
  ...makeBaseBridge(parts),
  accounts: parts.accounts,
  army: parts.army,
  combatProfiles: parts.combatProfiles,
  environment: parts.environment,
  fastTravels: parts.fastTravels,
  follower: parts.follower,
  loaderGrabber: parts.loaderGrabber,
  packets: parts.packets,
  scripting: parts.scripting,
  windows: parts.gameWindows,
});

const makeAccountManagerBridge = (
  parts: PreloadBridgeParts,
): AccountManagerWindowBridge => ({
  ...makeBaseBridge(parts),
  accounts: parts.accounts,
  scripting: parts.scripting,
});

export const selectScopedBridge = (
  context: PreloadWindowContext | null,
  parts: PreloadBridgeParts,
): ScopedAppBridge => {
  const base = makeBaseBridge(parts);
  if (context === null) {
    return base;
  }

  if (context.kind === "game") {
    return makeGameBridge(parts);
  }

  if (context.kind === "app") {
    if (context.id === WindowIds.AccountManager) {
      return makeAccountManagerBridge(parts);
    }

    return base;
  }

  switch (context.id) {
    case WindowIds.Environment:
      return {
        ...base,
        environment: parts.environment,
      } satisfies ToolWindowBridge<typeof WindowIds.Environment>;
    case WindowIds.FastTravels:
      return {
        ...base,
        fastTravels: parts.fastTravels,
      } satisfies ToolWindowBridge<typeof WindowIds.FastTravels>;
    case WindowIds.Follower:
      return {
        ...base,
        combatProfiles: parts.combatProfiles,
        follower: parts.follower,
      } satisfies ToolWindowBridge<typeof WindowIds.Follower>;
    case WindowIds.LoaderGrabber:
      return {
        ...base,
        loaderGrabber: parts.loaderGrabber,
      } satisfies ToolWindowBridge<typeof WindowIds.LoaderGrabber>;
    case WindowIds.Packets:
      return {
        ...base,
        packets: parts.packets,
      } satisfies ToolWindowBridge<typeof WindowIds.Packets>;
    case WindowIds.Skills:
      return {
        ...base,
        combatProfiles: parts.combatProfiles,
      } satisfies ToolWindowBridge<typeof WindowIds.Skills>;
    case WindowIds.AccountManager:
    case WindowIds.Settings:
      return base;
  }
};
