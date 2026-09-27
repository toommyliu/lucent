import {
  Alert,
  AlertAction,
  AlertDescription,
  Button,
  Checkbox,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  HelpTooltip,
  Icon,
  IconButton,
  Input,
  Select,
  SelectItem,
  SelectTrigger,
  Switch,
  TooltipButton,
  TooltipButtonContent,
  TooltipButtonTrigger,
  TooltipIconButton,
  VirtualizedSelectContent,
  cn,
} from "@lucent/ui";
import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type JSX,
} from "solid-js";
import {
  DEFAULT_COMBAT_PROFILE_ID,
  DEFAULT_COMBAT_PROFILE_LIBRARY,
  type CombatProfileLibrary,
} from "@lucent/core/combatProfiles";
import {
  DEFAULT_FOLLOWER_ATTEMPTS,
  DEFAULT_FOLLOWER_COMBAT_ENABLED,
  DEFAULT_FOLLOWER_COPY_WALK,
  DEFAULT_FOLLOWER_RETRY_ENABLED,
  MAX_FOLLOWER_ATTEMPTS,
  createIdleFollowerState,
  normalizeFollowerConfig,
  parseFollowerAttackPriority,
  parseFollowerLocationFallbacks,
  type FollowerConfig,
  type FollowerStartPayload,
  type FollowerState,
} from "@lucent/core/follower";
import {
  readLocalStorageValue,
  writeLocalStorageValue,
} from "../../localStorage";
import {
  buildCombatProfileOptions,
  resolveCombatProfileOptionValue,
  type CombatProfileOption,
} from "../../combatProfileOptions";
import { filterPlayerRoster, observePlayerRoster } from "./playerRoster";
import { reconcileFollowerCombatProfileId } from "./profileSelection";
import { parseMonsterMapId } from "@lucent/game";
import { selectDesktopBridge } from "../../../shared/desktopBridge";

const selectedProfileStorageKey = "lucent.follower.selectedProfileId";

export interface FollowerViewFixture {
  readonly config?: FollowerConfig | null;
  readonly error?: string;
  readonly library: CombatProfileLibrary;
  readonly players?: readonly string[];
  readonly state: FollowerState;
}

export interface FollowerViewCallbacks {
  readonly configure?: (
    configuration: FollowerStartPayload,
  ) => Promise<FollowerState>;
  readonly getConfig?: () => Promise<FollowerConfig | null>;
  readonly getLibrary?: () => Promise<CombatProfileLibrary>;
  readonly getPlayers?: () => Promise<readonly string[]>;
  readonly getState?: () => Promise<FollowerState>;
  readonly me?: () => Promise<string>;
  readonly onFollowerChanged?: (
    listener: (state: FollowerState) => void,
  ) => () => void;
  readonly onLibraryChanged?: (
    listener: (library: CombatProfileLibrary) => void,
  ) => () => void;
  readonly onPlayersChanged?: (
    listener: (players: readonly string[]) => void,
  ) => () => void;
  readonly openCombatProfiles?: () => Promise<void>;
  readonly start?: (
    configuration: FollowerStartPayload,
  ) => Promise<FollowerState>;
  readonly stop?: () => Promise<FollowerState>;
}

export interface FollowerViewProps {
  readonly callbacks?: FollowerViewCallbacks;
  readonly fixture: FollowerViewFixture;
}

type AttackTarget = number | string;

const loadFailureMessages = {
  config: "Failed to load follower configuration",
  state: "Failed to load follower state",
  library: "Failed to load combat profiles",
};
type FollowerLoadSource = keyof typeof loadFailureMessages;

const errorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback;

const configurationKey = (configuration: FollowerStartPayload): string =>
  JSON.stringify(normalizeFollowerConfig(configuration));

function createFollowerController(props: FollowerViewProps) {
  const initialConfig = props.fixture.config ?? null;
  const [state, setState] = createSignal<FollowerState>(props.fixture.state);
  const [library, setLibrary] = createSignal<CombatProfileLibrary>(
    props.fixture.library,
  );
  const [targetName, setTargetName] = createSignal(
    initialConfig?.targetName ?? "",
  );
  const [players, setPlayers] = createSignal<readonly string[]>(
    props.fixture.players ?? [],
  );
  const [combatEnabled, setCombatEnabled] = createSignal(
    initialConfig?.combatEnabled ?? DEFAULT_FOLLOWER_COMBAT_ENABLED,
  );
  const [copyWalk, setCopyWalk] = createSignal(
    initialConfig?.copyWalk ?? DEFAULT_FOLLOWER_COPY_WALK,
  );
  const [retryEnabled, setRetryEnabled] = createSignal(
    initialConfig?.retryEnabled ?? DEFAULT_FOLLOWER_RETRY_ENABLED,
  );
  const [attemptLimit, setAttemptLimit] = createSignal(
    initialConfig?.maxAttempts ?? DEFAULT_FOLLOWER_ATTEMPTS,
  );
  const [attemptDraft, setAttemptDraft] = createSignal(String(attemptLimit()));
  const [unlimitedAttempts, setUnlimitedAttempts] = createSignal(
    initialConfig?.maxAttempts === null,
  );
  const [selectedProfileId, setSelectedProfileId] = createSignal(
    initialConfig?.selectedProfileId ??
      readLocalStorageValue(selectedProfileStorageKey) ??
      DEFAULT_COMBAT_PROFILE_ID,
  );
  const [attackPriority, setAttackPriority] = createSignal<
    readonly AttackTarget[]
  >(initialConfig?.attackPriority ?? []);
  const [lockedZoneFallbacks, setLockedZoneFallbacks] = createSignal<
    readonly string[]
  >(initialConfig?.lockedZoneFallbacks ?? []);
  const [lockedZoneRoomOverride, setLockedZoneRoomOverride] = createSignal(
    initialConfig?.lockedZoneRoomOverride ?? "",
  );
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal(props.fixture.error ?? "");
  const [loadErrors, setLoadErrors] = createSignal<
    Record<FollowerLoadSource, string>
  >({ config: "", state: "", library: "" });
  const [hydrated, setHydrated] = createSignal(
    props.callbacks?.getConfig === undefined &&
      props.callbacks?.getState === undefined &&
      props.callbacks?.getLibrary === undefined,
  );
  const [loadingConfig, setLoadingConfig] = createSignal(false);
  const configReady = createMemo(
    () => hydrated() && loadErrors().config === "",
  );
  let syncedConfigurationKey = "";
  let configurationRevision = 0;
  let disposed = false;

  const clearLoadError = (source: FollowerLoadSource): void => {
    setLoadErrors((current) =>
      current[source] === "" ? current : { ...current, [source]: "" },
    );
  };

  const running = createMemo(() => state().enabled || state().running);
  const settingsDisabled = createMemo(() => running() || !configReady());
  const profileOptions = createMemo(() => {
    const profiles = library().profiles;
    const generic = profiles.find(
      (profile) => profile.id === DEFAULT_COMBAT_PROFILE_ID,
    );
    const rest = profiles.filter(
      (profile) => profile.id !== DEFAULT_COMBAT_PROFILE_ID,
    );
    return generic ? [generic, ...rest] : rest;
  });
  const [groupProfiles, setGroupProfiles] = createSignal(false);
  const [selectedProfileOptionValue, setSelectedProfileOptionValue] =
    createSignal("");
  const profileSelectItems = createMemo(() =>
    buildCombatProfileOptions(profileOptions(), groupProfiles()),
  );
  const profileSelectValue = createMemo(() =>
    resolveCombatProfileOptionValue(
      profileSelectItems(),
      selectedProfileId(),
      selectedProfileOptionValue(),
    ),
  );
  const filteredPlayers = createMemo(() =>
    filterPlayerRoster(players(), targetName()),
  );
  const playerItems = createMemo(() =>
    filteredPlayers().map((player) => ({ label: player, value: player })),
  );
  const selectedPlayerValue = createMemo(() => {
    const target = targetName().trim();
    const selected = players().find(
      (player) =>
        player.localeCompare(target, undefined, { sensitivity: "accent" }) ===
        0,
    );
    return selected === undefined ? [] : [selected];
  });
  const selectedProfileLabel = createMemo(
    () =>
      profileOptions().find((profile) => profile.id === selectedProfileId())
        ?.label ??
      selectedProfileId() ??
      "",
  );
  const exhaustedFollowerAttempts = createMemo(() => {
    const current = state();
    return (
      !current.enabled &&
      !current.running &&
      current.attemptsRemaining === 0 &&
      current.stoppedReason !== "Stopped by user"
    );
  });
  const errorIssueMessage = createMemo(() => {
    const current = state();
    const followerMessages = exhaustedFollowerAttempts()
      ? [current.stoppedReason ?? "", current.lastError ?? ""]
      : [];
    const messages = [
      ...Object.values(loadErrors()),
      error(),
      ...followerMessages,
    ].filter(Boolean);
    return [...new Set(messages)].join(" - ");
  });
  const issueMessage = createMemo(
    () => errorIssueMessage() || state().warning || "",
  );
  const issueVariant = createMemo(() =>
    errorIssueMessage() === "" ? "warning" : "error",
  );
  const showIssue = createMemo(() => issueMessage() !== "");
  const attemptsInvalid = createMemo(
    () =>
      retryEnabled() &&
      !unlimitedAttempts() &&
      parseAttempts(attemptDraft()) === undefined,
  );
  const canToggle = createMemo(
    () =>
      !busy() &&
      (running() ||
        (configReady() && targetName().trim() !== "" && !attemptsInvalid())),
  );

  const readConfiguration = (): FollowerStartPayload => ({
    targetName: targetName(),
    combatEnabled: combatEnabled(),
    copyWalk: copyWalk(),
    retryEnabled: retryEnabled(),
    maxAttempts: unlimitedAttempts() ? null : attemptLimit(),
    selectedProfileId: selectedProfileId(),
    attackPriority: attackPriority(),
    lockedZoneFallbacks: lockedZoneFallbacks(),
    lockedZoneRoomOverride: lockedZoneRoomOverride(),
  });

  createEffect(() => {
    const configuration = readConfiguration();
    const key = configurationKey(configuration);
    if (!configReady() || key === syncedConfigurationKey) {
      return;
    }
    syncedConfigurationKey = key;

    const revision = ++configurationRevision;
    const update = props.callbacks?.configure?.(configuration);
    if (update === undefined) {
      return;
    }

    void update.catch((cause: unknown) => {
      console.error("Failed to sync follower configuration:", cause);
      if (!disposed && revision === configurationRevision) {
        setError(errorMessage(cause, "Failed to sync follower configuration"));
      }
    });
  });

  onCleanup(() => {
    disposed = true;
  });

  const selectProfile = (profileId: string): void => {
    setSelectedProfileId(profileId);
    writeLocalStorageValue(selectedProfileStorageKey, profileId);
  };

  const applyLibrary = (nextLibrary: CombatProfileLibrary): void => {
    clearLoadError("library");
    setLibrary(nextLibrary);
    const nextProfileId = reconcileFollowerCombatProfileId(
      nextLibrary,
      selectedProfileId(),
    );
    if (nextProfileId !== selectedProfileId()) {
      selectProfile(nextProfileId);
    }
  };

  const applyFollowerState = (nextState: FollowerState): void => {
    clearLoadError("state");
    setState(nextState);
    if (targetName().trim() === "" && nextState.targetName.trim() !== "") {
      setTargetName(nextState.targetName);
    }
    if (
      nextState.enabled ||
      nextState.running ||
      (nextState.phase === "idle" && nextState.lastError === undefined)
    ) {
      setError("");
    }
  };

  const applyFollowerConfig = (config: FollowerConfig | null): void => {
    clearLoadError("config");
    if (config === null) {
      return;
    }

    batch(() => {
      setTargetName(config.targetName || state().targetName);
      setCombatEnabled(config.combatEnabled);
      setCopyWalk(config.copyWalk);
      setRetryEnabled(config.retryEnabled);
      setUnlimitedAttempts(config.maxAttempts === null);
      if (config.maxAttempts !== null) {
        setAttemptLimit(config.maxAttempts);
        setAttemptDraft(String(config.maxAttempts));
      }
      setSelectedProfileId(config.selectedProfileId);
      setAttackPriority(config.attackPriority);
      setLockedZoneFallbacks(config.lockedZoneFallbacks);
      setLockedZoneRoomOverride(config.lockedZoneRoomOverride);
    });
  };

  const retryConfig = async (): Promise<void> => {
    const getConfig = props.callbacks?.getConfig;
    if (getConfig === undefined || loadingConfig()) {
      return;
    }

    setLoadingConfig(true);
    try {
      const config = await getConfig();
      if (disposed) {
        return;
      }
      batch(() => {
        applyFollowerConfig(config);
        if (loadErrors().library === "") {
          applyLibrary(library());
        }
        syncedConfigurationKey = configurationKey(readConfiguration());
      });
    } catch (cause) {
      console.error("Failed to load follower configuration:", cause);
    } finally {
      if (!disposed) {
        setLoadingConfig(false);
      }
    }
  };

  const fillMe = async (): Promise<void> => {
    setError("");
    try {
      const me = await (props.callbacks?.me?.() ?? Promise.resolve(""));
      if (me.trim()) {
        setTargetName(me);
      }
    } catch (cause) {
      console.error("Failed to resolve current player:", cause);
      setError(errorMessage(cause, "Failed to get player"));
    }
  };

  const openCombatProfiles = async (): Promise<void> => {
    setError("");
    try {
      await props.callbacks?.openCombatProfiles?.();
    } catch (cause) {
      console.error("Failed to open combat profiles:", cause);
      setError(errorMessage(cause, "Failed to open combat profiles"));
    }
  };

  const start = async (): Promise<void> => {
    const trimmedTarget = targetName().trim();
    if (!configReady() || !trimmedTarget || attemptsInvalid() || busy()) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const nextState = await (props.callbacks?.start?.({
        ...readConfiguration(),
        targetName: trimmedTarget,
      }) ?? Promise.resolve(state()));
      applyFollowerState(nextState);
    } catch (cause) {
      console.error("Failed to start follower:", cause);
      setError(errorMessage(cause, "Failed to start follower"));
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    if (busy()) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const nextState = await (props.callbacks?.stop?.() ??
        Promise.resolve(state()));
      applyFollowerState(nextState);
    } catch (cause) {
      console.error("Failed to stop follower:", cause);
      setError(errorMessage(cause, "Failed to stop follower"));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (): void => {
    if (running()) {
      void stop();
    } else {
      void start();
    }
  };

  const addAttackPriority = (input: string): void => {
    const additions = parseFollowerAttackPriority(
      input.split(/[,;]/u).map((token) => parseMonsterMapId(token) ?? token),
    );
    if (additions.length > 0) {
      setAttackPriority((current) =>
        parseFollowerAttackPriority([...current, ...additions]),
      );
    }
  };

  const removeAttackPriority = (index: number): void => {
    setAttackPriority((current) => current.filter((_, i) => i !== index));
  };

  const addLockedZoneFallbacks = (input: string): void => {
    const additions = parseFollowerLocationFallbacks(
      input.replaceAll(/[;,]/gu, "\n"),
    );
    if (additions.length > 0) {
      setLockedZoneFallbacks((current) =>
        parseFollowerLocationFallbacks([...current, ...additions]),
      );
    }
  };

  const replaceLockedZoneFallback = (index: number, input: string): void => {
    const location = input.trim();
    setLockedZoneFallbacks((current) =>
      parseFollowerLocationFallbacks(
        location === ""
          ? current.filter((_, i) => i !== index)
          : current.map((candidate, i) => (i === index ? location : candidate)),
      ),
    );
  };

  const updateAttemptDraft = (draft: string): void => {
    setAttemptDraft(draft);
    const attempts = parseAttempts(draft);
    if (attempts !== undefined) {
      setAttemptLimit(attempts);
    }
  };

  const removeLockedZoneFallback = (index: number): void => {
    setLockedZoneFallbacks((current) => current.filter((_, i) => i !== index));
  };

  onMount(() => {
    let receivedState = false;
    let receivedLibrary = false;
    const unsubscribeFollower = props.callbacks?.onFollowerChanged?.(
      (nextState) => {
        receivedState = true;
        applyFollowerState(nextState);
      },
    );
    const unsubscribePlayers =
      props.callbacks?.getPlayers !== undefined &&
      props.callbacks.onPlayersChanged !== undefined
        ? observePlayerRoster(
            {
              getPlayers: props.callbacks.getPlayers,
              onPlayersChanged: props.callbacks.onPlayersChanged,
            },
            setPlayers,
            (cause) => {
              console.error("Failed to load players in map:", cause);
            },
          )
        : undefined;
    const unsubscribeProfiles = props.callbacks?.onLibraryChanged?.(
      (nextLibrary) => {
        receivedLibrary = true;
        applyLibrary(nextLibrary);
      },
    );

    const load = <T,>(
      request: (() => Promise<T>) | undefined,
      source: FollowerLoadSource,
    ): Promise<T | undefined> =>
      request === undefined
        ? Promise.resolve(undefined)
        : request().catch((cause: unknown) => {
            const failure = loadFailureMessages[source];
            console.error(`${failure}:`, cause);
            if (!disposed) {
              setLoadErrors((current) => ({ ...current, [source]: failure }));
            }
            return undefined;
          });

    void Promise.all([
      load(props.callbacks?.getConfig, "config"),
      load(props.callbacks?.getState, "state"),
      load(props.callbacks?.getLibrary, "library"),
    ]).then(([config, loadedState, loadedLibrary]) => {
      if (disposed) {
        return;
      }
      batch(() => {
        if (config !== undefined) {
          applyFollowerConfig(config);
        }
        const initialLibrary =
          receivedLibrary || props.callbacks?.getLibrary === undefined
            ? library()
            : loadedLibrary;
        if (initialLibrary !== undefined) {
          applyLibrary(initialLibrary);
        }
        if (receivedState) {
          clearLoadError("state");
        } else if (loadedState !== undefined) {
          applyFollowerState(loadedState);
        }
        syncedConfigurationKey = configurationKey(readConfiguration());
        setHydrated(true);
      });
    });

    onCleanup(() => {
      unsubscribeFollower?.();
      unsubscribePlayers?.();
      unsubscribeProfiles?.();
    });
  });

  return {
    addAttackPriority,
    addLockedZoneFallbacks,
    attackPriority,
    busy,
    canToggle,
    combatEnabled,
    configReady,
    copyWalk,
    filteredPlayers,
    fillMe,
    issueMessage,
    issueVariant,
    lockedZoneFallbacks,
    lockedZoneRoomOverride,
    loadingConfig,
    attemptDraft,
    attemptsInvalid,
    openCombatProfiles,
    playerItems,
    players,
    groupProfiles,
    hydrated,
    profileSelectItems,
    profileSelectValue,
    setGroupProfiles,
    setSelectedProfileOptionValue,
    removeAttackPriority,
    removeLockedZoneFallback,
    replaceLockedZoneFallback,
    retryEnabled,
    retryConfig,
    running,
    selectProfile,
    selectedPlayerValue,
    selectedProfileId,
    selectedProfileLabel,
    setCombatEnabled,
    setCopyWalk,
    setLockedZoneRoomOverride,
    setRetryEnabled,
    setTargetName,
    setUnlimitedAttempts,
    settingsDisabled,
    showIssue,
    state,
    targetName,
    toggle,
    unlimitedAttempts,
    updateAttemptDraft,
  };
}

type FollowerController = ReturnType<typeof createFollowerController>;

interface ControllerProps {
  readonly controller: FollowerController;
}

function IssueAlert(props: ControllerProps): JSX.Element {
  const c = props.controller;
  return (
    <Show when={c.showIssue()}>
      <Alert
        class="follower-issue"
        variant={c.issueVariant()}
        data-variant={c.issueVariant()}
      >
        <AlertDescription class="follower-issue__message">
          <Icon icon="circle_alert" aria-hidden="true" />
          <span>{c.issueMessage()}</span>
        </AlertDescription>
        <Show when={!c.configReady()}>
          <AlertAction>
            <Button
              size="xs"
              variant="ghost"
              disabled={c.loadingConfig()}
              aria-busy={c.loadingConfig()}
              onClick={() => void c.retryConfig()}
            >
              Retry
            </Button>
          </AlertAction>
        </Show>
      </Alert>
    </Show>
  );
}

function StartStopButton(
  props: ControllerProps & {
    readonly class?: string;
    readonly size?: "default" | "sm";
  },
): JSX.Element {
  const c = props.controller;
  return (
    <Button
      class={cn("follower-toggle", props.class)}
      size={props.size ?? "sm"}
      variant={c.running() ? "destructive" : "default"}
      aria-busy={c.busy()}
      disabled={!c.canToggle()}
      title={
        !c.running() && c.targetName().trim() === ""
          ? "Choose a player to follow first"
          : undefined
      }
      onClick={() => c.toggle()}
    >
      {c.running() ? "Stop" : "Start"}
    </Button>
  );
}

function TargetPicker(
  props: ControllerProps & { readonly class?: string },
): JSX.Element {
  const c = props.controller;
  return (
    <div class={cn("follower-target", props.class)}>
      <Combobox
        class="follower-target__combobox"
        allowCustomValue
        disabled={c.settingsDisabled()}
        inputBehavior="autohighlight"
        inputValue={c.targetName()}
        items={c.playerItems()}
        openOnClick
        value={c.selectedPlayerValue()}
        onInputValueChange={(details) => {
          if (
            details.reason === "input-change" ||
            details.reason === "item-select" ||
            details.reason === "clear-trigger"
          ) {
            c.setTargetName(details.inputValue);
          }
        }}
        onValueChange={(details) => {
          const selected = details.value[0];
          if (selected !== undefined) {
            c.setTargetName(selected);
          }
        }}
      >
        <ComboboxInput
          id="follower-target-name"
          aria-label="Player to follow"
          autocomplete="off"
          spellcheck={false}
          disabled={c.settingsDisabled()}
          placeholder="Player to follow"
        />
        <ComboboxContent>
          <ComboboxEmpty>
            {c.players().length === 0
              ? "No players in this map"
              : "No matching players"}
          </ComboboxEmpty>
          <ComboboxList>
            <For each={c.filteredPlayers()}>
              {(player) => <ComboboxItem value={player}>{player}</ComboboxItem>}
            </For>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <TooltipButton>
        <TooltipButtonTrigger
          variant="secondary"
          class="follower-me-action"
          disabled={c.settingsDisabled()}
          onClick={() => void c.fillMe()}
        >
          Me
        </TooltipButtonTrigger>
        <TooltipButtonContent>Use your player name</TooltipButtonContent>
      </TooltipButton>
    </div>
  );
}

const profileOptionLabel = (profile: CombatProfileOption): string =>
  profile.group === undefined
    ? profile.label
    : `${profile.label} - ${profile.group}`;

function ProfileSelect(props: ControllerProps): JSX.Element {
  const c = props.controller;
  return (
    <Select
      composite={false}
      items={c.profileSelectItems()}
      value={c.profileSelectValue() === "" ? [] : [c.profileSelectValue()]}
      disabled={c.settingsDisabled() || !c.combatEnabled()}
      onValueChange={(details) => {
        const option = c
          .profileSelectItems()
          .find((item) => item.value === details.value[0]);
        if (option !== undefined) {
          c.setSelectedProfileOptionValue(option.value);
          c.selectProfile(option.id);
        }
      }}
    >
      <SelectTrigger
        class="follower-profile-trigger"
        aria-label="Combat profile"
        title={c.selectedProfileLabel() || "Combat profile"}
      >
        <span
          class="select__value"
          data-placeholder={c.selectedProfileLabel() === "" ? "" : undefined}
        >
          {c.selectedProfileLabel() || "Combat profile"}
        </span>
      </SelectTrigger>
      <VirtualizedSelectContent
        aria-label="Combat profiles"
        items={c.profileSelectItems()}
        groupBy={
          c.groupProfiles()
            ? (profile) => profile.group ?? "Any class"
            : undefined
        }
        header={
          <Button
            aria-label="Group by class"
            aria-pressed={c.groupProfiles()}
            class="virtual-list__group-toggle"
            size="xs"
            title={c.groupProfiles() ? "Show flat list" : "Show grouped list"}
            variant="ghost"
            onClick={() => c.setGroupProfiles((grouped) => !grouped)}
          >
            <Icon icon="list_tree" class="button__icon" />
            <span>Group</span>
          </Button>
        }
        searchable
        scrollToSelected
      >
        {(profile) => (
          <SelectItem
            item={profile}
            aria-label={profileOptionLabel(profile)}
            title={profileOptionLabel(profile)}
            value={profile.value}
          >
            {profile.label}
          </SelectItem>
        )}
      </VirtualizedSelectContent>
    </Select>
  );
}

function EditProfilesButton(props: ControllerProps): JSX.Element {
  return (
    <Button
      size="xs"
      variant="ghost"
      class="follower-quiet-action"
      onClick={() => void props.controller.openCombatProfiles()}
    >
      Edit profiles
      <Icon icon="arrow_up_right" class="button__icon" />
    </Button>
  );
}

const attemptsPattern = /^\d+$/u;

const parseAttempts = (draft: string): number | undefined => {
  const value = Number(draft);
  return attemptsPattern.test(draft) &&
    value >= 1 &&
    value <= MAX_FOLLOWER_ATTEMPTS
    ? value
    : undefined;
};

function AttemptsInput(props: ControllerProps): JSX.Element {
  const c = props.controller;
  return (
    <div class="follower-room-field">
      <Input
        id="follower-attempts"
        class="follower-number-input"
        value={c.unlimitedAttempts() ? "" : c.attemptDraft()}
        placeholder={c.unlimitedAttempts() ? "∞" : undefined}
        inputmode="numeric"
        autocomplete="off"
        aria-label="Attempts"
        aria-describedby={
          c.attemptsInvalid() ? "follower-attempts-error" : undefined
        }
        invalid={c.attemptsInvalid()}
        disabled={
          c.settingsDisabled() || !c.retryEnabled() || c.unlimitedAttempts()
        }
        onInput={(event) => {
          const digits = event.currentTarget.value.replaceAll(/\D/gu, "");
          event.currentTarget.value = digits;
          c.updateAttemptDraft(digits);
        }}
      />
      <Checkbox
        size="sm"
        checked={c.unlimitedAttempts()}
        disabled={c.settingsDisabled() || !c.retryEnabled()}
        onChange={(event) =>
          c.setUnlimitedAttempts(event.currentTarget.checked)
        }
      >
        Unlimited
      </Checkbox>
      <Show when={c.attemptsInvalid()}>
        <span id="follower-attempts-error" class="follower-field-error">
          {`Use 1–${MAX_FOLLOWER_ATTEMPTS}`}
        </span>
      </Show>
    </div>
  );
}

const roomNumberPattern = /^\d{4,6}$/u;

const savedRoomOverride = (draft: string): string =>
  roomNumberPattern.test(draft) ? draft : "";

function RoomOverrideInput(props: ControllerProps): JSX.Element {
  const c = props.controller;
  const [draft, setDraft] = createSignal(c.lockedZoneRoomOverride());
  const invalid = () => draft() !== "" && !roomNumberPattern.test(draft());
  createEffect(() => {
    const saved = c.lockedZoneRoomOverride();
    if (saved !== savedRoomOverride(untrack(draft))) {
      setDraft(saved);
    }
  });
  return (
    <div class="follower-room-field">
      <Input
        id="follower-room-override"
        class="follower-room-input"
        value={draft()}
        placeholder="12345"
        inputmode="numeric"
        maxLength={6}
        autocomplete="off"
        autocorrect="off"
        spellcheck={false}
        aria-label="Room override"
        aria-describedby={
          invalid() ? "follower-room-override-error" : undefined
        }
        invalid={invalid()}
        disabled={c.settingsDisabled() || !c.retryEnabled()}
        onInput={(event) => {
          const digits = event.currentTarget.value
            .replaceAll(/\D/gu, "")
            .slice(0, 6);
          event.currentTarget.value = digits;
          setDraft(digits);
          c.setLockedZoneRoomOverride(savedRoomOverride(digits));
        }}
      />
      <Show when={invalid()}>
        <span id="follower-room-override-error" class="follower-field-error">
          Use 4–6 digits
        </span>
      </Show>
    </div>
  );
}

function RuleLabel(props: {
  readonly children: string;
  readonly for?: string;
  readonly help?: string;
}): JSX.Element {
  return (
    <span class="follower-rule-label">
      <label for={props.for}>{props.children}</label>
      <Show when={props.help}>
        {(help) => (
          <HelpTooltip
            aria-label={`About ${props.children.toLowerCase()}`}
            tooltip={help()}
          />
        )}
      </Show>
    </span>
  );
}

const toggleFromRow = (
  event: MouseEvent,
  disabled: boolean,
  checked: boolean,
  onChange: (checked: boolean) => void,
): void => {
  const target = event.target;
  if (
    disabled ||
    !(target instanceof Element) ||
    target.closest("a, button, input, label, select, textarea") !== null
  ) {
    return;
  }
  onChange(!checked);
};

const formatAttackTarget = (target: AttackTarget): string =>
  typeof target === "number" ? `id:${target}` : target;

function TagEditor(props: {
  readonly disabled: boolean;
  readonly empty: string;
  readonly id: string;
  readonly label: string;
  readonly mono?: (value: string) => boolean;
  readonly numbered?: boolean;
  readonly onAdd: (value: string) => void;
  readonly onEdit?: (index: number, value: string) => void;
  readonly onRemove: (index: number) => void;
  readonly placeholder: string;
  readonly values: readonly string[];
}): JSX.Element {
  const [input, setInput] = createSignal("");
  const [editingIndex, setEditingIndex] = createSignal<number | null>(null);
  let canceledEdit = false;

  createEffect(() => {
    if (props.disabled) {
      setEditingIndex(null);
    }
  });

  const beginEdit = (index: number): void => {
    if (props.onEdit !== undefined && !props.disabled) {
      canceledEdit = false;
      setEditingIndex(index);
    }
  };

  const commitEdit = (index: number, value: string): void => {
    setEditingIndex(null);
    if (canceledEdit || props.disabled) {
      canceledEdit = false;
      return;
    }
    if (value !== props.values[index]) {
      props.onEdit?.(index, value);
    }
  };

  return (
    <>
      <form
        class="follower-entry"
        onSubmit={(event) => {
          event.preventDefault();
          props.onAdd(input());
          setInput("");
        }}
      >
        <Input
          id={props.id}
          value={input()}
          placeholder={props.placeholder}
          autocomplete="off"
          spellcheck={false}
          aria-label={props.label}
          disabled={props.disabled}
          onInput={(event) => setInput(event.currentTarget.value)}
        />
        <TooltipIconButton
          type="submit"
          size="icon"
          variant="secondary"
          class="follower-icon-action"
          aria-label={props.label}
          tooltip={props.label}
          disabled={props.disabled || input().trim() === ""}
        >
          <Icon icon="plus" class="button__icon" />
        </TooltipIconButton>
      </form>
      <ul class="follower-tags" aria-label={props.label}>
        <For
          each={props.values}
          fallback={<li class="follower-empty">{props.empty}</li>}
        >
          {(value, index) => (
            <li
              class="follower-tag"
              data-disabled={props.disabled ? "" : undefined}
              data-numbered={props.numbered ? "" : undefined}
            >
              <Show when={props.numbered}>
                <span class="follower-tag__order">{index() + 1}</span>
              </Show>
              <Show
                when={editingIndex() === index()}
                fallback={
                  <span
                    class={cn(
                      "follower-tag__label",
                      props.mono?.(value) && "follower-tag__label--mono",
                      props.onEdit !== undefined &&
                        "follower-tag__label--editable",
                    )}
                    title={
                      props.onEdit !== undefined && !props.disabled
                        ? `${value} (double-click to edit)`
                        : value
                    }
                    onDblClick={() => beginEdit(index())}
                  >
                    {value}
                  </span>
                }
              >
                <input
                  ref={(element) =>
                    requestAnimationFrame(() => {
                      element.focus();
                      element.select();
                    })
                  }
                  class="follower-tag__input"
                  value={value}
                  aria-label={`Edit ${value}`}
                  autocomplete="off"
                  spellcheck={false}
                  size={Math.max(value.length, 4)}
                  onInput={(event) => {
                    event.currentTarget.size = Math.max(
                      event.currentTarget.value.length,
                      4,
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      canceledEdit = true;
                      event.currentTarget.blur();
                    }
                  }}
                  onBlur={(event) =>
                    commitEdit(index(), event.currentTarget.value)
                  }
                />
              </Show>
              <IconButton
                type="button"
                size="icon-xs"
                variant="ghost"
                class="follower-remove-button"
                aria-label={`Remove ${value}`}
                disabled={props.disabled}
                onClick={() => props.onRemove(index())}
              >
                <Icon icon="x" size="sm" />
              </IconButton>
            </li>
          )}
        </For>
      </ul>
    </>
  );
}

const isMonsterMapId = (value: string): boolean =>
  parseMonsterMapId(value) !== undefined;

const priorityValues = (c: FollowerController): readonly string[] =>
  c.attackPriority().map(formatAttackTarget);

const priorityHelp =
  "Attacked first, in order. Anything else available is attacked after these.";
const fallbackHelp =
  "Joined directly, in order, when the game won't let you go to the target.";
const roomHelp = "Used for fallback maps that don't include a room number.";

function SheetSection(props: {
  readonly checked: boolean;
  readonly children?: JSX.Element;
  readonly description: string;
  readonly disabled: boolean;
  readonly id: string;
  readonly onChange: (checked: boolean) => void;
  readonly title: string;
}): JSX.Element {
  const headingId = () => `follower-section-${props.id}`;
  return (
    <section
      class="follower-section"
      aria-labelledby={headingId()}
      data-off={props.checked ? undefined : ""}
    >
      <div
        class="follower-section__heading"
        data-toggle={props.disabled ? undefined : ""}
        onClick={(event) =>
          toggleFromRow(event, props.disabled, props.checked, props.onChange)
        }
      >
        <div class="follower-section__label">
          <h2 id={headingId()} class="follower-section__title">
            {props.title}
          </h2>
          <p class="follower-section__description">{props.description}</p>
        </div>
        <Switch
          size="sm"
          class="follower-section__switch"
          aria-label={props.title}
          checked={props.checked}
          disabled={props.disabled}
          onChange={(event) => props.onChange(event.currentTarget.checked)}
        />
      </div>
      <Show when={props.checked && props.children}>{props.children}</Show>
    </section>
  );
}

export function FollowerView(props: FollowerViewProps): JSX.Element {
  const c = createFollowerController(props);
  return (
    <div class="standalone-window follower-root">
      <Show when={c.hydrated()}>
        <header class="standalone-window__header follower-header">
          <label for="follower-target-name" class="follower-header__label">
            Follow
          </label>
          <TargetPicker controller={c} />
          <div class="follower-header__end">
            <StartStopButton controller={c} />
          </div>
        </header>

        <IssueAlert controller={c} />

        <main class="follower-sheet" aria-label="Follower settings">
          <SheetSection
            id="movement"
            title="Copy movement"
            description="Walk where the target walks inside a room."
            checked={c.copyWalk()}
            disabled={c.settingsDisabled()}
            onChange={c.setCopyWalk}
          />

          <SheetSection
            id="combat"
            title="Combat"
            description="Fight alongside the target with a combat profile."
            checked={c.combatEnabled()}
            disabled={c.settingsDisabled()}
            onChange={c.setCombatEnabled}
          >
            <div class="follower-rules">
              <div class="follower-rules__header">
                <RuleLabel>Profile</RuleLabel>
                <EditProfilesButton controller={c} />
              </div>
              <div class="follower-profile-row">
                <ProfileSelect controller={c} />
              </div>
            </div>
            <div class="follower-rules">
              <RuleLabel for="follower-priority" help={priorityHelp}>
                Attack priority
              </RuleLabel>
              <TagEditor
                id="follower-priority"
                label="Add priority target"
                placeholder="Monster name or id:123; another"
                empty="No priority targets. Attacks whatever is available."
                numbered
                mono={isMonsterMapId}
                disabled={c.settingsDisabled()}
                values={priorityValues(c)}
                onAdd={c.addAttackPriority}
                onRemove={c.removeAttackPriority}
              />
            </div>
          </SheetSection>

          <SheetSection
            id="recovery"
            title="Recovery"
            description="Retry when following fails, and try fallback maps."
            checked={c.retryEnabled()}
            disabled={c.settingsDisabled()}
            onChange={c.setRetryEnabled}
          >
            <div class="follower-inline-fields">
              <div class="follower-rules">
                <RuleLabel for="follower-attempts">Attempts</RuleLabel>
                <AttemptsInput controller={c} />
              </div>
              <div class="follower-rules">
                <RuleLabel for="follower-room-override" help={roomHelp}>
                  Room override
                </RuleLabel>
                <RoomOverrideInput controller={c} />
              </div>
            </div>
            <div class="follower-rules">
              <RuleLabel for="follower-fallbacks" help={fallbackHelp}>
                Fallback maps
              </RuleLabel>
              <TagEditor
                id="follower-fallbacks"
                label="Add fallback map"
                placeholder="ultradage-12345; another map"
                empty="No fallback maps yet."
                numbered
                disabled={c.settingsDisabled()}
                values={c.lockedZoneFallbacks()}
                onAdd={c.addLockedZoneFallbacks}
                onEdit={c.replaceLockedZoneFallback}
                onRemove={c.removeLockedZoneFallback}
              />
            </div>
          </SheetSection>
        </main>
      </Show>
    </div>
  );
}

export function App(): JSX.Element {
  const desktop = selectDesktopBridge(window.desktop, "follower");
  const follower = desktop.follower;
  const combatProfiles = desktop.combatProfiles;

  return (
    <FollowerView
      callbacks={{
        configure: (configuration) => follower.configure(configuration),
        getConfig: () => follower.getConfig(),
        getLibrary: () => combatProfiles.getState(),
        getPlayers: () => follower.getPlayers(),
        getState: () => follower.getState(),
        me: () => follower.me(),
        onFollowerChanged: (listener) => follower.onChanged(listener),
        onLibraryChanged: (listener) => combatProfiles.onChanged(listener),
        onPlayersChanged: (listener) => follower.onPlayersChanged(listener),
        openCombatProfiles: async () => {
          await desktop.windows.open("combat-profiles");
        },
        start: (configuration) => follower.start(configuration),
        stop: () => follower.stop(),
      }}
      fixture={{
        library: DEFAULT_COMBAT_PROFILE_LIBRARY,
        state: createIdleFollowerState(),
      }}
    />
  );
}
