import {
  readLocalStorageValue,
  writeLocalStorageValue,
} from "../../localStorage";
import type { AccountLaunchMode } from "./launchMode";

const ACCOUNT_LAUNCH_MODE_STORAGE_KEY = "lucent.account-manager.launch-mode";
const ACCOUNT_LAUNCH_NEW_WINDOW_STORAGE_KEY =
  "lucent.account-manager.launch-in-new-window";

const isAccountLaunchMode = (
  value: string | undefined,
): value is AccountLaunchMode => value === "standard" || value === "auto-grid";

export function readStoredAccountLaunchMode(): AccountLaunchMode {
  const storedValue = readLocalStorageValue(ACCOUNT_LAUNCH_MODE_STORAGE_KEY);
  return isAccountLaunchMode(storedValue) ? storedValue : "standard";
}

export function writeStoredAccountLaunchMode(mode: AccountLaunchMode): void {
  writeLocalStorageValue(ACCOUNT_LAUNCH_MODE_STORAGE_KEY, mode);
}

export function readStoredAccountLaunchInNewWindow(): boolean {
  return (
    readLocalStorageValue(ACCOUNT_LAUNCH_NEW_WINDOW_STORAGE_KEY) === "true"
  );
}

export function writeStoredAccountLaunchInNewWindow(enabled: boolean): void {
  writeLocalStorageValue(
    ACCOUNT_LAUNCH_NEW_WINDOW_STORAGE_KEY,
    enabled ? "true" : "false",
  );
}
