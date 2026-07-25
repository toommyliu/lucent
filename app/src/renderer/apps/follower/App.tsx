import {
  Alert,
  AlertAction,
  AlertDescription,
  Icon,
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Field,
  IconButton,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Switch as ToggleSwitch,
  TooltipIconButton,
} from "@lucent/ui";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
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
  createIdleFollowerState,
  parseFollowerLocationFallbacks,
  type FollowerStartPayload,
  type FollowerState,
} from "@lucent/core/follower";
import {
  readLocalStorageValue,
  writeLocalStorageValue,
} from "../../localStorage";
import { filterPlayerRoster, observePlayerRoster } from "./playerRoster";
import { reconcileFollowerCombatProfileId } from "./profileSelection";

const selectedProfileStorageKey = "lucent.follower.selectedProfileId";

const requireBridge = <T,>(bridge: T | undefined): T => {
  if (bridge === undefined) {
    throw new Error("The Follower desktop bridge is unavailable.");
  }
  return bridge;
};
const follower = requireBridge(window.desktop.follower);
const combatProfiles = requireBridge(window.desktop.combatProfiles);
const windows = requireBridge(window.desktop.windows);

function LabelHelp(props: {
  readonly label: string;
  readonly tooltip: string;
}): JSX.Element {
  return (
    <span class="follower-label-help">
      <span>{props.label}</span>
      <TooltipIconButton
        aria-label={`${props.label} help`}
        class="follower-help-button"
        size="icon-xs"
        tooltip={props.tooltip}
      >
        <Icon icon="help_circle" class="button__icon" />
      </TooltipIconButton>
    </span>
  );
}

export function App(): JSX.Element {
  const [state, setState] = createSignal<FollowerState>(
    createIdleFollowerState(),
  );
  const [library, setLibrary] = createSignal<CombatProfileLibrary>(
    DEFAULT_COMBAT_PROFILE_LIBRARY,
  );
  const [targetName, setTargetName] = createSignal("");
  const [players, setPlayers] = createSignal<readonly string[]>([]);
  const [combatEnabled, setCombatEnabled] = createSignal(
    DEFAULT_FOLLOWER_COMBAT_ENABLED,
  );
  const [copyWalk, setCopyWalk] = createSignal(DEFAULT_FOLLOWER_COPY_WALK);
  const [retryEnabled, setRetryEnabled] = createSignal(
    DEFAULT_FOLLOWER_RETRY_ENABLED,
  );
  const [maxAttempts, setMaxAttempts] = createSignal(DEFAULT_FOLLOWER_ATTEMPTS);
  const [selectedProfileId, setSelectedProfileId] = createSignal(
    readLocalStorageValue(selectedProfileStorageKey) ??
      DEFAULT_COMBAT_PROFILE_ID,
  );
  const [attackPriority, setAttackPriority] = createSignal("");
  const [lockedZoneFallbacks, setLockedZoneFallbacks] = createSignal<
    readonly string[]
  >([]);
  const [lockedZoneFallbackInput, setLockedZoneFallbackInput] =
    createSignal("");
  const [lockedZoneRoomOverride, setLockedZoneRoomOverride] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [dismissedIssue, setDismissedIssue] = createSignal(false);
  let previousIssueKey = "";
  let configurationEffectReady = false;
  let configurationRevision = 0;
  let disposed = false;

  const running = createMemo(() => state().enabled || state().running);
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
  const profileSelectItems = createMemo(() =>
    profileOptions().map((profile) => ({
      label: profile.label,
      value: profile.id,
    })),
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
      current.attemptsRemaining <= 0 &&
      current.stoppedReason !== "Stopped by user"
    );
  });
  const issueMessage = createMemo(() => {
    const current = state();
    const followerMessages = exhaustedFollowerAttempts()
      ? [current.stoppedReason ?? "", current.lastError ?? ""]
      : [];
    const messages = [error(), ...followerMessages].filter(Boolean);
    return [...new Set(messages)].join(" - ");
  });
  const showIssue = createMemo(
    () => issueMessage() !== "" && !dismissedIssue(),
  );

  const readConfiguration = (): FollowerStartPayload => ({
    targetName: targetName(),
    combatEnabled: combatEnabled(),
    copyWalk: copyWalk(),
    retryEnabled: retryEnabled(),
    maxAttempts: maxAttempts(),
    selectedProfileId: selectedProfileId(),
    attackPriority: attackPriority(),
    lockedZoneFallbacks: lockedZoneFallbacks(),
    lockedZoneRoomOverride: lockedZoneRoomOverride(),
  });

  createEffect(() => {
    const configuration = readConfiguration();
    if (!configurationEffectReady) {
      configurationEffectReady = true;
      return;
    }

    const revision = ++configurationRevision;
    void follower.configure(configuration).catch((cause: unknown) => {
      console.error("Failed to sync follower configuration:", cause);
      if (!disposed && revision === configurationRevision) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Failed to sync follower configuration",
        );
      }
    });
  });

  onCleanup(() => {
    disposed = true;
  });

  createEffect(() => {
    const key = issueMessage();
    if (key !== previousIssueKey) {
      previousIssueKey = key;
      setDismissedIssue(false);
    }
  });

  const selectProfile = (profileId: string): void => {
    setSelectedProfileId(profileId);
    writeLocalStorageValue(selectedProfileStorageKey, profileId);
  };

  const applyLibrary = (nextLibrary: CombatProfileLibrary): void => {
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
    setState(nextState);
    if (nextState.enabled || nextState.running) {
      setDismissedIssue(false);
      setError("");
    }
  };

  const fillMe = async (): Promise<void> => {
    setError("");
    try {
      const me = await follower.me();
      if (me.trim()) {
        setTargetName(me);
      }
    } catch (cause) {
      console.error("Failed to resolve current player:", cause);
      setError(cause instanceof Error ? cause.message : "Failed to get player");
    }
  };

  const openCombatProfiles = async (): Promise<void> => {
    setError("");
    try {
      await windows.open("combat-profiles");
    } catch (cause) {
      console.error("Failed to open combat profiles:", cause);
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to open combat profiles",
      );
    }
  };

  const start = async (): Promise<void> => {
    const trimmedTarget = targetName().trim();
    if (!trimmedTarget || busy()) {
      return;
    }

    setBusy(true);
    setError("");
    setDismissedIssue(false);
    try {
      const nextState = await follower.start({
        ...readConfiguration(),
        targetName: trimmedTarget,
      });
      applyFollowerState(nextState);
    } catch (cause) {
      console.error("Failed to start follower:", cause);
      setError(
        cause instanceof Error ? cause.message : "Failed to start follower",
      );
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
      const nextState = await follower.stop();
      applyFollowerState(nextState);
    } catch (cause) {
      console.error("Failed to stop follower:", cause);
      setError(
        cause instanceof Error ? cause.message : "Failed to stop follower",
      );
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

  const PlayerPicker = (): JSX.Element => (
    <div class="follower-target-row">
      <Combobox
        class="follower-player-combobox"
        allowCustomValue
        disabled={running()}
        inputBehavior="autohighlight"
        inputValue={targetName()}
        items={playerItems()}
        openOnClick
        value={selectedPlayerValue()}
        onInputValueChange={(details) => {
          if (
            details.reason === "input-change" ||
            details.reason === "item-select" ||
            details.reason === "clear-trigger"
          ) {
            setTargetName(details.inputValue);
          }
        }}
        onValueChange={(details) => {
          const selected = details.value[0];
          if (selected !== undefined) {
            setTargetName(selected);
          }
        }}
      >
        <ComboboxInput
          id="follower-target-name"
          aria-label="Player name"
          autocomplete="off"
          disabled={running()}
          placeholder="Player name"
        />
        <ComboboxContent>
          <ComboboxEmpty>
            {players().length === 0
              ? "No players in map"
              : "No matching players"}
          </ComboboxEmpty>
          <ComboboxList>
            <For each={filteredPlayers()}>
              {(player) => <ComboboxItem value={player}>{player}</ComboboxItem>}
            </For>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <Button
        size="sm"
        variant="outline"
        disabled={running()}
        onClick={() => void fillMe()}
      >
        <Icon icon="user_round" class="button__icon" />
        Me
      </Button>
    </div>
  );

  const CombatFields = (): JSX.Element => (
    <>
      <div class="follower-profile-field">
        <Button
          aria-label="Open combat profiles"
          class="follower-profile-access"
          size="xs"
          variant="ghost"
          onClick={() => void openCombatProfiles()}
        >
          <span>Combat Profile</span>
          <Icon icon="arrow_up_right" class="button__icon" />
        </Button>
        <Select
          items={profileSelectItems()}
          value={[selectedProfileId()]}
          disabled={running() || !combatEnabled()}
          onValueChange={(details) => {
            const id = details.value[0];
            if (id) {
              selectProfile(id);
            }
          }}
        >
          <SelectTrigger aria-label="Selected combat profile">
            <span
              class="select__value"
              data-placeholder={selectedProfileLabel() === "" ? "" : undefined}
            >
              {selectedProfileLabel() || "Combat profile"}
            </span>
          </SelectTrigger>
          <SelectContent>
            <For each={profileOptions()}>
              {(profile) => (
                <SelectItem value={profile.id}>{profile.label}</SelectItem>
              )}
            </For>
          </SelectContent>
        </Select>
      </div>
      <Field
        class="follower-field follower-field--priority"
        label="Attack priority"
        for="follower-attack-priority"
      >
        <Input
          id="follower-attack-priority"
          value={attackPriority()}
          placeholder="Defense Drone, Attack Drone"
          autocomplete="off"
          disabled={running() || !combatEnabled()}
          onInput={(event) => setAttackPriority(event.currentTarget.value)}
        />
      </Field>
    </>
  );

  const AttemptsControl = (): JSX.Element => (
    <Label class="follower-inline-number" for="follower-retry-attempts">
      <span>Attempts</span>
      <Input
        id="follower-retry-attempts"
        class="follower-retry-attempts-input"
        type="number"
        min="1"
        step="1"
        value={String(maxAttempts())}
        disabled={running() || !retryEnabled()}
        onInput={(event) => {
          const parsed = Number.parseInt(event.currentTarget.value, 10);
          if (Number.isFinite(parsed)) {
            setMaxAttempts(Math.max(1, parsed));
          }
        }}
      />
    </Label>
  );

  const addLockedZoneFallbacks = (event: SubmitEvent): void => {
    event.preventDefault();
    const additions = parseFollowerLocationFallbacks(
      lockedZoneFallbackInput().replaceAll(";", "\n"),
    );
    setLockedZoneFallbackInput("");
    if (additions.length === 0) {
      return;
    }

    setLockedZoneFallbacks((current) => {
      const identities = new Set(
        current.map((location) => location.toLowerCase()),
      );
      return [
        ...current,
        ...additions.filter((location) => {
          const identity = location.toLowerCase();
          if (identities.has(identity)) {
            return false;
          }
          identities.add(identity);
          return true;
        }),
      ];
    });
  };

  const removeLockedZoneFallback = (location: string): void => {
    const identity = location.toLowerCase();
    setLockedZoneFallbacks((current) =>
      current.filter((candidate) => candidate.toLowerCase() !== identity),
    );
  };

  const LockedZoneFields = (): JSX.Element => (
    <>
      <div class="follower-field follower-field--fallbacks">
        <Label for="follower-locked-zone-fallback">Locked-zone locations</Label>
        <form class="follower-location-entry" onSubmit={addLockedZoneFallbacks}>
          <Input
            id="follower-locked-zone-fallback"
            value={lockedZoneFallbackInput()}
            placeholder="ultradage-12345"
            autocomplete="off"
            spellcheck={false}
            disabled={running() || !retryEnabled()}
            onInput={(event) =>
              setLockedZoneFallbackInput(event.currentTarget.value)
            }
          />
          <TooltipIconButton
            type="submit"
            size="icon"
            aria-label="Add locked-zone location"
            tooltip="Add location"
            disabled={
              running() ||
              !retryEnabled() ||
              lockedZoneFallbackInput().trim() === ""
            }
          >
            <Icon icon="plus" class="button__icon" />
          </TooltipIconButton>
        </form>
        <div class="follower-location-list" aria-label="Locked-zone locations">
          <Show
            when={lockedZoneFallbacks().length > 0}
            fallback={
              <span class="follower-location-list__empty">No locations</span>
            }
          >
            <For each={lockedZoneFallbacks()}>
              {(location) => {
                return (
                  <div class="follower-location-chip">
                    <span class="follower-location-chip__label">
                      {location}
                    </span>
                    <IconButton
                      type="button"
                      class="follower-location-chip__remove"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${location}`}
                      disabled={running() || !retryEnabled()}
                      onClick={() => removeLockedZoneFallback(location)}
                    >
                      <Icon icon="x" class="button__icon" />
                    </IconButton>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
      </div>
      <Field
        class="follower-field follower-field--room"
        label={
          <LabelHelp
            label="Room override"
            tooltip="Used only for locked-zone maps without a room suffix."
          />
        }
        for="follower-locked-zone-room"
      >
        <Input
          id="follower-locked-zone-room"
          class="follower-room-input"
          value={lockedZoneRoomOverride()}
          placeholder="12345"
          inputMode="numeric"
          autocomplete="off"
          disabled={running() || !retryEnabled()}
          onInput={(event) =>
            setLockedZoneRoomOverride(event.currentTarget.value)
          }
        />
      </Field>
    </>
  );

  onMount(() => {
    const unsubscribeFollower = follower.onChanged(applyFollowerState);
    const unsubscribePlayers = observePlayerRoster(
      follower,
      setPlayers,
      (cause) => {
        console.error("Failed to load players in map:", cause);
      },
    );
    const unsubscribeProfiles = combatProfiles.onChanged(applyLibrary);

    void follower
      .getState()
      .then(applyFollowerState)
      .catch((cause: unknown) => {
        console.error("Failed to load follower state:", cause);
        setError("Failed to load follower state");
      });

    void combatProfiles
      .getState()
      .then(applyLibrary)
      .catch((cause: unknown) => {
        console.error("Failed to load combat profiles:", cause);
        setError("Failed to load combat profiles");
      });

    onCleanup(() => {
      unsubscribeFollower();
      unsubscribePlayers();
      unsubscribeProfiles();
    });
  });

  return (
    <div class="standalone-window follower-window">
      <div class="standalone-window__content-frame">
        <main
          class="standalone-window__content follower-body"
          aria-label="Follower controls"
        >
          <section class="follower-shell">
            <Show when={showIssue()}>
              <Alert class="follower-issue" variant="error">
                <AlertDescription class="follower-issue__message">
                  <Icon icon="circle_alert" aria-hidden="true" />
                  <span>{issueMessage()}</span>
                </AlertDescription>
                <AlertAction>
                  <IconButton
                    aria-label="Dismiss follower status"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setDismissedIssue(true)}
                  >
                    <Icon icon="x" class="button__icon" />
                  </IconButton>
                </AlertAction>
              </Alert>
            </Show>

            <section
              class="follower-layout follower-layout--focus"
              data-layout="focus"
              aria-label="Focused follower controls"
            >
              <div class="follower-focus__command">
                <div class="follower-focus__command-label">Target</div>
                <PlayerPicker />
                <Button
                  class="follower-focus__start"
                  disabled={busy() || (!running() && !targetName().trim())}
                  size="sm"
                  variant={running() ? "destructive" : "default"}
                  onClick={toggle}
                >
                  {running() ? "Stop" : "Start"}
                </Button>
              </div>

              <div class="follower-focus__behaviors">
                <div class="follower-focus__section-label">Behavior</div>

                <section class="follower-focus__behavior">
                  <div class="follower-focus__behavior-row">
                    <div class="follower-focus__behavior-title">
                      Copy movement
                    </div>
                    <ToggleSwitch
                      aria-label="Copy movement"
                      checked={copyWalk()}
                      disabled={running()}
                      size="sm"
                      onChange={(event) =>
                        setCopyWalk(event.currentTarget.checked)
                      }
                    />
                  </div>
                </section>

                <section class="follower-focus__behavior">
                  <div class="follower-focus__behavior-row">
                    <div class="follower-focus__behavior-title">Combat</div>
                    <ToggleSwitch
                      aria-label="Combat"
                      checked={combatEnabled()}
                      disabled={running()}
                      size="sm"
                      onChange={(event) =>
                        setCombatEnabled(event.currentTarget.checked)
                      }
                    />
                  </div>
                  <Show when={combatEnabled()}>
                    <div class="follower-focus__behavior-body follower-focus__behavior-body--combat">
                      <CombatFields />
                    </div>
                  </Show>
                </section>

                <section class="follower-focus__behavior">
                  <div class="follower-focus__behavior-row">
                    <div class="follower-focus__behavior-title">Recovery</div>
                    <div class="follower-focus__behavior-summary follower-focus__behavior-summary--attempts">
                      <Show when={retryEnabled()} fallback="Off">
                        <AttemptsControl />
                      </Show>
                    </div>
                    <ToggleSwitch
                      aria-label="Recovery"
                      checked={retryEnabled()}
                      disabled={running()}
                      size="sm"
                      onChange={(event) =>
                        setRetryEnabled(event.currentTarget.checked)
                      }
                    />
                  </div>
                  <Show when={retryEnabled()}>
                    <div class="follower-focus__behavior-body follower-focus__behavior-body--recovery">
                      <div class="follower-locked-zone-grid">
                        <LockedZoneFields />
                      </div>
                    </div>
                  </Show>
                </section>
              </div>
            </section>
          </section>
        </main>
      </div>
    </div>
  );
}
