import type { Meta, StoryObj } from "storybook-solidjs-vite";

import type {
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

const meta = {
  args: {
    fixture: {
      launchServer: "Artix",
      selectedAccountUsernames: ["PrimaryHero", "LucentHealer"],
      serverPings,
      servers,
      state: populatedState,
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
          {
            currentUsername: "PrimaryHero",
            gameWindowId: 101,
            launchUsername: "PrimaryHero",
            message: "Farming Legion Tokens",
            scriptName: "Legion farm",
            status: "running",
            updatedAt: 5,
          },
          {
            gameWindowId: 102,
            launchUsername: "LucentHealer",
            message: "Loading the game client",
            scriptName: "Support loop",
            status: "starting",
            updatedAt: 4,
          },
          {
            currentUsername: "LoopTaunt",
            gameWindowId: 103,
            launchUsername: "LoopTaunt",
            message: "Script stopped after completing 12 cycles",
            scriptName: "Taunt loop",
            status: "stopped",
            updatedAt: 3,
          },
          {
            currentUsername: "DamageDealer",
            gameWindowId: 104,
            launchUsername: "DamageDealer",
            message: "Package dependency could not be resolved",
            scriptName: "Darkon DPS",
            status: "failed",
            updatedAt: 2,
          },
          {
            currentUsername: "VaultKeeper",
            gameWindowId: 105,
            launchUsername: "VaultKeeper",
            status: "idle",
            updatedAt: 1,
          },
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
