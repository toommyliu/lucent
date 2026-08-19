import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal, type JSX } from "solid-js";

import type { RoomPolicy } from "@lucent/core/accountSettings";
import type {
  ScriptCatalogEntry,
  ScriptCatalogOverview,
  ScriptPackageSummary,
  ScriptReference,
} from "@lucent/core/scriptPackages";
import type {
  ScriptQueueEntry,
  ScriptQueueRunItem,
  ScriptQueueState,
} from "./scripting/ScriptQueue";
import {
  ScriptsDialog,
  type PackageManagementView,
  type ScriptsDialogFixture,
  type ScriptsDialogTab,
} from "./ScriptsDialog";

const scripts: readonly ScriptCatalogEntry[] = [
  {
    name: "Legion token farm",
    packageName: "lucent-scripts",
    path: "/scripts/packages/lucent-scripts/farming/legion-tokens.js",
    reference: {
      kind: "package",
      packageName: "lucent-scripts",
      path: "farming/legion-tokens.js",
    },
    relativePath: "farming/legion-tokens.js",
  },
  {
    name: "Darkon receipts",
    packageName: "boss-automation",
    path: "/scripts/packages/boss-automation/darkon/receipts.js",
    reference: {
      kind: "package",
      packageName: "boss-automation",
      path: "darkon/receipts.js",
    },
    relativePath: "darkon/receipts.js",
  },
  {
    name: "Ultra speaker",
    packageName: "boss-automation",
    path: "/scripts/packages/boss-automation/ultras/speaker.js",
    reference: {
      kind: "package",
      packageName: "boss-automation",
      path: "ultras/speaker.js",
    },
    relativePath: "ultras/speaker.js",
  },
  {
    name: "Local experiment",
    path: "/scripts/local-experiment.js",
    reference: { kind: "loose", path: "local-experiment.js" },
    relativePath: "local-experiment.js",
  },
];

const packages: readonly ScriptPackageSummary[] = [
  {
    compatibility: {
      currentVersion: "0.8.2",
      requiredVersion: ">=0.8.0",
      status: "compatible",
    },
    description: "Battle-tested farming and utility scripts.",
    integrity: "verified",
    name: "lucent-scripts",
    path: "/scripts/packages/lucent-scripts",
    source: {
      repositoryUrl: "https://github.com/example/lucent-scripts",
      resolvedCommit: "3bd26da74fb17b39d48ea878b751b077f26c6c77",
    },
    status: "valid",
    update: {
      checkedAt: "2026-08-11T19:42:00.000Z",
      commit: "5c328e31dc30c5778d638f2fd6043a8fac58e078",
      status: "available",
    },
    version: "2.3.1",
  },
  {
    compatibility: {
      currentVersion: "0.8.2",
      requiredVersion: ">=0.8.0",
      status: "compatible",
    },
    description: "Coordinated ultra boss encounters.",
    integrity: "modified",
    name: "boss-automation",
    path: "/scripts/packages/boss-automation",
    source: {
      repositoryUrl: "https://github.com/example/boss-automation",
      requestedRef: "main",
      resolvedCommit: "446b5aca42c76f0b75d5b83085c27e7c82f0f965",
    },
    status: "valid",
    update: { status: "unchecked" },
    version: "1.9.0",
    warning: "Local files differ from the installed package revision.",
  },
  {
    compatibility: {
      currentVersion: "0.8.2",
      requiredVersion: ">=1.0.0",
      status: "incompatible",
    },
    integrity: "verified",
    name: "future-package",
    path: "/scripts/packages/future-package",
    source: {
      repositoryUrl: "https://github.com/example/future-package",
      resolvedCommit: "c45b095ea2151d8d1406a1c121bec8d6db5e9a35",
    },
    status: "valid",
    update: {
      message: "GitHub API rate limit exceeded.",
      retryAt: "2099-08-11T20:00:00.000Z",
      status: "rate-limited",
    },
  },
  {
    diagnostic:
      "package.yml could not be parsed: expected a package name on line 3.",
    name: "broken-package",
    path: "/scripts/packages/broken-package",
    status: "invalid",
  },
];

const additionalAlertPackages: readonly ScriptPackageSummary[] = [
  {
    compatibility: {
      currentVersion: "0.8.2",
      requiredVersion: ">=0.8.0",
      status: "compatible",
    },
    integrity: "modified",
    name: "modified-update-package",
    path: "/scripts/packages/modified-update-package",
    source: {
      repositoryUrl: "https://github.com/example/modified-update-package",
      resolvedCommit: "adf65f20afc497b45d97fb3d3f8bb7dd1a5d427b",
    },
    status: "valid",
    update: {
      checkedAt: "2026-08-11T20:00:00.000Z",
      commit: "6fa6b3f8f5b64224845aa706818adb2f014d791a",
      status: "available",
    },
  },
  {
    compatibility: {
      currentVersion: "0.8.2",
      requiredVersion: ">=0.8.0",
      status: "compatible",
    },
    integrity: "unmanaged",
    name: "unmanaged-package",
    path: "/scripts/packages/unmanaged-package",
    status: "valid",
    update: { status: "unchecked" },
  },
  {
    compatibility: {
      currentVersion: "0.8.2",
      status: "unknown",
      warning: "package.yml does not declare a Lucent version range.",
    },
    integrity: "verified",
    name: "unknown-compatibility-package",
    path: "/scripts/packages/unknown-compatibility-package",
    source: {
      repositoryUrl: "https://github.com/example/unknown-compatibility-package",
      resolvedCommit: "7965d355eb0291e0b96e390f7f8fb83553a45d89",
    },
    status: "valid",
    update: { status: "unchecked" },
  },
  {
    compatibility: {
      currentVersion: "0.8.2",
      requiredVersion: ">=0.8.0",
      status: "compatible",
    },
    integrity: "verified",
    name: "warning-package",
    path: "/scripts/packages/warning-package",
    source: {
      repositoryUrl: "https://github.com/example/warning-package",
      resolvedCommit: "b9c09d2b5eb8cfc51631ffc4f91efeab72e4450d",
    },
    status: "valid",
    update: {
      checkedAt: "2026-08-11T20:00:00.000Z",
      status: "current",
    },
    warning: "The package manifest uses a deprecated field.",
  },
  {
    compatibility: {
      currentVersion: "0.8.2",
      requiredVersion: ">=0.8.0",
      status: "compatible",
    },
    integrity: "verified",
    name: "rate-limited-package",
    path: "/scripts/packages/rate-limited-package",
    source: {
      repositoryUrl: "https://github.com/example/rate-limited-package",
      resolvedCommit: "4e60e4ba135b30943ec3e65b005486605ee3d92d",
    },
    status: "valid",
    update: {
      message: "GitHub API rate limit exceeded.",
      retryAt: "2099-08-11T20:00:00.000Z",
      status: "rate-limited",
    },
  },
  {
    compatibility: {
      currentVersion: "0.8.2",
      requiredVersion: ">=0.8.0",
      status: "compatible",
    },
    integrity: "verified",
    name: "check-failed-package",
    path: "/scripts/packages/check-failed-package",
    source: {
      repositoryUrl: "https://github.com/example/check-failed-package",
      resolvedCommit: "a77cde7da0ade671e33c58b050d0f6f5aff09864",
    },
    status: "valid",
    update: {
      checkedAt: "2026-08-11T20:00:00.000Z",
      message: "The remote Git ref could not be resolved.",
      status: "unknown",
    },
  },
];

const catalog: ScriptCatalogOverview = {
  packages: [...packages, ...additionalAlertPackages],
  revision: "storybook-catalog-v1",
  scriptCount: scripts.length,
};

const queueEntries: readonly ScriptQueueEntry[] = scripts
  .slice(0, 3)
  .map((script, index) => ({
    file: {
      name: script.name,
      path: script.path,
      reference: script.reference,
    },
    id: `queue-entry-${index + 1}`,
    inputValues: {},
  }));

const readyQueueState: ScriptQueueState = {
  currentIndex: null,
  entries: queueEntries,
  latestRun: null,
  phase: "idle",
};

const pausedQueueItem = (
  entry: ScriptQueueEntry,
  index: number,
): ScriptQueueRunItem => ({
  file: {
    ...entry.file,
    inputs: null,
    revision: `story-revision-${index + 1}`,
    source: "export function* main() {}",
  },
  inputValues: entry.inputValues,
  ...(index === 0
    ? {
        durationMs: 12_340,
        result: {
          kind: "failed",
          status: {
            failedAt: "2026-08-17T19:42:12.340Z",
            message: "The target map could not be reached.",
            name: entry.file.name,
            path: entry.file.path,
            state: "failed",
          },
        },
        state: "finished",
      }
    : { state: "pending" }),
});

const pausedQueueState: ScriptQueueState = {
  currentIndex: 0,
  entries: queueEntries,
  latestRun: {
    items: queueEntries.map(pausedQueueItem),
    status: "paused",
  },
  phase: "paused",
};

interface ScriptsDialogStoryFixture {
  readonly activeTab?: ScriptsDialogTab;
  readonly catalog?: ScriptCatalogOverview;
  readonly catalogLoading?: boolean;
  readonly confirmation?: ScriptsDialogFixture["confirmation"];
  readonly error?: string;
  readonly errorRetryable?: boolean;
  readonly inputsAvailable?: boolean;
  readonly loadedReference?: ScriptReference;
  readonly optionsReady?: boolean;
  readonly packageManagementView?: PackageManagementView;
  readonly queueState?: ScriptQueueState;
  readonly roomNumberDraft?: string;
  readonly roomNumberError?: string;
  readonly scriptBusy?: boolean;
  readonly scriptLoaded?: boolean;
  readonly scriptRunning?: boolean;
  readonly scripts?: readonly ScriptCatalogEntry[];
  readonly scriptStatus?: string;
  readonly selectedPackagePath?: string;
}

function ScriptsDialogStory(props: {
  readonly fixture: ScriptsDialogStoryFixture;
}): JSX.Element {
  const fixture = props.fixture;
  const [open, setOpen] = createSignal(true);
  const [roomNumberDraft, setRoomNumberDraft] = createSignal(
    fixture.roomNumberDraft ?? "4821",
  );
  const [loadedReference, setLoadedReference] = createSignal<
    ScriptReference | undefined
  >(fixture.loadedReference ?? scripts[0]?.reference);
  const [restartAfterReconnect, setRestartAfterReconnect] = createSignal(true);
  const [roomPolicy, setRoomPolicy] = createSignal<RoomPolicy>({
    kind: "specific",
    roomNumber: 4821,
  });
  const [safeStartStop, setSafeStartStop] = createSignal(true);
  const [scriptLoaded, setScriptLoaded] = createSignal(
    fixture.scriptLoaded ?? true,
  );
  const [scriptRunning, setScriptRunning] = createSignal(
    fixture.scriptRunning ?? false,
  );
  const [queueState] = createSignal<ScriptQueueState>({
    ...(fixture.queueState ?? {
      currentIndex: null,
      entries: [],
      latestRun: null,
      phase: "idle" as const,
    }),
  });
  const selectedScriptName = () =>
    scripts.find(
      (entry) =>
        JSON.stringify(entry.reference) === JSON.stringify(loadedReference()),
    )?.name ?? "Selected script";

  return (
    <div class="game-app">
      <ScriptsDialog
        fixture={{
          activeTab: fixture.activeTab ?? "scripts",
          catalog: fixture.catalog ?? catalog,
          catalogLoading: fixture.catalogLoading,
          confirmation: fixture.confirmation,
          credentials: [
            { id: "github-primary", label: "Personal GitHub token" },
          ],
          error: fixture.error,
          errorRetryable: fixture.errorRetryable,
          packageManagementView: fixture.packageManagementView,
          scripts: fixture.scripts ?? scripts,
          selectedPackagePath: fixture.selectedPackagePath,
        }}
        inputsAvailable={fixture.inputsAvailable ?? true}
        loadedReference={loadedReference()}
        onChooseFile={() => Promise.resolve()}
        onCommitRoomNumber={() => {
          const roomNumber = Number.parseInt(roomNumberDraft(), 10);
          if (Number.isSafeInteger(roomNumber)) {
            setRoomPolicy({ kind: "specific", roomNumber });
          }
        }}
        onCopyText={() => Promise.resolve()}
        onEditInputs={() => undefined}
        onEnqueueScript={() => Promise.resolve(true)}
        onOpenChange={setOpen}
        onQueueEditInputs={() => Promise.resolve(true)}
        onQueueMove={() => undefined}
        onQueueRemove={() => undefined}
        onQueueRunNext={() => undefined}
        onQueueStart={() => Promise.resolve(true)}
        onQueueStop={() => Promise.resolve()}
        onSelectRoomPolicy={setRoomPolicy}
        onSelectScript={(reference, start) => {
          setLoadedReference(reference);
          setScriptLoaded(true);
          setScriptRunning(start);
          return Promise.resolve();
        }}
        onSetRoomNumberDraft={setRoomNumberDraft}
        onToggleRestartAfterReconnect={() =>
          setRestartAfterReconnect((current) => !current)
        }
        onToggleSafeStartStop={() => setSafeStartStop((current) => !current)}
        onToggleScript={() => {
          setScriptRunning((current) => !current);
        }}
        open={open()}
        optionsReady={fixture.optionsReady ?? true}
        queueState={queueState()}
        restartAfterReconnect={restartAfterReconnect()}
        roomNumberDraft={roomNumberDraft()}
        roomNumberError={fixture.roomNumberError ?? ""}
        roomPolicy={roomPolicy()}
        safeStartStop={safeStartStop()}
        scriptBusy={fixture.scriptBusy ?? false}
        scriptLoaded={scriptLoaded()}
        scriptRunning={scriptRunning()}
        scriptStatus={
          fixture.scriptStatus ??
          `${selectedScriptName()} is ${scriptRunning() ? "running" : "loaded"}`
        }
      />
    </div>
  );
}

const packageAlertFixture = (
  selectedPackagePath: string,
): ScriptsDialogStoryFixture => ({
  activeTab: "packages",
  catalog,
  packageManagementView: "details",
  selectedPackagePath,
});

const meta = {
  args: { fixture: {} },
  component: ScriptsDialogStory,
  globals: {
    viewport: { isRotated: false, value: "game" },
  },
  title: "Game/ScriptsDialog",
} satisfies Meta<typeof ScriptsDialogStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ScriptCatalog: Story = {};

export const QueueReady: Story = {
  args: {
    fixture: {
      activeTab: "queue",
      queueState: readyQueueState,
    },
  },
};

export const QueuePausedAfterFailure: Story = {
  args: {
    fixture: {
      activeTab: "queue",
      queueState: pausedQueueState,
      scriptRunning: true,
    },
  },
};

export const CatalogLoading: Story = {
  args: {
    fixture: {
      catalog: { packages: [], revision: "", scriptCount: 0 },
      catalogLoading: true,
      scripts: [],
    },
  },
};

export const EmptyCatalog: Story = {
  args: {
    fixture: {
      catalog: { packages: [], revision: "empty", scriptCount: 0 },
      scripts: [],
    },
  },
};

export const ScriptCatalogError: Story = {
  args: {
    fixture: {
      error:
        "Failed to load the script catalog: package metadata is unreadable.",
      errorRetryable: true,
    },
  },
};

export const RunningScriptReplacement: Story = {
  args: {
    fixture: {
      loadedReference: scripts[0]!.reference,
      scriptRunning: true,
      scriptStatus: "Legion token farm is running in /darkally",
    },
  },
};

export const OptionsUnavailable: Story = {
  args: {
    fixture: {
      activeTab: "options",
      inputsAvailable: false,
      optionsReady: false,
      roomNumberDraft: "100000",
      roomNumberError: "Enter a room number from 1 to 99,999.",
      scriptBusy: true,
    },
  },
};

export const PackageStatesAndErrors: Story = {
  args: {
    fixture: {
      activeTab: "packages",
      catalog,
      packageManagementView: "installed",
    },
  },
};

export const UpdateAvailablePackageAlert: Story = {
  args: {
    fixture: packageAlertFixture("/scripts/packages/lucent-scripts"),
  },
};

export const ModifiedPackageAlert: Story = {
  args: {
    fixture: packageAlertFixture("/scripts/packages/boss-automation"),
  },
};

export const ModifiedPackageWithUpdateAlert: Story = {
  args: {
    fixture: packageAlertFixture("/scripts/packages/modified-update-package"),
  },
};

export const IncompatiblePackageAlert: Story = {
  args: {
    fixture: packageAlertFixture("/scripts/packages/future-package"),
  },
};

export const InvalidPackageAlert: Story = {
  args: {
    fixture: packageAlertFixture("/scripts/packages/broken-package"),
  },
};

export const UnmanagedPackageAlert: Story = {
  args: {
    fixture: packageAlertFixture("/scripts/packages/unmanaged-package"),
  },
};

export const CompatibilityUnknownPackageAlert: Story = {
  args: {
    fixture: packageAlertFixture(
      "/scripts/packages/unknown-compatibility-package",
    ),
  },
};

export const PackageWarningAlert: Story = {
  args: {
    fixture: packageAlertFixture("/scripts/packages/warning-package"),
  },
};

export const RateLimitedPackageAlert: Story = {
  args: {
    fixture: packageAlertFixture("/scripts/packages/rate-limited-package"),
  },
};

export const PackageCheckFailedAlert: Story = {
  args: {
    fixture: packageAlertFixture("/scripts/packages/check-failed-package"),
  },
};

export const PackageOperationError: Story = {
  args: {
    fixture: {
      activeTab: "packages",
      error:
        "Failed to update boss-automation: local changes could not be reconciled.",
      packageManagementView: "installed",
    },
  },
};

export const ConfirmationOperationError: Story = {
  args: {
    fixture: {
      activeTab: "packages",
      confirmation: {
        confirmLabel: "Replace package",
        description:
          "Replace the existing package folder with the selected Git ref?",
        destructive: true,
        error: "The existing package folder could not be replaced.",
        title: "Replace the existing package?",
      },
      packageManagementView: "installed",
    },
  },
};

export const InstallPackage: Story = {
  args: {
    fixture: {
      activeTab: "packages",
      packageManagementView: "install",
    },
  },
};
