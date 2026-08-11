import {
  readLocalStorageValue,
  writeLocalStorageValue,
} from "../../localStorage";
import type { AccountLaunchMode } from "./launchMode";

const ACCOUNT_LAUNCH_MODE_STORAGE_KEY = "lucent.account-manager.launch-mode";

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
