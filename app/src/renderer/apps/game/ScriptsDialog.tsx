import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  Icon,
  IconButton,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TooltipIconButton,
  type AlertVariant,
  type ButtonVariant,
  type IconButtonProps,
  type IconName,
} from "@lucent/ui";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
  untrack,
} from "solid-js";

import type { RoomPolicy } from "@lucent/core/accountSettings";
import type {
  GitHubCredentialSummary,
  ScriptCatalogEntry,
  ScriptCatalogOverview,
  ScriptPackageInstallRequest,
  ScriptPackageMutationResult,
  ScriptPackageSummary,
  ScriptReference,
  ValidScriptPackage,
} from "@lucent/core/scriptPackages";
import type { DesktopScriptingBridge } from "../../../shared/desktopBridge";
import { parseGitHubRepositoryInput } from "../../../shared/githubRepositoryUrl";
import {
  parseRoomNumberInput,
  roomNumberKind,
  type RoomPolicyMode,
} from "./scripting/roomPolicyInput";
import {
  activeScriptPackageRateLimits,
  formatScriptPackageRetryLabel,
  scriptPackageCredentialRateLimitScope,
  scriptPackageRateLimit,
  scriptPackageRateLimitTiming,
  scriptPackagesEligibleForUpdateCheck,
  type ActiveScriptPackageRateLimit,
} from "./scriptPackageRateLimit";
import {
  SCRIPT_CATALOG_PAGE_SIZE,
  groupScriptCatalogPageOffsets,
  scriptCatalogEntryAt,
  scriptCatalogPageOffsetsForRange,
  storeScriptCatalogPageRange,
  touchScriptCatalogPages,
  type ScriptCatalogPageCache,
} from "./scriptCatalogPages";
import {
  checkScriptPackageUpdatesSerially,
  formatScriptPackageUpdateCheckFailures,
} from "./scriptPackageUpdateCheck";
import {
  scriptContextCharacterLimit,
  truncatePathContext,
} from "./scriptPathDisplay";

const SCRIPT_ROW_HEIGHT = 40;
const GITHUB_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new";

const roomPolicyLabels: Record<RoomPolicyMode, string> = {
  public: "Public rooms",
  "random-private": "Random private room",
  specific: "Specific room",
};

const openGitHubTokenPage = (): void => {
  window.open(GITHUB_TOKEN_URL, "_blank", "noopener,noreferrer");
};

type ScriptsDialogTab = "options" | "packages" | "scripts";
type ScrollableScriptsDialogTab = Exclude<ScriptsDialogTab, "options">;
type PackageManagementView =
  | "credentials"
  | "details"
  | "install"
  | "installed";
type CredentialManagerParentView = "install" | "installed";
type CredentialEditorReturnView = "credentials" | "install";

interface ConfirmationState {
  readonly confirmLabel: string;
  readonly description: string;
  readonly destructive?: boolean;
  readonly icon?: IconName;
  readonly onConfirm: () => Promise<void>;
  readonly title: string;
}

interface ErrorAlertProps {
  readonly class?: string;
  readonly message: string;
  readonly onDismiss?: () => void;
  readonly onRetry?: () => void;
  readonly retryDisabled: boolean;
  readonly retrying: boolean;
}

function ErrorAlert(props: ErrorAlertProps): JSX.Element {
  return (
    <Alert
      variant="error"
      {...(props.class === undefined ? {} : { class: props.class })}
    >
      <AlertDescription title={props.message}>
        <span>{props.message}</span>
      </AlertDescription>
      <AlertAction>
        <Show when={props.onRetry !== undefined}>
          <Button
            disabled={props.retryDisabled}
            loading={props.retrying}
            onClick={() => {
              props.onRetry?.();
            }}
            size="sm"
            variant="ghost"
          >
            Retry
          </Button>
        </Show>
        <Show when={props.onDismiss !== undefined}>
          <IconButton
            aria-label="Dismiss error"
            onClick={() => props.onDismiss?.()}
            size="icon-sm"
            variant="ghost"
          >
            <Icon icon="x" size="sm" />
          </IconButton>
        </Show>
      </AlertAction>
    </Alert>
  );
}

interface CatalogRefreshButtonProps {
  readonly disabled: boolean;
  readonly loading: boolean;
  readonly onClick: () => void;
}

function CatalogRefreshButton(props: CatalogRefreshButtonProps): JSX.Element {
  return (
    <IconButton
      aria-label="Refresh catalog"
      class="game-scripts-dialog__refresh-button"
      disabled={props.disabled}
      loading={props.loading}
      onClick={props.onClick}
      size="icon"
      title="Refresh catalog"
      variant="outline"
    >
      <Icon icon="refresh_cw" size="sm" />
    </IconButton>
  );
}

interface PackageUpdateCheckButtonProps {
  readonly checking: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly title?: string | undefined;
  readonly variant: Extract<ButtonVariant, "ghost" | "secondary">;
}

function PackageUpdateCheckButton(
  props: PackageUpdateCheckButtonProps,
): JSX.Element {
  return (
    <Button
      aria-busy={props.checking ? "true" : undefined}
      disabled={props.disabled || props.checking}
      onClick={props.onClick}
      size="sm"
      title={props.title}
      variant={props.variant}
    >
      <Show
        when={props.checking}
        fallback={<Icon icon="git_compare_arrows" size="sm" />}
      >
        <Spinner
          class="game-scripts-dialog__package-update-spinner"
          size="sm"
        />
      </Show>
      {props.label}
    </Button>
  );
}

export interface ScriptsDialogProps {
  readonly bridge: DesktopScriptingBridge;
  readonly inputsAvailable: boolean;
  readonly loadedReference: ScriptReference | undefined;
  readonly onChooseFile: (replaceRunning: boolean) => Promise<void>;
  readonly onCommitRoomNumber: () => void;
  readonly onEditInputs: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelectRoomPolicy: (
    policy: Exclude<RoomPolicy, { readonly kind: "specific" }>,
  ) => void;
  readonly onSelectScript: (
    reference: ScriptReference,
    start: boolean,
    replaceRunning: boolean,
  ) => Promise<void>;
  readonly onSetRoomNumberDraft: (value: string) => void;
  readonly onToggleRestartAfterReconnect: () => void;
  readonly onToggleSafeStartStop: () => void;
  readonly onToggleScript: () => void | Promise<void>;
  readonly open: boolean;
  readonly optionsReady: boolean;
  readonly restartAfterReconnect: boolean;
  readonly roomNumberDraft: string;
  readonly roomNumberError: string;
  readonly roomPolicy: RoomPolicy;
  readonly safeStartStop: boolean;
  readonly scriptBusy: boolean;
  readonly scriptLoaded: boolean;
  readonly scriptRunning: boolean;
  readonly scriptStatus: string;
}

const emptyCatalog = (): ScriptCatalogOverview => ({
  packages: [],
  revision: "",
  scriptCount: 0,
});

const errorMessage = (cause: unknown, fallback: string): string => {
  if (!(cause instanceof Error) || cause.message.trim() === "") return fallback;
  return cause.message.replace(/^Uncaught DesktopBridgeError:\s*/, "");
};

const sameReference = (
  left: ScriptReference | undefined,
  right: ScriptReference,
): boolean =>
  left?.kind === right.kind &&
  left.path === right.path &&
  (left.kind !== "package" ||
    (right.kind === "package" && left.packageName === right.packageName));

const scriptLocation = (entry: ScriptCatalogEntry): string =>
  entry.packageName === undefined
    ? entry.relativePath
    : `${entry.packageName}/${entry.relativePath}`;

const scriptContext = (entry: ScriptCatalogEntry): string | undefined => {
  const separatorIndex = entry.relativePath.lastIndexOf("/");
  const directory =
    separatorIndex === -1
      ? undefined
      : entry.relativePath.slice(0, separatorIndex);
  if (entry.packageName === undefined) return directory;
  return directory === undefined
    ? entry.packageName
    : `${entry.packageName}/${directory}`;
};

const packageCompatibilityDetail = (entry: ValidScriptPackage): string => {
  switch (entry.compatibility.status) {
    case "compatible":
      return `This package requires Lucent ${entry.compatibility.requiredVersion}. You're using v${entry.compatibility.currentVersion}, which is compatible.`;
    case "incompatible":
      return `This package requires Lucent ${entry.compatibility.requiredVersion}, but you're using v${entry.compatibility.currentVersion}. Its code can't be used.`;
    case "unknown":
      return "Lucent can't check compatibility because the package doesn't include a valid Lucent version requirement.";
  }
};

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "always",
});

const formatRelativeTime = (value: string, now = Date.now()): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "at an unknown time";

  const difference = timestamp - now;
  const absoluteDifference = Math.abs(difference);
  if (absoluteDifference < 45_000) return "just now";

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (absoluteDifference < hour) {
    return relativeTimeFormatter.format(
      Math.round(difference / minute),
      "minute",
    );
  }
  if (absoluteDifference < day) {
    return relativeTimeFormatter.format(Math.round(difference / hour), "hour");
  }
  if (absoluteDifference < month) {
    return relativeTimeFormatter.format(
      Math.round(difference / (absoluteDifference < week ? day : week)),
      absoluteDifference < week ? "day" : "week",
    );
  }
  if (absoluteDifference < year) {
    return relativeTimeFormatter.format(
      Math.round(difference / month),
      "month",
    );
  }
  return relativeTimeFormatter.format(Math.round(difference / year), "year");
};

interface PackageCheckSummary {
  readonly timestampLabel?: string;
  readonly timestamp?: string;
}

const packageCheckSummary = (
  entry: ValidScriptPackage,
  now: number,
): PackageCheckSummary => {
  switch (entry.update.status) {
    case "available":
    case "current":
      return {
        timestamp: entry.update.checkedAt,
        timestampLabel: "Checked",
      };
    case "rate-limited": {
      const timing = scriptPackageRateLimitTiming(entry.update.retryAt, now);
      return timing.status === "invalid"
        ? {}
        : {
            timestamp: entry.update.retryAt,
            timestampLabel:
              timing.status === "active" ? "Retry" : "Cooldown ended",
          };
    }
    case "unknown":
      return entry.update.checkedAt === undefined
        ? {}
        : {
            timestamp: entry.update.checkedAt,
            timestampLabel: "Checked",
          };
    case "unchecked":
      return {};
  }
};

type PackagePrimaryAction = "check" | "open-folder" | "restore" | "update";

const packagePrimaryAction = (
  entry: ValidScriptPackage,
): PackagePrimaryAction | undefined => {
  if (entry.integrity === "unmanaged") return "open-folder";
  if (entry.source === undefined) return undefined;
  if (entry.integrity === "modified") {
    return entry.update.status === "available" ? "update" : "restore";
  }
  if (entry.update.status === "available") return "update";
  if (
    entry.update.status === "unchecked" ||
    entry.update.status === "unknown" ||
    entry.update.status === "rate-limited"
  ) {
    return "check";
  }
  return undefined;
};

const packagePrimaryActionLabels: Record<PackagePrimaryAction, string> = {
  check: "Check",
  "open-folder": "Open folder",
  restore: "Restore",
  update: "Update",
};

const packageFooterPrimaryAction = (
  entry: ValidScriptPackage,
): PackagePrimaryAction | undefined => {
  const action = packagePrimaryAction(entry);
  return action === "update" ? undefined : action;
};

const packageIntegrityDetail = (
  entry: ValidScriptPackage,
  integrity: "modified" | "unmanaged",
): string => {
  switch (integrity) {
    case "modified":
      return (
        "This package has local changes. Updating will overwrite them." +
        (entry.update.status === "available"
          ? " A newer version is also available."
          : "")
      );
    case "unmanaged":
      return "Lucent didn't install this folder, so it can't verify or update it.";
  }
};

const packageRateLimitTitle = (
  limit: ActiveScriptPackageRateLimit | undefined,
): string | undefined =>
  limit === undefined
    ? undefined
    : `GitHub's request limit has been reached. Try again after ${new Date(limit.retryAtTimestamp).toLocaleString()}.`;

interface PackageDisplayStatus {
  readonly description: string;
  readonly icon: IconName;
  readonly label: string;
  readonly listLabel: string;
  readonly tone: "error" | "info" | "secondary" | "success" | "warning";
}

const packageAlertVariant = (status: PackageDisplayStatus): AlertVariant =>
  status.tone === "secondary" ? "default" : status.tone;

const packageDisplayStatus = (
  entry: ValidScriptPackage,
  now = Date.now(),
): PackageDisplayStatus => {
  if (entry.compatibility.status === "incompatible") {
    return {
      description: packageCompatibilityDetail(entry),
      icon: "triangle_alert",
      label: "Incompatible",
      listLabel: "Needs attention",
      tone: "error",
    };
  }

  if (entry.integrity === "modified") {
    return {
      description: packageIntegrityDetail(entry, entry.integrity),
      icon: "triangle_alert",
      label:
        entry.update.status === "available"
          ? "Modified, update available"
          : "Modified",
      listLabel: "Needs attention",
      tone: "warning",
    };
  }

  if (entry.integrity === "unmanaged") {
    return {
      description: packageIntegrityDetail(entry, entry.integrity),
      icon: "help_circle",
      label: "Unmanaged",
      listLabel: "Needs attention",
      tone: "warning",
    };
  }

  if (entry.compatibility.status === "unknown") {
    return {
      description: packageCompatibilityDetail(entry),
      icon: "help_circle",
      label: "Compatibility unknown",
      listLabel: "Needs attention",
      tone: "warning",
    };
  }

  if (entry.warning !== undefined) {
    return {
      description: entry.warning,
      icon: "triangle_alert",
      label: "Package warning",
      listLabel: "Needs attention",
      tone: "warning",
    };
  }

  if (entry.source === undefined) {
    return {
      description:
        "This verified package has no remote source, so Lucent can't check it for updates.",
      icon: "check",
      label: "Local package",
      listLabel: "Local package",
      tone: "secondary",
    };
  }

  switch (entry.update.status) {
    case "available":
      return {
        description: `The package's Git ref points to a newer commit (${entry.update.commit.slice(0, 7)}).`,
        icon: "download",
        label: "Update available",
        listLabel: "Update available",
        tone: "info",
      };
    case "current":
      return {
        description:
          "This package is compatible and unchanged. Its Git ref still points to the installed commit.",
        icon: "check",
        label: "Up to date",
        listLabel: "Up to date",
        tone: "success",
      };
    case "rate-limited": {
      const timing = scriptPackageRateLimitTiming(entry.update.retryAt, now);
      if (timing.status !== "active") {
        return {
          description:
            timing.status === "elapsed"
              ? "GitHub's cooldown has ended. Check again to refresh the package status."
              : "GitHub saved an invalid retry deadline. Check again to refresh the package status.",
          icon: "git_compare_arrows",
          label: "Ready to check",
          listLabel: "Ready to check",
          tone: "info",
        };
      }
      return {
        description: `GitHub's request limit has been reached. Try again ${formatRelativeTime(entry.update.retryAt, now)}.`,
        icon: "triangle_alert",
        label: "Rate limited",
        listLabel: "Try later",
        tone: "warning",
      };
    }
    case "unknown":
      return {
        description: `${entry.update.message} No files were changed.`,
        icon: "triangle_alert",
        label: "Check failed",
        listLabel: "Needs attention",
        tone: "warning",
      };
    case "unchecked":
      return {
        description:
          "This package hasn't changed, but Lucent hasn't checked its Git ref for updates yet.",
        icon: "help_circle",
        label: "Updates not checked",
        listLabel: "Not checked",
        tone: "secondary",
      };
  }
};

const packageNoticeDescription = (
  entry: ValidScriptPackage,
  displayStatus: PackageDisplayStatus,
): string => {
  const details = [displayStatus.description];

  // The badge shows the most urgent status, but the notice should retain every
  // compatibility or integrity problem that needs the user's attention.
  if (entry.compatibility.status === "incompatible") {
    if (entry.integrity !== "verified") {
      details.push(packageIntegrityDetail(entry, entry.integrity));
    }
  } else if (
    entry.compatibility.status === "unknown" &&
    entry.integrity !== "verified"
  ) {
    details.push(packageCompatibilityDetail(entry));
  }

  return details.join(" ");
};

const needsPackageNotice = (entry: ValidScriptPackage): boolean =>
  entry.compatibility.status === "incompatible" ||
  entry.integrity === "modified" ||
  entry.integrity === "unmanaged" ||
  entry.compatibility.status === "unknown" ||
  entry.warning !== undefined ||
  entry.update.status === "available" ||
  entry.update.status === "unknown" ||
  entry.update.status === "rate-limited";

export function ScriptsDialog(props: ScriptsDialogProps): JSX.Element {
  const [scriptViewport, setScriptViewport] = createSignal<HTMLDivElement>();
  const [scriptViewportWidth, setScriptViewportWidth] = createSignal(0);
  const scriptContextLimit = createMemo(() =>
    scriptContextCharacterLimit(scriptViewportWidth()),
  );
  const [packageViewport, setPackageViewport] = createSignal<HTMLElement>();
  const [catalog, setCatalog] =
    createSignal<ScriptCatalogOverview>(emptyCatalog());
  const [catalogLoading, setCatalogLoading] = createSignal(true);
  const [catalogSyncing, setCatalogSyncing] = createSignal(false);
  const [pendingCatalogRevision, setPendingCatalogRevision] = createSignal<
    string | null
  >(null);
  const [credentials, setCredentials] = createSignal<
    readonly GitHubCredentialSummary[]
  >([]);
  const [activeTab, setActiveTab] = createSignal<ScriptsDialogTab>("scripts");
  const [search, setSearch] = createSignal("");
  const [catalogQuery, setCatalogQuery] = createSignal("");
  const [scriptPages, setScriptPages] = createSignal<ScriptCatalogPageCache>(
    new Map(),
  );
  const [scriptQueryLoading, setScriptQueryLoading] = createSignal(false);
  const [scriptQueryIndicatorVisible, setScriptQueryIndicatorVisible] =
    createSignal(false);
  const [scriptTotal, setScriptTotal] = createSignal(0);
  const [busy, setBusy] = createSignal(false);
  const [checkingPackageUpdates, setCheckingPackageUpdates] =
    createSignal(false);
  const [checkingPackageName, setCheckingPackageName] = createSignal<string>();
  const [error, setErrorText] = createSignal("");
  const [errorRetryable, setErrorRetryable] = createSignal(false);
  const setError = (message: string): void => {
    setErrorRetryable(false);
    setErrorText(message);
  };
  const setRetryableError = (message: string): void => {
    setErrorRetryable(true);
    setErrorText(message);
  };
  const clearRetryableError = (): void => {
    if (!errorRetryable()) return;
    setErrorRetryable(false);
    setErrorText("");
  };
  const [packageManagementView, setPackageManagementView] =
    createSignal<PackageManagementView>("installed");
  const [selectedPackagePath, setSelectedPackagePath] = createSignal<string>();
  const [credentialManagerParentView, setCredentialManagerParentView] =
    createSignal<CredentialManagerParentView>("installed");
  const [credentialEditorReturnView, setCredentialEditorReturnView] =
    createSignal<CredentialEditorReturnView>("credentials");
  const [installOptionsOpen, setInstallOptionsOpen] = createSignal(false);
  const [roomEditingMode, setRoomEditingMode] =
    createSignal<RoomPolicyMode | null>(null);
  const [confirmation, setConfirmation] =
    createSignal<ConfirmationState | null>(null);
  let confirmationCancelButton: HTMLButtonElement | null = null;
  const [repositoryUrl, setRepositoryUrl] = createSignal("");
  const [repositoryRef, setRepositoryRef] = createSignal("");
  const [credentialId, setCredentialId] = createSignal("");
  const [credentialEditorOpen, setCredentialEditorOpen] = createSignal(false);
  const [editingCredentialId, setEditingCredentialId] = createSignal("");
  const [credentialLabel, setCredentialLabel] = createSignal("");
  const [credentialToken, setCredentialToken] = createSignal("");
  const [credentialTokenVisible, setCredentialTokenVisible] =
    createSignal(false);
  const [copiedCommitPath, setCopiedCommitPath] = createSignal<string>();
  const [rateLimitNow, setRateLimitNow] = createSignal(Date.now());
  let catalogRequestId = 0;
  let scriptQueryRequestId = 0;
  let requestedCatalogQuery = "";
  let scriptPageGeneration = 0;
  const scriptPageRequests = new Set<string>();
  let searchTimer: number | undefined;
  let copiedCommitTimer: number | undefined;
  let scriptViewportResizeObserver: ResizeObserver | undefined;
  const scrollPositions: Record<ScrollableScriptsDialogTab, number> = {
    packages: 0,
    scripts: 0,
  };

  const replaceCatalog = (nextCatalog: ScriptCatalogOverview): void => {
    setRateLimitNow(Date.now());
    const revisionChanged = catalog().revision !== nextCatalog.revision;
    setCatalog(nextCatalog);
    if (revisionChanged) {
      scriptQueryRequestId += 1;
      requestedCatalogQuery = catalogQuery();
      setScriptQueryLoading(false);
      scriptPageGeneration += 1;
      scriptPageRequests.clear();
      setScriptPages(new Map());
      setScriptTotal(catalogQuery() === "" ? nextCatalog.scriptCount : 0);
      const nextQuery = search().trim();
      if (nextQuery !== catalogQuery()) {
        void requestScriptQuery(nextQuery);
      } else if (catalogQuery() !== "") {
        void requestScriptPages([0]);
      }
    }
  };

  const selectedCredential = createMemo(() =>
    credentials().find((entry) => entry.id === credentialId()),
  );

  const selectedPackage = createMemo(() =>
    catalog().packages.find((entry) => entry.path === selectedPackagePath()),
  );

  const firstPackageInstall = createMemo(
    () =>
      packageManagementView() === "installed" &&
      catalog().revision !== "" &&
      !catalogLoading() &&
      catalog().packages.length === 0,
  );

  const repositoryInput = createMemo(() =>
    parseGitHubRepositoryInput(repositoryUrl()),
  );
  const repositorySuggestion = createMemo(() => {
    const input = repositoryInput();
    return input.kind === "tree" ? input : undefined;
  });

  const applyRepositorySuggestion = (): void => {
    const input = repositoryInput();
    if (input.kind !== "tree") return;
    setRepositoryUrl(input.repository.url);
    setRepositoryRef(input.ref);
    setInstallOptionsOpen(true);
    setError("");
  };

  const packageManagementBreadcrumb = createMemo(() => {
    switch (packageManagementView()) {
      case "credentials":
        if (credentialEditorOpen()) {
          return {
            current:
              editingCredentialId() === "" ? "Add credential" : "Replace token",
            parent: "GitHub credentials",
            parentView: "credentials" as const,
          };
        }
        return {
          current: "GitHub credentials",
          parent:
            credentialManagerParentView() === "install"
              ? "Install package"
              : "Packages",
          parentView: credentialManagerParentView(),
        };
      case "details":
        return undefined;
      case "install":
        return undefined;
      case "installed":
        return undefined;
    }
  });

  const activePackageRateLimits = createMemo(() =>
    activeScriptPackageRateLimits(catalog().packages, rateLimitNow()),
  );

  const packageActiveRateLimit = (
    entry: ValidScriptPackage,
  ): ActiveScriptPackageRateLimit | undefined =>
    scriptPackageRateLimit(entry, activePackageRateLimits());

  const packagesEligibleForUpdateCheck = createMemo(() =>
    scriptPackagesEligibleForUpdateCheck(
      catalog().packages,
      activePackageRateLimits(),
    ),
  );

  const installRateLimit = createMemo(() =>
    activePackageRateLimits().get(
      scriptPackageCredentialRateLimitScope(
        credentialId() === "" ? undefined : credentialId(),
      ),
    ),
  );

  const packageActionLabel = (
    entry: ValidScriptPackage,
    action: PackagePrimaryAction,
  ): string => {
    const activeLimit = packageActiveRateLimit(entry);
    if (activeLimit !== undefined) {
      return formatScriptPackageRetryLabel(
        activeLimit.retryAtTimestamp,
        rateLimitNow(),
      );
    }
    if (action === "check" && entry.update.status === "rate-limited") {
      return "Check again";
    }
    return packagePrimaryActionLabels[action];
  };

  const packageUpdateCheckLabel = (entry: ValidScriptPackage): string => {
    const activeLimit = packageActiveRateLimit(entry);
    return activeLimit === undefined
      ? "Check for updates"
      : formatScriptPackageRetryLabel(
          activeLimit.retryAtTimestamp,
          rateLimitNow(),
        );
  };

  createEffect(() => {
    if (
      packageManagementView() === "details" &&
      selectedPackage() === undefined
    ) {
      setSelectedPackagePath(undefined);
      setPackageManagementView("installed");
    }
  });

  createEffect(() => {
    if (props.open) setRateLimitNow(Date.now());
  });

  createEffect(() => {
    if (!props.open) return;
    const now = rateLimitNow();
    const retryTimestamps = [...activePackageRateLimits().values()].map(
      (limit) => limit.retryAtTimestamp,
    );
    if (retryTimestamps.length === 0) return;

    const nextRetryAt = Math.min(...retryTimestamps);
    const wakeAt = Math.min(nextRetryAt, now + 60_000);
    const timer = window.setTimeout(
      () => setRateLimitNow(Date.now()),
      Math.max(25, wakeAt - Date.now() + 25),
    );
    onCleanup(() => window.clearTimeout(timer));
  });

  const requestScriptPages = async (
    offsets: readonly number[],
  ): Promise<void> => {
    const bridge = props.bridge;
    const revision = catalog().revision;
    if (revision === "") return;
    const generation = scriptPageGeneration;
    const query = catalogQuery();
    const currentPages = scriptPages();
    const requestedOffsets = offsets.filter(
      (offset) =>
        !currentPages.has(offset) &&
        !scriptPageRequests.has(`${generation}:${offset}`),
    );
    const firstOffset = requestedOffsets[0];
    const lastOffset = requestedOffsets.at(-1);
    if (firstOffset === undefined || lastOffset === undefined) return;

    for (const offset of requestedOffsets) {
      scriptPageRequests.add(`${generation}:${offset}`);
    }
    try {
      const page = await bridge.getCatalogPage({
        limit: lastOffset - firstOffset + SCRIPT_CATALOG_PAGE_SIZE,
        offset: firstOffset,
        query,
        revision,
      });
      if (
        generation !== scriptPageGeneration ||
        query !== catalogQuery() ||
        revision !== catalog().revision
      ) {
        return;
      }
      if (page.revision !== revision) {
        setPendingCatalogRevision(page.revision);
        return;
      }
      setScriptTotal(page.total);
      setScriptPages((current) =>
        storeScriptCatalogPageRange(
          current,
          page.offset,
          page.entries,
          requestedOffsets,
        ),
      );
    } catch (cause) {
      if (generation === scriptPageGeneration && props.open) {
        setCatalogError("Failed to load script catalog rows.", cause);
      }
    } finally {
      for (const offset of requestedOffsets) {
        scriptPageRequests.delete(`${generation}:${offset}`);
      }
    }
  };

  const requestScriptQuery = async (query: string): Promise<void> => {
    requestedCatalogQuery = query;
    const requestId = ++scriptQueryRequestId;
    if (query === catalogQuery()) {
      setScriptQueryLoading(false);
      return;
    }

    const bridge = props.bridge;
    const revision = catalog().revision;
    if (revision === "" || !props.open) {
      setScriptQueryLoading(false);
      return;
    }

    setScriptQueryLoading(true);
    try {
      const page = await bridge.getCatalogPage({
        limit: SCRIPT_CATALOG_PAGE_SIZE,
        offset: 0,
        query,
        revision,
      });
      if (
        requestId !== scriptQueryRequestId ||
        query !== requestedCatalogQuery ||
        revision !== catalog().revision ||
        !props.open
      ) {
        return;
      }
      if (page.revision !== revision) {
        setScriptQueryLoading(false);
        setPendingCatalogRevision(page.revision);
        return;
      }

      scriptPageGeneration += 1;
      scriptPageRequests.clear();
      batch(() => {
        setCatalogQuery(query);
        setScriptTotal(page.total);
        setScriptPages(
          storeScriptCatalogPageRange(
            new Map(),
            page.offset,
            page.entries,
            [0],
          ),
        );
        setScriptQueryLoading(false);
      });
      scriptVirtualizer.scrollToOffset(0);
      scriptVirtualizer.measure();
      clearRetryableError();
    } catch (cause) {
      if (
        requestId === scriptQueryRequestId &&
        query === requestedCatalogQuery &&
        props.open
      ) {
        setScriptQueryLoading(false);
        setCatalogError("Failed to search the script catalog.", cause);
      }
    }
  };

  const requestScriptRange = (startIndex: number, endIndex: number): void => {
    const offsets = scriptCatalogPageOffsetsForRange({
      endIndex,
      startIndex,
      total: scriptTotal(),
    });
    if (offsets.length === 0) return;
    const currentPages = scriptPages();
    setScriptPages(touchScriptCatalogPages(currentPages, offsets));
    const generation = scriptPageGeneration;
    const missingOffsets = offsets.filter(
      (offset) =>
        !currentPages.has(offset) &&
        !scriptPageRequests.has(`${generation}:${offset}`),
    );
    for (const group of groupScriptCatalogPageOffsets(missingOffsets)) {
      void requestScriptPages(group);
    }
  };

  const requestScriptViewport = (viewport: HTMLDivElement): void => {
    const startIndex = Math.floor(viewport.scrollTop / SCRIPT_ROW_HEIGHT);
    const endIndex = Math.max(
      startIndex,
      Math.ceil(
        (viewport.scrollTop + viewport.clientHeight) / SCRIPT_ROW_HEIGHT,
      ) - 1,
    );
    requestScriptRange(startIndex, endIndex);
  };

  const scriptVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    estimateSize: () => SCRIPT_ROW_HEIGHT,
    get count() {
      return scriptTotal();
    },
    getItemKey: (index) => `${catalog().revision}:${catalogQuery()}:${index}`,
    getScrollElement: () => scriptViewport() ?? null,
    onChange: (instance) => {
      const items = instance.getVirtualItems();
      const first = items[0];
      const last = items.at(-1);
      if (first !== undefined && last !== undefined) {
        untrack(() => requestScriptRange(first.index, last.index));
      }
    },
    overscan: 10,
  });

  const restoreScrollPosition = (
    tab: ScrollableScriptsDialogTab,
    viewport: HTMLElement,
  ): void => {
    requestAnimationFrame(() => {
      if (activeTab() !== tab || !viewport.isConnected) return;
      viewport.scrollTop = scrollPositions[tab];
    });
  };

  const mountScriptViewport = (element: HTMLDivElement): void => {
    setScriptViewport(element);
    setScriptViewportWidth(element.clientWidth);
    scriptViewportResizeObserver?.observe(element);
    restoreScrollPosition("scripts", element);
  };

  const mountPackageViewport = (element: HTMLElement): void => {
    setPackageViewport(element);
    restoreScrollPosition("packages", element);
  };

  const changeActiveTab = (value: string): void => {
    const current = activeTab();
    if (current === "scripts") {
      const viewport = scriptViewport();
      if (viewport !== undefined) {
        scrollPositions.scripts = viewport.scrollTop;
      }
    } else if (current === "packages") {
      const viewport = packageViewport();
      if (viewport !== undefined) {
        scrollPositions.packages = viewport.scrollTop;
      }
    }

    const next: ScriptsDialogTab =
      value === "options" || value === "packages" ? value : "scripts";
    setActiveTab(next);
    if (next === "scripts") {
      const viewport = scriptViewport();
      if (viewport !== undefined) restoreScrollPosition(next, viewport);
    } else if (next === "packages") {
      const viewport = packageViewport();
      if (viewport !== undefined) restoreScrollPosition(next, viewport);
    }
  };

  const roomMode = (): RoomPolicyMode =>
    roomEditingMode() ?? props.roomPolicy.kind;

  const roomMessage = createMemo(() => {
    if (props.roomNumberError !== "") return props.roomNumberError;
    if (props.roomNumberDraft.trim() === "") return "";
    const parsed = parseRoomNumberInput(props.roomNumberDraft);
    return parsed.status === "invalid"
      ? "Enter a room number from 1 to 99,999."
      : "";
  });

  const roomKind = createMemo(() => {
    const parsed = parseRoomNumberInput(props.roomNumberDraft);
    return parsed.status === "valid" ? roomNumberKind(parsed.value) : undefined;
  });

  const setOperationError = (fallback: string, cause: unknown): void => {
    console.error(`[game:scripts] ${fallback}`, cause);
    setError(errorMessage(cause, fallback));
  };

  const setCatalogError = (fallback: string, cause: unknown): void => {
    console.error(`[game:scripts] ${fallback}`, cause);
    setRetryableError(errorMessage(cause, fallback));
  };

  const copyCommit = async (
    packagePath: string,
    commit: string,
  ): Promise<void> => {
    try {
      await navigator.clipboard.writeText(commit);
      if (copiedCommitTimer !== undefined) {
        window.clearTimeout(copiedCommitTimer);
      }
      setCopiedCommitPath(packagePath);
      copiedCommitTimer = window.setTimeout(() => {
        setCopiedCommitPath(undefined);
        copiedCommitTimer = undefined;
      }, 900);
    } catch (cause) {
      setOperationError("Failed to copy the commit hash.", cause);
    }
  };

  const loadCatalog = async (refresh: boolean): Promise<void> => {
    const bridge = props.bridge;
    const requestId = ++catalogRequestId;
    setCatalogLoading(true);
    try {
      const nextCatalog = await (refresh
        ? bridge.refreshCatalog()
        : bridge.getCatalog());
      if (requestId === catalogRequestId && props.open) {
        replaceCatalog(nextCatalog);
        clearRetryableError();
      }
    } catch (cause) {
      if (requestId === catalogRequestId && props.open) {
        setCatalogError("Failed to load the script catalog.", cause);
      }
    } finally {
      if (requestId === catalogRequestId) setCatalogLoading(false);
    }
  };

  const refreshCatalog = (): Promise<void> => loadCatalog(true);

  const retryCatalog = (): void => {
    const nextQuery = search().trim();
    if (nextQuery !== catalogQuery()) {
      void requestScriptQuery(nextQuery);
      return;
    }
    void refreshCatalog();
  };

  const refreshCredentials = async (): Promise<void> => {
    const bridge = props.bridge;
    try {
      setCredentials(await bridge.listCredentials());
    } catch (cause) {
      setOperationError("Failed to load GitHub credentials.", cause);
    }
  };

  createEffect(() => {
    const revision = untrack(() => catalog().revision);
    if (!props.open) {
      catalogRequestId += 1;
      scriptQueryRequestId += 1;
      requestedCatalogQuery = catalogQuery();
      scriptPageGeneration += 1;
      scriptPageRequests.clear();
      setScriptQueryLoading(false);
      setCatalogLoading(revision === "");
      return;
    }
    setError("");
    if (revision === "") {
      void Promise.all([loadCatalog(false), refreshCredentials()]);
    } else {
      setCatalogLoading(false);
      void refreshCredentials();
      const nextQuery = untrack(() => search().trim());
      if (nextQuery !== catalogQuery()) {
        void requestScriptQuery(nextQuery);
        return;
      }
      window.requestAnimationFrame(() => {
        if (!props.open) return;
        scriptVirtualizer.measure();
        const items = scriptVirtualizer.getVirtualItems();
        const first = items[0];
        const last = items.at(-1);
        if (first !== undefined && last !== undefined) {
          requestScriptRange(first.index, last.index);
        } else if (catalogQuery() !== "") {
          void requestScriptPages([0]);
        }
      });
    }
  });

  createEffect(() => {
    if (!scriptQueryLoading()) {
      setScriptQueryIndicatorVisible(false);
      return;
    }
    const timer = window.setTimeout(
      () => setScriptQueryIndicatorVisible(true),
      150,
    );
    onCleanup(() => window.clearTimeout(timer));
  });

  createEffect(() => {
    const revision = pendingCatalogRevision();
    const bridge = props.bridge;
    if (
      revision === null ||
      !props.open ||
      busy() ||
      catalogLoading() ||
      catalogSyncing()
    ) {
      return;
    }
    if (catalog().revision === revision) {
      setPendingCatalogRevision(null);
      return;
    }

    setCatalogSyncing(true);
    void bridge
      .getCatalog()
      .then((nextCatalog) => {
        if (props.open) replaceCatalog(nextCatalog);
      })
      .catch((cause) => {
        setPendingCatalogRevision(null);
        if (props.open) {
          setOperationError("Failed to synchronize the script catalog.", cause);
        }
      })
      .finally(() => setCatalogSyncing(false));
  });

  onMount(() => {
    scriptViewportResizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setScriptViewportWidth(Math.round(entry.contentRect.width));
      }
    });
    const viewport = scriptViewport();
    if (viewport !== undefined) scriptViewportResizeObserver.observe(viewport);

    const unsubscribe = props.bridge.onCatalogChanged((change) => {
      if (change.revision !== catalog().revision) {
        setPendingCatalogRevision(change.revision);
      }
    });
    onCleanup(() => {
      scriptViewportResizeObserver?.disconnect();
      unsubscribe?.();
    });
  });

  onCleanup(() => {
    if (searchTimer !== undefined) {
      window.clearTimeout(searchTimer);
    }
    if (copiedCommitTimer !== undefined) {
      window.clearTimeout(copiedCommitTimer);
    }
  });

  const closeConfirmation = (): void => {
    if (busy()) return;
    setConfirmation(null);
    setError("");
  };

  const askForConfirmation = (value: ConfirmationState): void => {
    setError("");
    setConfirmation(() => value);
  };

  const runConfirmation = async (): Promise<void> => {
    const pending = confirmation();
    if (pending === null || busy()) return;
    setBusy(true);
    setError("");
    try {
      await pending.onConfirm();
    } catch (cause) {
      setOperationError("The operation failed.", cause);
    } finally {
      setBusy(false);
    }
  };

  const runScriptSelection = async (
    entry: ScriptCatalogEntry,
    start: boolean,
    replaceRunning: boolean,
  ): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      if (start) props.onOpenChange(false);
      await props.onSelectScript(entry.reference, start, replaceRunning);
      setConfirmation(null);
    } catch (cause) {
      if (start) props.onOpenChange(true);
      setOperationError(
        `Failed to ${start ? "start" : "load"} ${entry.name}.`,
        cause,
      );
    } finally {
      setBusy(false);
    }
  };

  const selectScript = (entry: ScriptCatalogEntry, start: boolean): void => {
    if (busy() || props.scriptBusy) return;
    const selected = sameReference(props.loadedReference, entry.reference);
    if (props.scriptRunning && !selected) {
      askForConfirmation({
        confirmLabel: start ? "Stop and start" : "Stop and load",
        description: `${props.scriptStatus}. Stop it and ${start ? "start" : "load"} ${entry.name}?`,
        onConfirm: () => runScriptSelection(entry, start, true),
        title: "Replace the running script?",
      });
      return;
    }
    void runScriptSelection(entry, start, false);
  };

  const clearScriptSearch = (): void => {
    if (searchTimer !== undefined) {
      window.clearTimeout(searchTimer);
      searchTimer = undefined;
    }
    setSearch("");
    void requestScriptQuery("");
  };

  const updateScriptSearch = (value: string): void => {
    setSearch(value);
    if (searchTimer !== undefined) {
      window.clearTimeout(searchTimer);
    }
    scriptQueryRequestId += 1;
    requestedCatalogQuery = catalogQuery();
    setScriptQueryLoading(false);
    searchTimer = window.setTimeout(() => {
      void requestScriptQuery(value.trim());
      searchTimer = undefined;
    }, 100);
  };

  const chooseFile = (): void => {
    if (busy() || props.scriptBusy) return;
    if (props.scriptRunning) {
      askForConfirmation({
        confirmLabel: "Choose replacement",
        description:
          "Choose a replacement file. The current script will keep running until the new file loads successfully.",
        onConfirm: async () => {
          await props.onChooseFile(true);
          setConfirmation(null);
        },
        title: "Replace the running script?",
      });
      return;
    }
    setBusy(true);
    void props
      .onChooseFile(false)
      .catch((cause) => setOperationError("Failed to choose a script.", cause))
      .finally(() => setBusy(false));
  };

  const applyMutation = (result: ScriptPackageMutationResult): void => {
    if (result.status === "completed" || result.status === "unchanged") {
      replaceCatalog(result.catalog);
      setConfirmation(null);
    }
  };

  const applyInstallMutation = (result: ScriptPackageMutationResult): void => {
    applyMutation(result);
    if (result.status !== "completed" && result.status !== "unchanged") return;
    setRepositoryUrl("");
    setRepositoryRef("");
    setInstallOptionsOpen(false);
    setPackageManagementView("installed");
  };

  const installPackage = async (
    request: ScriptPackageInstallRequest,
  ): Promise<void> => {
    const bridge = props.bridge;
    const result = await bridge.installPackage(request);
    if (result.status === "confirmation-required") {
      askForConfirmation({
        confirmLabel: "Replace package",
        description: `A package folder named ${result.packageName} already exists. Replace everything in it with the selected Git ref?`,
        destructive: true,
        onConfirm: async () => {
          applyInstallMutation(
            await bridge.installPackage({ ...request, replaceExisting: true }),
          );
        },
        title: "Replace the existing package?",
      });
      return;
    }
    applyInstallMutation(result);
  };

  const beginInstall = (): void => {
    if (installRateLimit() !== undefined) return;
    const input = repositoryInput();
    if (repositoryUrl().trim() === "") {
      setError("Enter a GitHub repository URL.");
      return;
    }
    if (input.kind === "tree") {
      setError("Use the suggested repository and Git ref before installing.");
      return;
    }
    if (input.kind === "invalid") {
      setError("Enter a valid GitHub.com repository URL.");
      return;
    }
    const request: ScriptPackageInstallRequest = {
      repositoryUrl: input.repository.url,
      ...(repositoryRef().trim() === "" ? {} : { ref: repositoryRef().trim() }),
      ...(credentialId() === "" ? {} : { credentialId: credentialId() }),
    };
    askForConfirmation({
      confirmLabel: "Install package",
      description:
        "Package code has the same access as Lucent scripts. Only install repositories you trust.",
      onConfirm: () => installPackage(request),
      title: "Install this package?",
    });
  };

  const updatePackage = async (
    entry: ValidScriptPackage,
    replaceModified = false,
  ): Promise<void> => {
    const bridge = props.bridge;
    const result = await bridge.updatePackage({
      packageName: entry.name,
      ...(replaceModified ? { replaceModified: true } : {}),
    });
    if (result.status === "confirmation-required") {
      askForConfirmation({
        confirmLabel: "Discard changes and update",
        description: `${entry.name} has local changes. Updating will replace the entire package and permanently discard your changes.`,
        destructive: true,
        onConfirm: () => updatePackage(entry, true),
        title: "Replace local changes?",
      });
      return;
    }
    applyMutation(result);
  };

  const confirmModifiedPackageUpdate = (entry: ValidScriptPackage): void => {
    const restoring = packagePrimaryAction(entry) === "restore";
    askForConfirmation({
      confirmLabel: restoring
        ? "Restore package"
        : "Discard changes and update",
      description: restoring
        ? `${entry.name} has local changes. Restoring will replace the entire package with Lucent's saved copy and permanently discard your changes.`
        : `${entry.name} has local changes. Updating will replace the entire package with the latest version from GitHub and permanently discard your changes.`,
      destructive: true,
      onConfirm: () => updatePackage(entry, true),
      title: restoring ? "Restore this package?" : "Replace local changes?",
    });
  };

  const beginUpdatePackage = (entry: ValidScriptPackage): void => {
    if (busy() || packageActiveRateLimit(entry) !== undefined) return;
    if (entry.integrity === "modified") {
      confirmModifiedPackageUpdate(entry);
      return;
    }
    setBusy(true);
    setError("");
    void updatePackage(entry)
      .catch((cause) =>
        setOperationError(`Failed to update ${entry.name}.`, cause),
      )
      .finally(() => setBusy(false));
  };

  const removePackage = (entry: ValidScriptPackage): void => {
    askForConfirmation({
      confirmLabel: "Remove package",
      description:
        entry.integrity === "modified"
          ? `${entry.name} has local changes. Removing it will permanently delete the entire package folder, including your changes.`
          : `Remove ${entry.name} and delete its entire package folder?`,
      destructive: true,
      onConfirm: async () => {
        const bridge = props.bridge;
        const result = await bridge.removePackage({
          packageName: entry.name,
          confirmModified: true,
        });
        applyMutation(result);
        if (result.status === "completed" || result.status === "unchanged") {
          setSelectedPackagePath(undefined);
          setPackageManagementView("installed");
        }
      },
      title: "Remove this package?",
    });
  };

  const checkUpdate = async (entry: ValidScriptPackage): Promise<void> => {
    if (packageActiveRateLimit(entry) !== undefined) return;
    const bridge = props.bridge;
    if (busy()) return;
    setBusy(true);
    setCheckingPackageName(entry.name);
    setError("");
    try {
      replaceCatalog(await bridge.checkPackageUpdate(entry.name));
    } catch (cause) {
      setOperationError(`Failed to check ${entry.name} for updates.`, cause);
    } finally {
      setCheckingPackageName(undefined);
      setBusy(false);
    }
  };

  const checkAllPackageUpdates = async (): Promise<void> => {
    const bridge = props.bridge;
    if (busy()) return;
    const packageNames = packagesEligibleForUpdateCheck().map(
      (entry) => entry.name,
    );
    if (packageNames.length === 0) return;

    setBusy(true);
    setCheckingPackageUpdates(true);
    setError("");
    try {
      const result = await checkScriptPackageUpdatesSerially(
        packageNames,
        async (packageName) => {
          const current = catalog().packages.find(
            (entry): entry is ValidScriptPackage =>
              entry.status === "valid" && entry.name === packageName,
          );
          if (
            current?.source === undefined ||
            packageActiveRateLimit(current) !== undefined
          ) {
            return "skipped";
          }
          replaceCatalog(await bridge.checkPackageUpdate(packageName));
          return "checked";
        },
      );
      if (result.failedCount > 0) {
        const message = formatScriptPackageUpdateCheckFailures(result);
        console.error("[game:scripts] Package update checks failed.", {
          failedCount: result.failedCount,
          succeededCount: result.succeededCount,
        });
        setError(message);
      }
    } finally {
      setCheckingPackageUpdates(false);
      setBusy(false);
    }
  };

  const openPackage = async (entry: ScriptPackageSummary): Promise<void> => {
    try {
      if (!(await props.bridge.openPath(entry.path))) {
        throw new Error("The package folder could not be opened.");
      }
    } catch (cause) {
      setOperationError("Failed to open the package folder.", cause);
    }
  };

  const openScript = async (entry: ScriptCatalogEntry): Promise<void> => {
    try {
      const bridge = props.bridge;
      if (!(await bridge.openPath(entry.path))) {
        throw new Error("The script could not be opened.");
      }
    } catch (cause) {
      setOperationError(
        "Failed to open the script in your default editor.",
        cause,
      );
    }
  };

  const openRepository = async (entry: ValidScriptPackage): Promise<void> => {
    const repositoryUrl = entry.source?.repositoryUrl;
    if (repositoryUrl === undefined) return;
    try {
      const bridge = props.bridge;
      if (!(await bridge.openRepository(repositoryUrl))) {
        throw new Error("The repository could not be opened.");
      }
    } catch (cause) {
      setOperationError("Failed to open the package repository.", cause);
    }
  };

  const runPackagePrimaryAction = (
    entry: ValidScriptPackage,
    action: PackagePrimaryAction,
  ): void => {
    switch (action) {
      case "check":
        void checkUpdate(entry);
        return;
      case "open-folder":
        void openPackage(entry);
        return;
      case "restore":
      case "update":
        beginUpdatePackage(entry);
    }
  };

  const openPackageInstaller = (): void => {
    setInstallOptionsOpen(
      repositoryRef().trim() !== "" || credentialId() !== "",
    );
    setError("");
    setPackageManagementView("install");
  };

  const openPackageDetails = (entry: ScriptPackageSummary): void => {
    setSelectedPackagePath(entry.path);
    setError("");
    setPackageManagementView("details");
  };

  const closePackageDetails = (): void => {
    if (busy()) return;
    setSelectedPackagePath(undefined);
    setError("");
    setPackageManagementView("installed");
  };

  const resetCredentialDraft = (): void => {
    setEditingCredentialId("");
    setCredentialLabel("");
    setCredentialToken("");
    setCredentialTokenVisible(false);
  };

  const openCredentialEditor = (
    entry?: GitHubCredentialSummary,
    returnView: CredentialEditorReturnView = "credentials",
  ): void => {
    setError("");
    setCredentialEditorReturnView(returnView);
    setEditingCredentialId(entry?.id ?? "");
    setCredentialLabel(entry?.label ?? "");
    setCredentialToken("");
    setCredentialTokenVisible(false);
    setCredentialEditorOpen(true);
    setPackageManagementView("credentials");
  };

  const closeCredentialEditor = (): void => {
    if (busy()) return;
    resetCredentialDraft();
    setCredentialEditorOpen(false);
    setError("");
    if (credentialEditorReturnView() === "install") {
      setPackageManagementView("install");
    }
  };

  const openCredentialManager = (
    parentView: CredentialManagerParentView = "installed",
  ): void => {
    setCredentialManagerParentView(parentView);
    resetCredentialDraft();
    setCredentialEditorOpen(false);
    setError("");
    if (parentView === "install" && credentials().length === 0) {
      openCredentialEditor(undefined, "install");
      return;
    }
    setPackageManagementView("credentials");
  };

  const saveCredential = async (): Promise<void> => {
    const bridge = props.bridge;
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      const saved = await bridge.saveCredential({
        ...(editingCredentialId() === "" ? {} : { id: editingCredentialId() }),
        label: credentialLabel(),
        token: credentialToken(),
      });
      setCredentials((current) =>
        [...current.filter((entry) => entry.id !== saved.id), saved].sort(
          (left, right) => left.label.localeCompare(right.label),
        ),
      );
      setCredentialId(saved.id);
      const returnView = credentialEditorReturnView();
      resetCredentialDraft();
      setCredentialEditorOpen(false);
      setPackageManagementView(
        returnView === "install" ? "install" : "credentials",
      );
    } catch (cause) {
      setOperationError("Failed to save the GitHub credential.", cause);
    } finally {
      setBusy(false);
    }
  };

  const deleteCredential = (entry: GitHubCredentialSummary): void => {
    askForConfirmation({
      confirmLabel: "Delete credential",
      description: `Delete ${entry.label}? Packages that use it will stay installed, but Lucent won't be able to check for updates. Reinstall those packages with another credential to resume update checks.`,
      destructive: true,
      onConfirm: async () => {
        const bridge = props.bridge;
        await bridge.deleteCredential(entry.id);
        setCredentials((current) =>
          current.filter((candidate) => candidate.id !== entry.id),
        );
        if (credentialId() === entry.id) setCredentialId("");
        if (editingCredentialId() === entry.id) {
          resetCredentialDraft();
          setCredentialEditorOpen(false);
        }
        setConfirmation(null);
      },
      title: "Delete this credential?",
    });
  };

  const handleRoomModeChange = (value: string): void => {
    if (value === "specific") {
      setRoomEditingMode("specific");
      props.onSetRoomNumberDraft(
        props.roomPolicy.kind === "specific"
          ? String(props.roomPolicy.roomNumber)
          : "",
      );
      return;
    }
    if (value === "public" || value === "random-private") {
      setRoomEditingMode(null);
      props.onSelectRoomPolicy({ kind: value });
    }
  };

  const toggleCurrentScript = (): void => {
    if (!props.scriptRunning) props.onOpenChange(false);
    void props.onToggleScript();
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(details) => {
        if (busy()) return;
        if (!details.open) {
          setConfirmation(null);
          resetCredentialDraft();
          setCredentialEditorOpen(false);
          setCredentialEditorReturnView("credentials");
          setCredentialManagerParentView("installed");
          setInstallOptionsOpen(false);
          setSelectedPackagePath(undefined);
          setPackageManagementView("installed");
          setRoomEditingMode(null);
        }
        props.onOpenChange(details.open);
      }}
    >
      <DialogContent
        class="game-scripts-dialog"
        closeProps={{ disabled: busy() }}
      >
        <div class="game-scripts-dialog__layout">
          <DialogHeader class="game-scripts-dialog__header">
            <div class="game-scripts-dialog__title-row">
              <DialogTitle class="visually-hidden">Scripts</DialogTitle>
              <div
                class="game-scripts-dialog__current-script"
                data-loaded={props.scriptLoaded ? "" : undefined}
                data-running={props.scriptRunning ? "" : undefined}
              >
                <DialogDescription aria-live="polite">
                  {props.scriptStatus}
                </DialogDescription>
              </div>
              <div class="game-scripts-dialog__common-actions">
                <div class="game-scripts-dialog__load-run-actions">
                  <Button
                    disabled={busy() || props.scriptBusy}
                    onClick={chooseFile}
                    size="sm"
                    variant={props.scriptLoaded ? "secondary" : "default"}
                  >
                    Load script...
                  </Button>
                  <Button
                    disabled={
                      !props.scriptLoaded ||
                      busy() ||
                      props.scriptBusy ||
                      (!props.scriptRunning && !props.optionsReady)
                    }
                    onClick={toggleCurrentScript}
                    size="sm"
                    variant={props.scriptRunning ? "destructive" : "default"}
                  >
                    {props.scriptRunning ? "Stop" : "Start"}
                  </Button>
                </div>
                <span class="game-scripts-dialog__action-divider" />
                <Button
                  disabled={
                    !props.inputsAvailable ||
                    props.scriptRunning ||
                    busy() ||
                    props.scriptBusy
                  }
                  onClick={() => {
                    props.onOpenChange(false);
                    props.onEditInputs();
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Edit inputs
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div class="game-scripts-dialog__alert-slot">
            <Show when={error() !== "" && confirmation() === null}>
              <ErrorAlert
                class="game-scripts-dialog__alert"
                message={error()}
                {...(errorRetryable() ? {} : { onDismiss: () => setError("") })}
                {...(errorRetryable() ? { onRetry: retryCatalog } : {})}
                retryDisabled={
                  busy() || catalogLoading() || scriptQueryLoading()
                }
                retrying={catalogLoading() || scriptQueryLoading()}
              />
            </Show>
          </div>

          <Tabs
            class="game-scripts-dialog__tabs"
            value={activeTab()}
            onValueChange={(details) => changeActiveTab(details.value)}
          >
            <TabsList variant="underline">
              <TabsTrigger value="scripts">Scripts</TabsTrigger>
              <TabsTrigger value="packages">Packages</TabsTrigger>
              <TabsTrigger value="options">Options</TabsTrigger>
            </TabsList>
            <TabsContent
              class="game-scripts-dialog__tab-content game-scripts-dialog__scripts"
              value="scripts"
            >
              <div class="game-scripts-dialog__script-toolbar">
                <InputGroup class="game-scripts-dialog__script-search">
                  <InputGroupInput
                    aria-label="Search scripts"
                    placeholder="Search scripts..."
                    value={search()}
                    onInput={(event) =>
                      updateScriptSearch(event.currentTarget.value)
                    }
                  />
                  <InputGroupAddon align="inline-end" aria-live="polite">
                    <Show
                      when={scriptQueryIndicatorVisible()}
                      fallback={<Icon aria-hidden="true" icon="search" />}
                    >
                      <Spinner size="sm" />
                      <span class="visually-hidden">Searching scripts...</span>
                    </Show>
                  </InputGroupAddon>
                </InputGroup>
                <CatalogRefreshButton
                  disabled={busy() || catalogLoading()}
                  loading={catalogLoading() && catalog().revision !== ""}
                  onClick={() => void refreshCatalog()}
                />
              </div>
              <div
                ref={mountScriptViewport}
                aria-busy={scriptQueryLoading() ? "true" : undefined}
                class="game-scripts-dialog__script-viewport"
                onScroll={(event) => {
                  if (activeTab() === "scripts") {
                    scrollPositions.scripts = event.currentTarget.scrollTop;
                    requestScriptViewport(event.currentTarget);
                  }
                }}
              >
                <Show
                  when={catalog().revision !== "" || !catalogLoading()}
                  fallback={
                    <div
                      class="game-scripts-dialog__empty game-scripts-dialog__loading"
                      role="status"
                    >
                      <Spinner size="sm" />
                      <span>Loading scripts...</span>
                    </div>
                  }
                >
                  <Show
                    when={scriptTotal() > 0}
                    fallback={
                      <div class="game-scripts-dialog__empty game-scripts-dialog__collection-empty">
                        <p class="game-scripts-dialog__collection-empty-title">
                          {catalogQuery() === ""
                            ? "No scripts found"
                            : "No matching scripts"}
                        </p>
                        <Show
                          when={catalogQuery() === ""}
                          fallback={
                            <Button
                              onClick={clearScriptSearch}
                              size="sm"
                              variant="secondary"
                            >
                              Clear search
                            </Button>
                          }
                        >
                          <p class="game-scripts-dialog__collection-empty-description">
                            Load a file or install a package.
                          </p>
                          <div class="game-scripts-dialog__collection-empty-actions">
                            <Button onClick={chooseFile} size="sm">
                              Load script...
                            </Button>
                            <Button
                              onClick={() => {
                                changeActiveTab("packages");
                                openPackageInstaller();
                              }}
                              size="sm"
                              variant="secondary"
                            >
                              Install package
                            </Button>
                          </div>
                        </Show>
                      </div>
                    }
                  >
                    <div
                      class="game-scripts-dialog__virtual-list"
                      style={{
                        height: `${scriptVirtualizer.getTotalSize()}px`,
                      }}
                    >
                      <For each={scriptVirtualizer.getVirtualItems()}>
                        {(virtualRow) => {
                          const entry = () =>
                            scriptCatalogEntryAt(
                              scriptPages(),
                              virtualRow.index,
                            );
                          return (
                            <Show
                              when={entry()}
                              keyed
                              fallback={
                                <div
                                  aria-hidden="true"
                                  class="game-scripts-dialog__script-row game-scripts-dialog__script-row--loading"
                                  data-last={
                                    virtualRow.index === scriptTotal() - 1
                                      ? ""
                                      : undefined
                                  }
                                  style={{
                                    height: `${virtualRow.size}px`,
                                    transform: `translateY(${virtualRow.start}px)`,
                                  }}
                                >
                                  <div class="game-scripts-dialog__script-copy">
                                    <span />
                                    <span />
                                  </div>
                                </div>
                              }
                            >
                              {(script) => {
                                const selected = () =>
                                  sameReference(
                                    props.loadedReference,
                                    script.reference,
                                  );
                                return (
                                  <div
                                    class="game-scripts-dialog__script-row"
                                    data-last={
                                      virtualRow.index === scriptTotal() - 1
                                        ? ""
                                        : undefined
                                    }
                                    data-selected={selected() ? "" : undefined}
                                    style={{
                                      height: `${virtualRow.size}px`,
                                      transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                  >
                                    <div class="game-scripts-dialog__script-copy">
                                      <button
                                        aria-label={`Open ${scriptLocation(script)} in your default editor`}
                                        class="game-scripts-dialog__script-path"
                                        onClick={() => void openScript(script)}
                                        title={script.path}
                                        type="button"
                                      >
                                        <Show
                                          when={scriptContext(script)}
                                          keyed
                                        >
                                          {(context) => (
                                            <>
                                              <span class="game-scripts-dialog__script-context">
                                                {truncatePathContext(
                                                  context,
                                                  scriptContextLimit(),
                                                )}
                                              </span>
                                              <span
                                                aria-hidden="true"
                                                class="game-scripts-dialog__script-separator"
                                              >
                                                /
                                              </span>
                                            </>
                                          )}
                                        </Show>
                                        <span class="game-scripts-dialog__script-name">
                                          {script.name}
                                        </span>
                                        <Icon
                                          aria-hidden="true"
                                          class="game-scripts-dialog__script-open-icon"
                                          icon="arrow_up_right"
                                          size="xs"
                                        />
                                      </button>
                                    </div>
                                    <div class="game-scripts-dialog__row-actions">
                                      <Button
                                        disabled={
                                          busy() ||
                                          props.scriptBusy ||
                                          (selected() && props.scriptRunning)
                                        }
                                        onClick={() =>
                                          selectScript(script, false)
                                        }
                                        size="sm"
                                        variant="outline"
                                      >
                                        Load
                                      </Button>
                                      <Button
                                        disabled={
                                          busy() ||
                                          props.scriptBusy ||
                                          (selected() && props.scriptRunning) ||
                                          !props.optionsReady
                                        }
                                        onClick={() =>
                                          selectScript(script, true)
                                        }
                                        size="sm"
                                      >
                                        Start
                                      </Button>
                                    </div>
                                  </div>
                                );
                              }}
                            </Show>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </Show>
              </div>
            </TabsContent>

            <TabsContent
              class="game-scripts-dialog__tab-content game-scripts-dialog__options-view"
              value="options"
            >
              <section
                aria-labelledby="game-scripts-dialog-options-title"
                class="game-scripts-dialog__options"
              >
                <div class="game-scripts-dialog__options-heading">
                  <span
                    class="game-scripts-dialog__section-title"
                    id="game-scripts-dialog-options-title"
                  >
                    Script behavior
                  </span>
                  <p>Set per-account script preferences.</p>
                </div>
                <div class="game-scripts-dialog__options-list">
                  <div class="game-scripts-dialog__option-row">
                    <div class="game-scripts-dialog__option-copy">
                      <span
                        class="game-scripts-dialog__option-title"
                        id="script-option-safe-start-stop-title"
                      >
                        Safe start and stop
                      </span>
                      <span
                        class="game-scripts-dialog__option-description"
                        id="script-option-safe-start-stop-description"
                      >
                        Best effort attempt to start or stop the script at your
                        house.
                      </span>
                    </div>
                    <div class="game-scripts-dialog__option-action">
                      <Switch
                        aria-labelledby="script-option-safe-start-stop-title script-option-safe-start-stop-description"
                        checked={props.safeStartStop}
                        disabled={!props.optionsReady}
                        onChange={props.onToggleSafeStartStop}
                      />
                    </div>
                  </div>
                  <div class="game-scripts-dialog__option-row">
                    <div class="game-scripts-dialog__option-copy">
                      <span
                        class="game-scripts-dialog__option-title"
                        id="script-option-reconnect-title"
                      >
                        Restart after reconnecting
                      </span>
                      <span
                        class="game-scripts-dialog__option-description"
                        id="script-option-reconnect-description"
                      >
                        Restart the active script when the same account
                        reconnects.
                      </span>
                    </div>
                    <div class="game-scripts-dialog__option-action">
                      <Switch
                        aria-labelledby="script-option-reconnect-title script-option-reconnect-description"
                        checked={props.restartAfterReconnect}
                        disabled={!props.optionsReady}
                        onChange={props.onToggleRestartAfterReconnect}
                      />
                    </div>
                  </div>
                  <div class="game-scripts-dialog__option-row">
                    <div class="game-scripts-dialog__option-copy">
                      <span class="game-scripts-dialog__option-title">
                        Rooms
                      </span>
                      <span class="game-scripts-dialog__option-description">
                        Choose which rooms scripts join.
                      </span>
                    </div>
                    <div class="game-scripts-dialog__option-action">
                      <Select
                        class="game-scripts-dialog__room-policy-select"
                        disabled={!props.optionsReady}
                        ids={{ trigger: "script-room-policy" }}
                        value={[roomMode()]}
                        onValueChange={(details) => {
                          const value = details.value[0];
                          if (value !== undefined) {
                            handleRoomModeChange(value);
                          }
                        }}
                      >
                        <SelectTrigger aria-label="Rooms" size="sm">
                          <span class="select__value">
                            {roomPolicyLabels[roomMode()]}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="public">
                            {roomPolicyLabels.public}
                          </SelectItem>
                          <SelectItem value="random-private">
                            {roomPolicyLabels["random-private"]}
                          </SelectItem>
                          <SelectItem value="specific">
                            {roomPolicyLabels.specific}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Show when={roomMode() === "specific"}>
                    <div class="game-scripts-dialog__room-number-suboption">
                      <div class="game-scripts-dialog__option-copy">
                        <label
                          class="game-scripts-dialog__option-title"
                          for="script-room-number"
                        >
                          Room number
                        </label>
                        <span
                          class="game-scripts-dialog__room-number-feedback"
                          data-invalid={roomMessage() !== "" ? "" : undefined}
                          id="script-room-number-feedback"
                        >
                          {roomMessage() ||
                            (roomKind() === "public"
                              ? "This number selects a public room."
                              : roomKind() === "private"
                                ? "This number selects a private room."
                                : "Enter a room number from 1 to 99,999.")}
                        </span>
                      </div>
                      <Input
                        aria-describedby="script-room-number-feedback"
                        class="game-scripts-dialog__room-number-input"
                        disabled={!props.optionsReady}
                        id="script-room-number"
                        inputMode="numeric"
                        invalid={roomMessage() !== ""}
                        maxLength={5}
                        size="sm"
                        value={props.roomNumberDraft}
                        onBlur={props.onCommitRoomNumber}
                        onInput={(event) =>
                          props.onSetRoomNumberDraft(event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          props.onCommitRoomNumber();
                        }}
                      />
                    </div>
                  </Show>
                </div>
              </section>
            </TabsContent>

            <TabsContent
              class="game-scripts-dialog__tab-content game-scripts-dialog__packages"
              value="packages"
            >
              <Show
                when={
                  packageManagementView() === "installed" &&
                  catalog().packages.length > 0
                }
              >
                <div
                  aria-label="Package actions"
                  class="game-scripts-dialog__package-toolbar"
                  role="toolbar"
                >
                  <div class="game-scripts-dialog__package-toolbar-group">
                    <Button onClick={openPackageInstaller} size="sm">
                      <Icon icon="plus" size="sm" />
                      Install package
                    </Button>
                    <Button
                      disabled={busy()}
                      onClick={() => openCredentialManager("installed")}
                      size="sm"
                      variant="secondary"
                    >
                      <Icon icon="key_round" size="sm" />
                      GitHub credentials
                    </Button>
                  </div>
                  <div class="game-scripts-dialog__package-toolbar-actions">
                    <PackageUpdateCheckButton
                      checking={checkingPackageUpdates()}
                      disabled={
                        busy() ||
                        catalogLoading() ||
                        packagesEligibleForUpdateCheck().length === 0
                      }
                      label="Check for updates"
                      onClick={() => void checkAllPackageUpdates()}
                      variant="ghost"
                    />
                    <CatalogRefreshButton
                      disabled={busy() || catalogLoading()}
                      loading={catalogLoading() && catalog().revision !== ""}
                      onClick={() => void refreshCatalog()}
                    />
                  </div>
                </div>
              </Show>

              <Show when={packageManagementBreadcrumb()} keyed>
                {(breadcrumb) => (
                  <div class="game-scripts-dialog__section-heading">
                    <nav
                      aria-label="Package navigation"
                      class="game-scripts-dialog__breadcrumb"
                    >
                      <Button
                        class="game-scripts-dialog__breadcrumb-link"
                        disabled={busy()}
                        onClick={() => {
                          if (packageManagementView() === "credentials") {
                            resetCredentialDraft();
                            setCredentialEditorOpen(false);
                            setError("");
                          }
                          setPackageManagementView(breadcrumb.parentView);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <Icon
                          aria-hidden="true"
                          class="game-scripts-dialog__breadcrumb-back-icon"
                          icon="arrow_left"
                          size="xs"
                        />
                        {breadcrumb.parent}
                      </Button>
                      <Icon
                        aria-hidden="true"
                        class="game-scripts-dialog__breadcrumb-separator"
                        icon="chevron_right"
                        size="xs"
                      />
                      <span
                        aria-current="page"
                        class="game-scripts-dialog__breadcrumb-current"
                        id="script-package-management-title"
                      >
                        {breadcrumb.current}
                      </span>
                    </nav>
                    <Show
                      when={
                        packageManagementView() === "credentials" &&
                        !credentialEditorOpen() &&
                        credentials().length > 0
                      }
                    >
                      <Button
                        onClick={() => openCredentialEditor()}
                        size="sm"
                        variant="secondary"
                      >
                        <Icon icon="plus" size="sm" />
                        Add credential
                      </Button>
                    </Show>
                  </div>
                )}
              </Show>

              <Show
                when={
                  packageManagementView() === "install" || firstPackageInstall()
                }
              >
                <section
                  aria-labelledby="script-package-management-title"
                  class="game-scripts-dialog__install"
                >
                  <Show
                    when={
                      packageManagementView() === "install" &&
                      catalog().packages.length > 0
                    }
                  >
                    <Button
                      class="game-scripts-dialog__install-back"
                      disabled={busy()}
                      onClick={() => {
                        setError("");
                        setPackageManagementView("installed");
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      <Icon icon="arrow_left" size="xs" />
                      Packages
                    </Button>
                  </Show>
                  <div class="game-scripts-dialog__install-heading">
                    <h2 id="script-package-management-title">
                      Install package
                    </h2>
                    <Button
                      disabled={busy()}
                      onClick={() => openCredentialManager("install")}
                      size="sm"
                      variant="secondary"
                    >
                      <Icon icon="key_round" size="sm" />
                      GitHub credentials
                    </Button>
                  </div>
                  <div class="game-scripts-dialog__install-fields">
                    <Field
                      class="game-scripts-dialog__install-repository"
                      contentClass="game-scripts-dialog__repository-field"
                      error={
                        repositoryInput().kind === "invalid" &&
                        repositoryUrl().trim() !== ""
                      }
                      for="script-package-repository"
                      label="GitHub repository"
                    >
                      <Input
                        aria-describedby={
                          repositoryInput().kind === "repository"
                            ? undefined
                            : "script-package-repository-feedback"
                        }
                        fullWidth
                        id="script-package-repository"
                        invalid={
                          repositoryInput().kind === "invalid" &&
                          repositoryUrl().trim() !== ""
                        }
                        required
                        placeholder="https://github.com/owner/repository"
                        value={repositoryUrl()}
                        onInput={(event) => {
                          setRepositoryUrl(event.currentTarget.value);
                          setError("");
                        }}
                      />
                      <Show when={repositoryInput().kind !== "repository"}>
                        <div
                          class="game-scripts-dialog__repository-feedback"
                          data-invalid={
                            repositoryInput().kind === "invalid" &&
                            repositoryUrl().trim() !== ""
                              ? ""
                              : undefined
                          }
                          id="script-package-repository-feedback"
                        >
                          <Show
                            when={repositorySuggestion()}
                            fallback={
                              repositoryUrl().trim() === ""
                                ? "Enter the repository's GitHub URL."
                                : "Enter an https://github.com/owner/repository URL."
                            }
                          >
                            {(suggestion) => (
                              <>
                                <span>
                                  Did you mean {suggestion().repository.owner}/
                                  {suggestion().repository.repository} at ref{" "}
                                  {suggestion().ref}?
                                </span>
                                <Button
                                  onClick={applyRepositorySuggestion}
                                  size="xs"
                                  type="button"
                                  variant="link"
                                >
                                  Use suggestion
                                </Button>
                              </>
                            )}
                          </Show>
                        </div>
                      </Show>
                    </Field>
                    <Button
                      aria-controls="script-package-install-options"
                      aria-expanded={installOptionsOpen()}
                      class="game-scripts-dialog__install-options-toggle"
                      onClick={() =>
                        setInstallOptionsOpen((current) => !current)
                      }
                      size="xs"
                      type="button"
                      variant="ghost"
                    >
                      <Icon
                        aria-hidden="true"
                        class={
                          installOptionsOpen()
                            ? "game-scripts-dialog__install-options-icon game-scripts-dialog__install-options-icon--open"
                            : "game-scripts-dialog__install-options-icon"
                        }
                        icon="chevron_right"
                        size="xs"
                      />
                      Advanced options
                    </Button>
                    <Show when={installOptionsOpen()}>
                      <div
                        class="game-scripts-dialog__install-options"
                        id="script-package-install-options"
                      >
                        <Field
                          class="game-scripts-dialog__install-ref"
                          for="script-package-ref"
                          label="Git ref"
                        >
                          <Input
                            fullWidth
                            id="script-package-ref"
                            placeholder="Branch, tag, or commit"
                            value={repositoryRef()}
                            onInput={(event) =>
                              setRepositoryRef(event.currentTarget.value)
                            }
                          />
                        </Field>
                        <Field
                          class="game-scripts-dialog__install-credential"
                          contentClass="game-scripts-dialog__credential-field"
                          for="script-package-credential"
                          label="GitHub access"
                        >
                          <Select
                            class="game-scripts-dialog__credential-select"
                            ids={{ trigger: "script-package-credential" }}
                            positioning={{
                              fitViewport: true,
                              gutter: 4,
                              placement: "bottom-start",
                              sameWidth: true,
                            }}
                            value={[
                              credentialId() === ""
                                ? "no-credential"
                                : credentialId(),
                            ]}
                            onValueChange={(details) => {
                              const value = details.value[0];
                              if (value === undefined) return;
                              setCredentialId(
                                value === "no-credential" ? "" : value,
                              );
                            }}
                          >
                            <SelectTrigger
                              class="game-scripts-dialog__credential-menu-trigger select__trigger select__trigger--sm"
                              title="Optional. Use a token for private repositories or a higher GitHub request limit."
                            >
                              <span
                                class="select__value"
                                title={
                                  selectedCredential()?.label ??
                                  "No credential. Works with public repositories."
                                }
                              >
                                {selectedCredential()?.label ?? "No credential"}
                              </span>
                            </SelectTrigger>
                            <SelectContent class="game-scripts-dialog__credential-select-content">
                              <SelectItem
                                class="game-scripts-dialog__credential-option"
                                label="No credential"
                                value="no-credential"
                              >
                                <span class="game-scripts-dialog__credential-option-copy">
                                  <span class="game-scripts-dialog__credential-option-label">
                                    No credential
                                  </span>
                                </span>
                              </SelectItem>
                              <For each={credentials()}>
                                {(credential) => (
                                  <SelectItem
                                    class="game-scripts-dialog__credential-option"
                                    label={credential.label}
                                    title={credential.label}
                                    value={credential.id}
                                  >
                                    <span class="game-scripts-dialog__credential-option-label">
                                      {credential.label}
                                    </span>
                                  </SelectItem>
                                )}
                              </For>
                            </SelectContent>
                          </Select>
                          <div class="game-scripts-dialog__credential-field-footer">
                            Public repositories don't need a credential.
                          </div>
                        </Field>
                      </div>
                    </Show>
                    <div class="game-scripts-dialog__install-actions">
                      <Button
                        disabled={
                          busy() ||
                          repositoryInput().kind !== "repository" ||
                          installRateLimit() !== undefined
                        }
                        onClick={beginInstall}
                        size="sm"
                        title={packageRateLimitTitle(installRateLimit())}
                      >
                        <Show when={installRateLimit()} fallback="Install">
                          {(limit) =>
                            formatScriptPackageRetryLabel(
                              limit().retryAtTimestamp,
                              rateLimitNow(),
                            )
                          }
                        </Show>
                      </Button>
                    </div>
                  </div>
                </section>
              </Show>

              <Show
                when={
                  packageManagementView() === "details"
                    ? selectedPackage()
                    : undefined
                }
                keyed
              >
                {(entry) => (
                  <section
                    ref={mountPackageViewport}
                    aria-label="Package details"
                    class="game-scripts-dialog__package-details"
                    onScroll={(event) => {
                      if (activeTab() === "packages") {
                        scrollPositions.packages =
                          event.currentTarget.scrollTop;
                      }
                    }}
                  >
                    <Button
                      class="game-scripts-dialog__package-details-back"
                      disabled={busy()}
                      onClick={closePackageDetails}
                      size="sm"
                      variant="ghost"
                    >
                      <Icon icon="arrow_left" size="xs" />
                      Packages
                    </Button>
                    <Show
                      when={entry.status === "valid" ? entry : undefined}
                      keyed
                      fallback={
                        <>
                          <header class="game-scripts-dialog__package-details-heading">
                            <div class="game-scripts-dialog__package-details-identity">
                              <span class="game-scripts-dialog__package-name">
                                {entry.name ?? "Invalid package"}
                              </span>
                              <p>Lucent couldn't load this package.</p>
                            </div>
                          </header>
                          <Alert
                            class="game-scripts-dialog__package-notice"
                            variant="error"
                          >
                            <AlertTitle>
                              <Icon icon="triangle_alert" size="md" />
                              Needs attention
                            </AlertTitle>
                            <AlertDescription>
                              {entry.status === "invalid"
                                ? entry.diagnostic
                                : "This folder isn't a valid package."}
                            </AlertDescription>
                          </Alert>
                          <dl class="game-scripts-dialog__package-detail-list">
                            <div class="game-scripts-dialog__package-detail-row">
                              <dt>Location</dt>
                              <dd>
                                <span title={entry.path}>{entry.path}</span>
                              </dd>
                            </div>
                          </dl>
                          <div class="game-scripts-dialog__package-detail-actions">
                            <Button
                              onClick={() => void openPackage(entry)}
                              size="sm"
                              variant="secondary"
                            >
                              <Icon icon="folder_open" size="sm" />
                              Open folder
                            </Button>
                          </div>
                        </>
                      }
                    >
                      {(valid) => {
                        const displayStatus = createMemo(() =>
                          packageDisplayStatus(valid, rateLimitNow()),
                        );
                        const checkSummary = createMemo(() =>
                          packageCheckSummary(valid, rateLimitNow()),
                        );
                        const noticeDescription = createMemo(() =>
                          packageNoticeDescription(valid, displayStatus()),
                        );
                        return (
                          <>
                            <header class="game-scripts-dialog__package-details-heading">
                              <div class="game-scripts-dialog__package-details-identity">
                                <div class="game-scripts-dialog__package-details-title">
                                  <span class="game-scripts-dialog__package-name">
                                    {valid.name}
                                  </span>
                                  <Show when={valid.version} keyed>
                                    {(version) => (
                                      <span class="game-scripts-dialog__package-version">
                                        v{version}
                                      </span>
                                    )}
                                  </Show>
                                  <Show when={!needsPackageNotice(valid)}>
                                    <Badge
                                      class="game-scripts-dialog__package-status-badge"
                                      size="default"
                                      variant={displayStatus().tone}
                                    >
                                      {displayStatus().label}
                                    </Badge>
                                  </Show>
                                </div>
                                <Show when={valid.description} keyed>
                                  {(description) => (
                                    <p title={description}>{description}</p>
                                  )}
                                </Show>
                              </div>
                            </header>
                            <Show when={needsPackageNotice(valid)}>
                              <Alert
                                class="game-scripts-dialog__package-notice"
                                variant={packageAlertVariant(displayStatus())}
                              >
                                <AlertTitle>
                                  <Icon icon={displayStatus().icon} size="md" />
                                  {displayStatus().label}
                                </AlertTitle>
                                <AlertDescription>
                                  {noticeDescription()}
                                </AlertDescription>
                                <Show
                                  when={valid.update.status === "available"}
                                >
                                  <AlertAction>
                                    <Button
                                      disabled={
                                        busy() ||
                                        packageActiveRateLimit(valid) !==
                                          undefined
                                      }
                                      onClick={() => beginUpdatePackage(valid)}
                                      size="sm"
                                    >
                                      Update
                                    </Button>
                                  </AlertAction>
                                </Show>
                              </Alert>
                            </Show>
                            <dl class="game-scripts-dialog__package-detail-list">
                              <Show
                                when={valid.source}
                                keyed
                                fallback={
                                  <div class="game-scripts-dialog__package-detail-row">
                                    <dt>Source</dt>
                                    <dd>Local folder</dd>
                                  </div>
                                }
                              >
                                {(source) => (
                                  <div class="game-scripts-dialog__package-detail-row">
                                    <dt>Source</dt>
                                    <dd class="game-scripts-dialog__package-source">
                                      <span class="game-scripts-dialog__package-source-identity">
                                        <span class="game-scripts-dialog__package-source-reference">
                                          <Button
                                            aria-label={`Open ${valid.name} repository`}
                                            class="game-scripts-dialog__package-source-repository"
                                            onClick={() =>
                                              void openRepository(valid)
                                            }
                                            size="xs"
                                            title={source.repositoryUrl}
                                            variant="link"
                                          >
                                            <span class="game-scripts-dialog__package-source-repository-label">
                                              {source.repositoryUrl
                                                .replace(
                                                  /^https:\/\/github\.com\//,
                                                  "",
                                                )
                                                .replace(/\/$/, "")}
                                            </span>
                                            <Show
                                              when={source.requestedRef}
                                              keyed
                                            >
                                              {(requestedRef) => (
                                                <span class="game-scripts-dialog__package-source-ref">
                                                  ({requestedRef})
                                                </span>
                                              )}
                                            </Show>
                                            <Icon
                                              aria-hidden="true"
                                              class="game-scripts-dialog__package-source-open-icon"
                                              icon="arrow_up_right"
                                              size="xs"
                                            />
                                          </Button>
                                        </span>
                                        <span class="game-scripts-dialog__package-source-commit">
                                          <span class="game-scripts-dialog__package-source-commit-label">
                                            Commit
                                          </span>
                                          <code
                                            class="game-scripts-dialog__package-detail-mono"
                                            title={source.resolvedCommit}
                                          >
                                            {source.resolvedCommit.slice(0, 7)}
                                          </code>
                                          <TooltipIconButton
                                            aria-label={`Copy commit ${source.resolvedCommit}`}
                                            class="game-scripts-dialog__package-source-copy"
                                            onClick={() =>
                                              void copyCommit(
                                                valid.path,
                                                source.resolvedCommit,
                                              )
                                            }
                                            size="icon-xs"
                                            tooltip={
                                              copiedCommitPath() === valid.path
                                                ? "Copied"
                                                : "Copy commit"
                                            }
                                          >
                                            <Icon
                                              icon={
                                                copiedCommitPath() ===
                                                valid.path
                                                  ? "check"
                                                  : "copy"
                                              }
                                              size="xs"
                                            />
                                          </TooltipIconButton>
                                        </span>
                                      </span>
                                    </dd>
                                  </div>
                                )}
                              </Show>
                              <Show when={checkSummary().timestamp} keyed>
                                {(timestamp) => (
                                  <div class="game-scripts-dialog__package-detail-row">
                                    <dt>{checkSummary().timestampLabel}</dt>
                                    <dd>
                                      <time
                                        datetime={timestamp}
                                        title={new Date(
                                          timestamp,
                                        ).toLocaleString()}
                                      >
                                        {formatRelativeTime(
                                          timestamp,
                                          rateLimitNow(),
                                        )}
                                      </time>
                                    </dd>
                                  </div>
                                )}
                              </Show>
                            </dl>
                            <div
                              aria-label="Package actions"
                              class="game-scripts-dialog__package-detail-actions"
                              role="toolbar"
                            >
                              <div class="game-scripts-dialog__package-detail-actions-group">
                                <Show
                                  when={packageFooterPrimaryAction(valid)}
                                  keyed
                                >
                                  {(action) =>
                                    action === "check" ? (
                                      <PackageUpdateCheckButton
                                        checking={
                                          checkingPackageName() === valid.name
                                        }
                                        disabled={
                                          busy() ||
                                          packageActiveRateLimit(valid) !==
                                            undefined
                                        }
                                        label={packageActionLabel(
                                          valid,
                                          action,
                                        )}
                                        onClick={() =>
                                          runPackagePrimaryAction(valid, action)
                                        }
                                        title={packageRateLimitTitle(
                                          packageActiveRateLimit(valid),
                                        )}
                                        variant="secondary"
                                      />
                                    ) : (
                                      <Button
                                        disabled={
                                          busy() ||
                                          packageActiveRateLimit(valid) !==
                                            undefined
                                        }
                                        onClick={() =>
                                          runPackagePrimaryAction(valid, action)
                                        }
                                        size="sm"
                                        title={packageRateLimitTitle(
                                          packageActiveRateLimit(valid),
                                        )}
                                        variant={
                                          action === "update"
                                            ? "default"
                                            : "secondary"
                                        }
                                      >
                                        {packageActionLabel(valid, action)}
                                      </Button>
                                    )
                                  }
                                </Show>
                                <Show
                                  when={
                                    packagePrimaryAction(valid) !==
                                    "open-folder"
                                  }
                                >
                                  <Button
                                    onClick={() => void openPackage(valid)}
                                    size="sm"
                                    variant="secondary"
                                  >
                                    <Icon icon="folder_open" size="sm" />
                                    Open folder
                                  </Button>
                                </Show>
                                <Show
                                  when={
                                    valid.source !== undefined &&
                                    packagePrimaryAction(valid) !== "check"
                                  }
                                >
                                  <PackageUpdateCheckButton
                                    checking={
                                      checkingPackageName() === valid.name
                                    }
                                    disabled={
                                      busy() ||
                                      packageActiveRateLimit(valid) !==
                                        undefined
                                    }
                                    label={packageUpdateCheckLabel(valid)}
                                    onClick={() => void checkUpdate(valid)}
                                    title={packageRateLimitTitle(
                                      packageActiveRateLimit(valid),
                                    )}
                                    variant="secondary"
                                  />
                                </Show>
                              </div>
                              <Button
                                class="game-scripts-dialog__package-remove-button"
                                disabled={busy()}
                                onClick={() => removePackage(valid)}
                                size="sm"
                                variant="destructive-outline"
                              >
                                Remove package
                              </Button>
                            </div>
                          </>
                        );
                      }}
                    </Show>
                  </section>
                )}
              </Show>

              <Show when={packageManagementView() === "credentials"}>
                <section
                  aria-labelledby="script-package-management-title"
                  class="game-scripts-dialog__credential-manager"
                  data-editor-open={credentialEditorOpen() ? "" : undefined}
                >
                  <div class="game-scripts-dialog__credential-manager-body">
                    <Show
                      when={credentialEditorOpen()}
                      fallback={
                        <>
                          <Show
                            when={credentials().length > 0}
                            fallback={
                              <div class="game-scripts-dialog__credential-manager-empty">
                                <div>
                                  <strong>No GitHub credentials</strong>
                                  <span>
                                    Only needed for private repositories.
                                  </span>
                                </div>
                                <Button
                                  onClick={() => openCredentialEditor()}
                                  size="sm"
                                >
                                  <Icon icon="plus" size="sm" />
                                  Add credential
                                </Button>
                              </div>
                            }
                          >
                            <div class="game-scripts-dialog__credential-manager-list">
                              <For each={credentials()}>
                                {(credential) => (
                                  <div class="game-scripts-dialog__credential-manager-row">
                                    <div class="game-scripts-dialog__credential-manager-copy">
                                      <span
                                        class="game-scripts-dialog__credential-manager-label"
                                        title={credential.label}
                                      >
                                        {credential.label}
                                      </span>
                                    </div>
                                    <Menu
                                      positioning={{
                                        gutter: 4,
                                        placement: "bottom-end",
                                      }}
                                    >
                                      <MenuTrigger
                                        asChild={(triggerProps) => (
                                          <IconButton
                                            {...(triggerProps({
                                              "aria-label": `More actions for ${credential.label}`,
                                              children: (
                                                <Icon
                                                  icon="ellipsis"
                                                  size="sm"
                                                />
                                              ),
                                              disabled: busy(),
                                              size: "icon-sm",
                                              type: "button",
                                              variant: "ghost",
                                            } as IconButtonProps) as IconButtonProps)}
                                          />
                                        )}
                                      />
                                      <MenuContent>
                                        <MenuItem
                                          onSelect={() =>
                                            queueMicrotask(() =>
                                              openCredentialEditor(credential),
                                            )
                                          }
                                          value="replace-token"
                                        >
                                          Replace token
                                        </MenuItem>
                                        <MenuSeparator />
                                        <MenuItem
                                          onSelect={() =>
                                            queueMicrotask(() =>
                                              deleteCredential(credential),
                                            )
                                          }
                                          value="delete-credential"
                                          variant="destructive"
                                        >
                                          Delete
                                        </MenuItem>
                                      </MenuContent>
                                    </Menu>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>
                        </>
                      }
                    >
                      <div class="game-scripts-dialog__credential-editor">
                        <div class="game-scripts-dialog__credential-editor-body">
                          <div class="game-scripts-dialog__credential-editor-heading">
                            <h3 class="game-scripts-dialog__credential-editor-title">
                              {editingCredentialId() === ""
                                ? "Add credential"
                                : "Replace token"}
                            </h3>
                            <p class="game-scripts-dialog__credential-view-description">
                              {editingCredentialId() === ""
                                ? "Use a personal access token for private repositories and higher GitHub API rate limits."
                                : `Enter a new token for ${credentialLabel()}.`}
                            </p>
                          </div>
                          <Show when={editingCredentialId() === ""}>
                            <Field
                              for="script-package-credential-label"
                              label="Name"
                            >
                              <Input
                                autofocus
                                fullWidth
                                id="script-package-credential-label"
                                placeholder="Personal GitHub"
                                value={credentialLabel()}
                                onInput={(event) =>
                                  setCredentialLabel(event.currentTarget.value)
                                }
                              />
                            </Field>
                          </Show>
                          <Field
                            contentClass="game-scripts-dialog__credential-token-field"
                            for="script-package-credential-token"
                            label={
                              editingCredentialId() === ""
                                ? "Personal access token"
                                : "New personal access token"
                            }
                          >
                            <InputGroup class="game-scripts-dialog__credential-token-control">
                              <InputGroupInput
                                autofocus={editingCredentialId() !== ""}
                                id="script-package-credential-token"
                                type={
                                  credentialTokenVisible() ? "text" : "password"
                                }
                                value={credentialToken()}
                                onInput={(event) =>
                                  setCredentialToken(event.currentTarget.value)
                                }
                              />
                              <InputGroupAddon
                                align="inline-end"
                                class="game-scripts-dialog__credential-token-addon"
                              >
                                <Button
                                  aria-label={
                                    credentialTokenVisible()
                                      ? "Hide personal access token"
                                      : "Show personal access token"
                                  }
                                  aria-pressed={credentialTokenVisible()}
                                  class="game-scripts-dialog__credential-token-visibility"
                                  onClick={() =>
                                    setCredentialTokenVisible(
                                      (visible) => !visible,
                                    )
                                  }
                                  size="sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  <Icon
                                    icon={
                                      credentialTokenVisible()
                                        ? "eye_off"
                                        : "eye"
                                    }
                                    size="xs"
                                  />
                                </Button>
                              </InputGroupAddon>
                            </InputGroup>
                            <div class="game-scripts-dialog__credential-token-help">
                              <span>Prefer read-only repository access.</span>
                              <Button
                                class="game-scripts-dialog__credential-token-link"
                                onClick={openGitHubTokenPage}
                                size="xs"
                                variant="ghost"
                              >
                                Create a GitHub token
                                <Icon icon="arrow_up_right" size="xs" />
                              </Button>
                            </div>
                          </Field>
                        </div>
                        <div class="game-scripts-dialog__credential-editor-actions">
                          <Button
                            disabled={busy()}
                            onClick={closeCredentialEditor}
                            size="sm"
                            variant="outline"
                          >
                            Cancel
                          </Button>
                          <Button
                            disabled={
                              busy() ||
                              credentialLabel().trim() === "" ||
                              credentialToken().trim() === ""
                            }
                            loading={busy()}
                            onClick={() => void saveCredential()}
                            size="sm"
                          >
                            {editingCredentialId() !== ""
                              ? "Replace token"
                              : "Save credential"}
                          </Button>
                        </div>
                      </div>
                    </Show>
                  </div>
                </section>
              </Show>

              <Show
                when={
                  packageManagementView() === "installed" &&
                  !firstPackageInstall()
                }
              >
                <Show
                  when={catalog().revision !== "" || !catalogLoading()}
                  fallback={
                    <div
                      class="game-scripts-dialog__empty game-scripts-dialog__loading"
                      role="status"
                    >
                      <Spinner size="sm" />
                      <span>Loading packages...</span>
                    </div>
                  }
                >
                  <Show when={catalog().packages.length > 0}>
                    <div
                      ref={mountPackageViewport}
                      class="game-scripts-dialog__package-list"
                      onScroll={(event) => {
                        if (activeTab() === "packages") {
                          scrollPositions.packages =
                            event.currentTarget.scrollTop;
                        }
                      }}
                    >
                      <For each={catalog().packages}>
                        {(entry) => (
                          <Show
                            when={entry.status === "valid" ? entry : undefined}
                            keyed
                            fallback={
                              <button
                                aria-label={`View ${entry.name ?? "invalid package"} details`}
                                class="game-scripts-dialog__package-row"
                                onClick={() => openPackageDetails(entry)}
                                type="button"
                              >
                                <span class="game-scripts-dialog__package-copy">
                                  <span class="game-scripts-dialog__package-title">
                                    <span class="game-scripts-dialog__package-name">
                                      {entry.name ?? "Invalid package"}
                                    </span>
                                  </span>
                                  <span
                                    class="game-scripts-dialog__package-description"
                                    title={
                                      entry.status === "invalid"
                                        ? entry.diagnostic
                                        : undefined
                                    }
                                  >
                                    {entry.status === "invalid"
                                      ? entry.diagnostic
                                      : "This folder isn't a valid package."}
                                  </span>
                                </span>
                                <span
                                  class="game-scripts-dialog__package-row-tail"
                                  data-tone="error"
                                >
                                  <span>Needs attention</span>
                                  <Icon icon="chevron_right" size="sm" />
                                </span>
                              </button>
                            }
                          >
                            {(valid) => {
                              const displayStatus = createMemo(() =>
                                packageDisplayStatus(valid, rateLimitNow()),
                              );
                              return (
                                <button
                                  aria-label={`View ${valid.name} package details`}
                                  class="game-scripts-dialog__package-row"
                                  onClick={() => openPackageDetails(valid)}
                                  type="button"
                                >
                                  <span class="game-scripts-dialog__package-copy">
                                    <span class="game-scripts-dialog__package-title">
                                      <span class="game-scripts-dialog__package-name">
                                        {valid.name}
                                      </span>
                                      <Show when={valid.version} keyed>
                                        {(version) => (
                                          <span class="game-scripts-dialog__package-version">
                                            v{version}
                                          </span>
                                        )}
                                      </Show>
                                    </span>
                                    <span
                                      class="game-scripts-dialog__package-description"
                                      title={
                                        valid.description ??
                                        displayStatus().description
                                      }
                                    >
                                      {valid.description ??
                                        displayStatus().description}
                                    </span>
                                  </span>
                                  <span
                                    class="game-scripts-dialog__package-row-tail"
                                    data-tone={displayStatus().tone}
                                  >
                                    <span>{displayStatus().listLabel}</span>
                                    <Icon icon="chevron_right" size="sm" />
                                  </span>
                                </button>
                              );
                            }}
                          </Show>
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>
              </Show>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
      <AlertDialog
        initialFocusEl={() => confirmationCancelButton}
        open={confirmation() !== null}
        onOpenChange={(details) => {
          if (!details.open) closeConfirmation();
        }}
      >
        <AlertDialogContent
          class="game-scripts-dialog__confirmation-dialog"
          showCloseButton={false}
        >
          <Show when={confirmation()}>
            {(pending) => (
              <section class="game-scripts-dialog__confirmation">
                <div>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{pending().title}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {pending().description}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <Show when={error() !== ""}>
                    <Alert
                      class="game-scripts-dialog__confirmation-alert"
                      variant="error"
                    >
                      <AlertDescription>{error()}</AlertDescription>
                    </Alert>
                  </Show>
                  <AlertDialogFooter
                    class="game-scripts-dialog__confirmation-actions"
                    variant="bare"
                  >
                    <AlertDialogCancel
                      disabled={busy()}
                      ref={(element) => {
                        confirmationCancelButton = element;
                      }}
                      variant="outline"
                    >
                      Cancel
                    </AlertDialogCancel>
                    <Button
                      loading={busy()}
                      onClick={() => void runConfirmation()}
                      variant={
                        pending().destructive ? "destructive" : "default"
                      }
                    >
                      {pending().confirmLabel}
                    </Button>
                  </AlertDialogFooter>
                </div>
              </section>
            )}
          </Show>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
