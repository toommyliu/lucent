import type { Meta, StoryObj } from "storybook-solidjs-vite";

import type {
  AccountGameSession,
  AccountGameServer,
  AccountGameServerPing,
  AccountManagerState,
} from "@lucent/core/accounts";
import { AccountManagerView } from "./App";

const emptyState: AccountManagerState = {
  accounts: [],
  groups: {},
  sessions: [],
  storagePath: "/fixture-data/Lucent/accounts.json",
};

const populatedState: AccountManagerState = {
  accounts: [
    { label: "Main", password: "secret", username: "PrimaryHero" },
    { label: "Support", password: "secret", username: "LucentHealer" },
    { label: "Taunter", password: "secret", username: "LoopTaunt" },
    { label: "DPS", password: "secret", username: "DamageDealer" },
    { label: "Bank alt", password: "secret", username: "VaultKeeper" },
  ],
  groups: {
    "Darkon team": ["PrimaryHero", "LucentHealer", "LoopTaunt", "DamageDealer"],
    Farming: ["PrimaryHero", "VaultKeeper"],
  },
  sessions: [],
  storagePath: "/fixture-data/Lucent/accounts.json",
};

const servers: readonly AccountGameServer[] = [
  {
    language: "en",
    maxPlayers: 1500,
    name: "Artix",
    online: true,
    playerCount: 1498,
    upgrade: false,
  },
  {
    language: "en",
    maxPlayers: 1000,
    name: "Yorumi",
    online: true,
    playerCount: 721,
    upgrade: false,
  },
  {
    language: "en",
    maxPlayers: 1000,
    name: "Safiria",
    online: true,
    playerCount: 1000,
    upgrade: false,
  },
  {
    language: "pt",
    maxPlayers: 1000,
    name: "Espada",
    online: false,
    playerCount: 0,
    upgrade: false,
  },
  {
    language: "en",
    maxPlayers: 250,
    name: "TestingServer",
    online: true,
    playerCount: 247,
    upgrade: true,
  },
];

const serverPings: readonly AccountGameServerPing[] = [
  { latencyMs: 42, serverName: "Artix", status: "ok" },
  { latencyMs: 143, serverName: "Yorumi", status: "ok" },
  { serverName: "Safiria", status: "timeout" },
  { serverName: "Espada", status: "offline" },
  { serverName: "TestingServer", status: "unreachable" },
];

const storySession = (
  gameWindowId: number,
  username: string,
  scriptName: string | undefined,
  script: AccountGameSession["script"],
): AccountGameSession => ({
  connection: { state: "online", username },
  gameWindowId,
  launch: {
    ...(scriptName === undefined
      ? {}
      : { script: { name: scriptName, path: `/scripts/${scriptName}` } }),
    requestedAt: gameWindowId,
    username,
  },
  login: { state: "idle" },
  rendererGeneration: 1,
  revision: gameWindowId,
  script,
  updatedAt: gameWindowId,
});

const meta = {
  args: {
    fixture: {
      launchServer: "Artix",
      selectedAccountUsernames: ["PrimaryHero", "LucentHealer"],
      serverPings,
      servers,
      state: populatedState,
      useGameTabs: true,
    },
    platform: "mac",
  },
  component: AccountManagerView,
  globals: {
    viewport: { isRotated: false, value: "accountManager" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "The production Account Manager rendered from account, session, and server fixtures without an Electron bridge.",
      },
    },
  },
  title: "Renderers/Account Manager",
} satisfies Meta<typeof AccountManagerView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LaunchSelection: Story = {};

export const Loading: Story = {
  args: {
    fixture: {
      initialLoadingVisible: true,
      state: emptyState,
      stateLoaded: false,
    },
  },
};

export const Empty: Story = {
  args: { fixture: { state: emptyState } },
};

export const NoSearchResults: Story = {
  args: {
    fixture: {
      searchQuery: "missing account",
      state: populatedState,
    },
  },
};

export const ServerAndScriptErrors: Story = {
  args: {
    fixture: {
      scriptError: "The selected script could not be parsed at line 18.",
      serverError: "Server status is temporarily unavailable.",
      state: populatedState,
    },
  },
};

export const AccountSaveError: Story = {
  args: {
    fixture: {
      dialog: {
        account: populatedState.accounts[0]!,
        error: "An account with that username already exists.",
        mode: "edit",
      },
      state: populatedState,
    },
  },
};

export const GroupRenameError: Story = {
  args: {
    fixture: {
      groupDialog: {
        error: "A saved group with that name already exists.",
        name: "Darkon team",
      },
      state: populatedState,
    },
  },
};

export const GroupDeleteError: Story = {
  args: {
    fixture: {
      groupDeleteDialog: {
        error: "The group changed on disk and could not be removed.",
        name: "Darkon team",
      },
      state: populatedState,
    },
  },
};

export const MixedSessionStatuses: Story = {
  args: {
    fixture: {
      activeTab: "sessions",
      state: {
        ...populatedState,
        sessions: [
          storySession(101, "PrimaryHero", "Legion farm", {
            message: "Farming Legion Tokens",
            name: "Legion farm",
            state: "running",
          }),
          storySession(102, "LucentHealer", "Support loop", {
            message: "Loading the game client",
            name: "Support loop",
            state: "starting",
          }),
          storySession(103, "LoopTaunt", "Taunt loop", {
            name: "Taunt loop",
            reason: "Script stopped after completing 12 cycles",
            state: "stopped",
          }),
          storySession(104, "DamageDealer", "Darkon DPS", {
            message: "Package dependency could not be resolved",
            name: "Darkon DPS",
            state: "failed",
          }),
          storySession(105, "VaultKeeper", undefined, { state: "idle" }),
        ],
      },
    },
  },
};

export const ServerAvailabilityAndPingFailures: Story = {
  args: {
    fixture: {
      launchServer: "Artix",
      selectedAccountUsernames: [
        "PrimaryHero",
        "LucentHealer",
        "LoopTaunt",
        "DamageDealer",
      ],
      serverComboboxOpen: true,
      serverPings,
      servers,
      state: populatedState,
    },
  },
};

export const ServerPingsLoading: Story = {
  args: {
    fixture: {
      serverComboboxOpen: true,
      serverPingsLoading: true,
      servers,
      state: populatedState,
    },
  },
};
