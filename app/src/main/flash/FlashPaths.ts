import { join } from "path";

export const resolvePepperFlashPluginPath = (options: {
  readonly override?: string;
  readonly platform: NodeJS.Platform;
  readonly workspaceDir: string;
}): string | null => {
  if (options.override !== undefined) {
    return options.override;
  }

  if (options.platform === "darwin") {
    return join(options.workspaceDir, "PepperFlashPlayer.plugin");
  }

  if (options.platform === "win32") {
    return join(options.workspaceDir, "pepflashplayer.dll");
  }

  if (options.platform === "linux") {
    return join(options.workspaceDir, "libpepflashplayer.so");
  }

  return null;
};

export const resolveFlashTrustRootPath = (appDataDir: string): string =>
  join(appDataDir, "Pepper Data", "Shockwave Flash", "WritableRoot");

export const resolveFlashPreferenceTemplateRootPath = (
  appDataDir: string,
): string => join(appDataDir, "Game Profiles", "Shared Preferences");
