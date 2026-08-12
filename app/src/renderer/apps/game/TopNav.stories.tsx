import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal, type JSX } from "solid-js";

import { DEFAULT_HOTKEYS } from "@lucent/core/hotkeys";
import type { AutoZoneSupportedMap } from "./automation/AutoZone";
import {
  TopNav,
  type GameTopNavMenu,
  type TopNavCombatProfile,
  type TopNavOptionItem,
} from "./TopNav";

interface TopNavFixture {
  readonly autoAttackEnabled?: boolean;
  readonly autoAttackLastError?: string;
  readonly autoReloginAttempting?: boolean;
  readonly autoReloginAttemptsRemaining?: number | null;
  readonly autoReloginEnabled?: boolean;
  readonly autoReloginLastError?: string;
  readonly autoReloginWaitingDelay?: boolean;
  readonly autoZoneEnabled?: boolean;
  readonly autoZoneMap?: AutoZoneSupportedMap;
  readonly gameLoaded?: boolean;
  readonly openMenu?: GameTopNavMenu | null;
  readonly playerReady?: boolean;
  readonly scriptLoaded?: boolean;
  readonly scriptOptionsReady?: boolean;
  readonly scriptRunning?: boolean;
  readonly scriptTogglePending?: boolean;
  readonly travelBusy?: boolean;
}

const profiles: readonly TopNavCombatProfile[] = [
  { id: "generic", label: "Generic", role: "Base" },
  {
    className: "Lord of Order",
    id: "support",
    label: "Party Support",
    role: "Support",
  },
  {
    className: "Dragon of Time",
    id: "dot-solo",
    label: "Dragon of Time Solo",
    role: "DPS",
  },
];

const optionFixtures = [
  ["infinite-range", "Infinite range", true],
  ["provoke-cell", "Provoke cell", false],
  ["enemy-magnet", "Enemy magnet", true],
  ["lag-killer", "Lag killer", false],
  ["hide-players", "Hide players", false],
  ["skip-cutscenes", "Skip cutscenes", true],
  ["anti-counter", "Anti-counter", false],
  ["animations", "Animations", true],
  ["collisions", "Collisions", false],
  ["death-ads", "Death ads", false],
] as const;

function TopNavStory(props: { readonly fixture: TopNavFixture }): JSX.Element {
  const fixture = props.fixture;
  const [openMenu, setOpenMenu] = createSignal<GameTopNavMenu | null>(
    fixture.openMenu ?? null,
  );
  const [walkSpeed, setWalkSpeed] = createSignal("8");
  const [frameRate, setFrameRate] = createSignal("30");
  const [customName, setCustomName] = createSignal("Lucent Preview");
  const [customGuild, setCustomGuild] = createSignal("Storybook");
  const [autoAttackPriority, setAutoAttackPriority] =
    createSignal("id:17, Darkon");
  const [autoReloginDelay, setAutoReloginDelay] = createSignal("5");
  const [autoAttackEnabled, setAutoAttackEnabled] = createSignal(
    fixture.autoAttackEnabled ?? true,
  );
  const [autoReloginEnabled, setAutoReloginEnabled] = createSignal(
    fixture.autoReloginEnabled ?? true,
  );
  const [autoReloginServer, setAutoReloginServer] = createSignal("Artix");
  const [autoZoneEnabled, setAutoZoneEnabled] = createSignal(
    fixture.autoZoneEnabled ?? true,
  );
  const [autoZoneMap, setAutoZoneMap] = createSignal<
    AutoZoneSupportedMap | undefined
  >(fixture.autoZoneMap ?? "astralshrine");
  const [scriptRunning, setScriptRunning] = createSignal(
    fixture.scriptRunning ?? true,
  );
  const [selectedProfileId, setSelectedProfileId] = createSignal("support");
  const [selectedCell, setSelectedCell] = createSignal("Boss");
  const [selectedPad, setSelectedPad] = createSignal("Spawn");
  const [optionItems, setOptionItems] = createSignal<
    readonly TopNavOptionItem[]
  >(
    optionFixtures.map(([id, label, checked]) => ({
      checked,
      id,
      label,
      onCheckedChange: (nextChecked) =>
        setOptionItems((current) =>
          current.map((item) =>
            item.id === id ? { ...item, checked: nextChecked } : item,
          ),
        ),
    })),
  );
  const selectedProfile = () =>
    profiles.find((profile) => profile.id === selectedProfileId()) ??
    profiles[0];

  return (
    <div class="game-app">
      <TopNav
        autoAttackConfiguredProfileLabel={() =>
          selectedProfile()?.label ?? "Generic"
        }
        autoAttackEnabled={autoAttackEnabled}
        autoAttackLastError={() => fixture.autoAttackLastError ?? ""}
        autoAttackProfileLabel={() => selectedProfile()?.label ?? "Generic"}
        autoAttackTargetPriority={autoAttackPriority}
        autoReloginAttempting={() => fixture.autoReloginAttempting ?? false}
        autoReloginAttemptsRemaining={() =>
          fixture.autoReloginAttemptsRemaining ?? null
        }
        autoReloginCaptured={() => true}
        autoReloginDelaySeconds={autoReloginDelay}
        autoReloginEnabled={autoReloginEnabled}
        autoReloginLastError={() => fixture.autoReloginLastError ?? ""}
        autoReloginServer={autoReloginServer}
        autoReloginServers={() => ["Artix", "Yorumi", "Safiria"]}
        autoReloginToggling={() => false}
        autoReloginWaitingDelay={() => fixture.autoReloginWaitingDelay ?? false}
        autoZoneEnabled={autoZoneEnabled}
        autoZoneMap={autoZoneMap}
        cells={() => ["Enter", "Boss", "Rewards"]}
        combatProfiles={() => profiles}
        customGuild={customGuild}
        customGuildConfigured={() => true}
        customName={customName}
        customNameConfigured={() => true}
        frameRate={frameRate}
        gameLoaded={() => fixture.gameLoaded ?? true}
        handleOpenBank={() => undefined}
        handleOpenWindow={() => undefined}
        handleRefreshAutoReloginServers={() => undefined}
        handleRefreshTravelOptions={() => undefined}
        handleResetCustomGuild={() => setCustomGuild("")}
        handleResetCustomName={() => setCustomName("")}
        handleSelectAutoAttackProfile={setSelectedProfileId}
        handleSelectAutoZoneMap={setAutoZoneMap}
        handleSelectAutoReloginServer={setAutoReloginServer}
        handleSelectCell={setSelectedCell}
        handleSelectPad={setSelectedPad}
        handleSetAutoReloginDelay={() => undefined}
        handleSetCustomGuild={() => undefined}
        handleSetCustomName={() => undefined}
        handleSetFrameRate={(rate) => setFrameRate(String(rate))}
        handleSetWalkSpeed={(speed) => setWalkSpeed(String(speed))}
        handleToggleAutoAttack={() =>
          setAutoAttackEnabled((current) => !current)
        }
        handleToggleAutoRelogin={() =>
          setAutoReloginEnabled((current) => !current)
        }
        handleToggleAutoZone={() => setAutoZoneEnabled((current) => !current)}
        hotkeyBindings={() => DEFAULT_HOTKEYS.bindings}
        hotkeyPlatform="mac"
        openMenu={openMenu}
        openScripts={() => undefined}
        optionItems={optionItems}
        pads={() => ["Spawn", "Left", "Right"]}
        playerReady={() => fixture.playerReady ?? true}
        scriptLoaded={() => fixture.scriptLoaded ?? true}
        scriptOptionsReady={() => fixture.scriptOptionsReady ?? true}
        scriptRunning={scriptRunning}
        scriptTogglePending={() => fixture.scriptTogglePending ?? false}
        selectedAutoAttackProfileId={selectedProfileId}
        selectedCell={selectedCell}
        selectedPad={selectedPad}
        setAutoAttackTargetPriority={setAutoAttackPriority}
        setAutoReloginDelaySeconds={setAutoReloginDelay}
        setCustomGuild={setCustomGuild}
        setCustomName={setCustomName}
        setFrameRate={setFrameRate}
        setOpenMenu={setOpenMenu}
        setWalkSpeed={setWalkSpeed}
        toggleScript={() => {
          setScriptRunning((current) => !current);
        }}
        travelBusy={() => fixture.travelBusy ?? false}
        validPads={() => ["Spawn", "Left"]}
        walkSpeed={walkSpeed}
      />
    </div>
  );
}

const meta = {
  args: { fixture: {} },
  component: TopNavStory,
  globals: {
    viewport: { isRotated: false, value: "game" },
  },
  title: "Game/TopNav",
} satisfies Meta<typeof TopNavStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RunningScript: Story = {};

export const GameNotReady: Story = {
  args: {
    fixture: {
      gameLoaded: false,
      playerReady: false,
      scriptLoaded: false,
      scriptOptionsReady: false,
      scriptRunning: false,
    },
  },
};

export const ScriptStarting: Story = {
  args: {
    fixture: {
      scriptLoaded: true,
      scriptOptionsReady: false,
      scriptRunning: false,
      scriptTogglePending: true,
    },
  },
};

export const AutoAttackFailure: Story = {
  args: {
    fixture: {
      autoAttackEnabled: false,
      autoAttackLastError: "Combat profile failed while resolving target 17.",
      openMenu: "combat",
    },
  },
};

export const AutoReloginReconnecting: Story = {
  args: {
    fixture: {
      autoReloginAttempting: true,
      autoReloginAttemptsRemaining: 1,
      openMenu: "relogin",
    },
  },
};

export const AutoReloginFailed: Story = {
  args: {
    fixture: {
      autoReloginEnabled: false,
      autoReloginLastError: "Artix rejected the saved login session.",
      openMenu: "relogin",
    },
  },
};

export const OptionsMenu: Story = {
  args: { fixture: { openMenu: "options" } },
};

export const TravelBusy: Story = {
  args: { fixture: { openMenu: "travel", travelBusy: true } },
};
