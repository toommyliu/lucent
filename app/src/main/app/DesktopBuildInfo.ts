export interface DesktopBuildInfo {
  readonly builtAt: string | null;
  readonly commit: string | null;
  readonly dirty: boolean;
}

declare const __LUCENT_BUILD_INFO__: DesktopBuildInfo | undefined;

export const desktopBuildInfo: DesktopBuildInfo =
  typeof __LUCENT_BUILD_INFO__ === "undefined"
    ? { builtAt: null, commit: null, dirty: false }
    : __LUCENT_BUILD_INFO__;
