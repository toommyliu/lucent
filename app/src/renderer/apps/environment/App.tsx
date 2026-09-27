import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDescription,
  Button,
  Checkbox,
  Icon,
  HelpTooltip,
  IconButton,
  Input,
  PillButton,
  Switch,
  TooltipButton,
  TooltipButtonContent,
  TooltipButtonTrigger,
  TooltipIconButton,
  cn,
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
  environmentBoostWithdrawalSummary,
  prepareEnvironmentBankBoosts,
  type EnvironmentBankBoostOption,
} from "./boosts";
import {
  parseEnvironmentQuestBulkInput,
  splitEnvironmentBulkInput,
} from "./input";
import {
  EnvironmentItemBuckets,
  createEmptyEnvironmentState,
  type EnvironmentAutomationCapability,
  type EnvironmentItemBucket,
  type EnvironmentItemRules,
  type EnvironmentQuestAutoRegisterOptions,
  type EnvironmentQuestRegistration,
  type EnvironmentState,
} from "@lucent/core/environment";
import { selectDesktopBridge } from "../../../shared/desktopBridge";
import type { EnvironmentBoostDiscovery } from "../../../shared/ipc/environment";

export interface EnvironmentViewFixture {
  readonly error?: string;
  readonly state: EnvironmentState;
}

export interface EnvironmentViewCallbacks {
  readonly addBoosts?: (names: readonly string[]) => Promise<EnvironmentState>;
  readonly addItems?: (names: readonly string[]) => Promise<EnvironmentState>;
  readonly addQuests?: (
    quests: readonly EnvironmentQuestRegistration[],
  ) => Promise<EnvironmentState>;
  readonly clear?: () => Promise<EnvironmentState>;
  readonly clearBoosts?: () => Promise<EnvironmentState>;
  readonly clearItems?: () => Promise<EnvironmentState>;
  readonly clearQuestReward?: (questId: number) => Promise<EnvironmentState>;
  readonly clearQuests?: () => Promise<EnvironmentState>;
  readonly fetchBoosts?: () => Promise<EnvironmentBoostDiscovery>;
  readonly getState?: () => Promise<EnvironmentState>;
  readonly onStateChanged?: (
    listener: (state: EnvironmentState) => void,
  ) => () => void;
  readonly removeBoost?: (name: string) => Promise<EnvironmentState>;
  readonly removeItem?: (name: string) => Promise<EnvironmentState>;
  readonly removeQuest?: (questId: number) => Promise<EnvironmentState>;
  readonly setAutomationEnabled?: (
    capability: EnvironmentAutomationCapability,
    enabled: boolean,
  ) => Promise<EnvironmentState>;
  readonly setItemNotification?: (
    name: string,
    enabled: boolean,
  ) => Promise<EnvironmentState>;
  readonly setItemRules?: (
    rules: EnvironmentItemRules,
  ) => Promise<EnvironmentState>;
  readonly setQuestAutoRegister?: (
    options: EnvironmentQuestAutoRegisterOptions,
  ) => Promise<EnvironmentState>;
  readonly setQuestReward?: (
    questId: number,
    rewardItemId: number,
  ) => Promise<EnvironmentState>;
  readonly syncToAll?: () => Promise<EnvironmentState>;
  readonly withdrawBoosts?: (
    itemIds: readonly number[],
  ) => Promise<readonly number[]>;
}

export interface EnvironmentViewProps {
  readonly callbacks?: EnvironmentViewCallbacks;
  readonly fixture: EnvironmentViewFixture;
}

const bucketLabels: Record<EnvironmentItemBucket, string> = {
  "ac-member": "AC member-only",
  "ac-non-member": "AC non-member",
  "non-ac-member": "Non-AC member-only",
  "non-ac-non-member": "Non-AC non-member",
};

type EnvironmentSection = EnvironmentAutomationCapability;

function rewardInputWidth(value: string): string {
  return `calc(${Math.max(value.length || "itemID".length, 1)}ch + 0.5rem)`;
}
type EnvironmentFilter = "all" | EnvironmentSection;

function FilterPill(props: {
  readonly count: number;
  readonly label: string;
  readonly onSelect: () => void;
  readonly pressed: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      class="environment-filter-pill"
      aria-pressed={props.pressed}
      onClick={() => props.onSelect()}
    >
      {props.label}
      <span class="environment-count">{props.count}</span>
    </button>
  );
}

function TogglePill(props: {
  readonly children: JSX.Element;
  readonly onChange: (pressed: boolean) => void;
  readonly pressed: boolean;
  readonly tone?: "destructive";
}): JSX.Element {
  return (
    <button
      type="button"
      class={cn(
        "environment-toggle-pill",
        props.tone && `environment-toggle-pill--${props.tone}`,
      )}
      aria-pressed={props.pressed}
      onClick={() => props.onChange(!props.pressed)}
    >
      <Icon
        icon={props.pressed ? "check" : "plus"}
        size="xs"
        class="environment-toggle-pill__icon"
      />
      {props.children}
    </button>
  );
}

function RuleGroup(props: {
  readonly children: JSX.Element;
  readonly id: string;
  readonly label: JSX.Element;
}): JSX.Element {
  return (
    <div class="environment-rules" role="group" aria-labelledby={props.id}>
      <span id={props.id} class="environment-rules__label">
        {props.label}
      </span>
      <div class="environment-rules__pills">{props.children}</div>
    </div>
  );
}

function AutomationSwitch(props: {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <Switch
      size="sm"
      class="environment-automation-switch"
      checked={props.checked}
      aria-label={`Automate ${props.label}`}
      onChange={(event) => props.onChange(event.currentTarget.checked)}
    >
      Automate
    </Switch>
  );
}

function ClearButton(props: {
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <Button
      size="xs"
      variant="ghost"
      class="environment-clear-action"
      aria-label={`Clear ${props.label}`}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      Clear
    </Button>
  );
}

function RemoveButton(props: {
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <IconButton
      type="button"
      size="icon-xs"
      variant="ghost"
      class="environment-remove-button"
      aria-label={props.label}
      onClick={() => props.onClick()}
    >
      <Icon icon="x" size="sm" />
    </IconButton>
  );
}

function SoundToggle(props: {
  readonly enabled: boolean;
  readonly item: string;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <TooltipIconButton
      size="icon-xs"
      class={cn(
        "environment-sound-toggle",
        props.enabled && "environment-sound-toggle--on",
      )}
      aria-label={
        props.enabled
          ? `Disable drop sound for ${props.item}`
          : `Enable drop sound for ${props.item}`
      }
      aria-pressed={props.enabled}
      tooltip={
        props.enabled
          ? "Stop playing a sound when this drops"
          : "Play a sound when this drops"
      }
      onClick={() => props.onToggle()}
    >
      <Icon icon="bell" size="sm" />
    </TooltipIconButton>
  );
}

function EntryForm(props: {
  readonly label: string;
  readonly onInput: (value: string) => void;
  readonly onSubmit: (event: SubmitEvent) => void;
  readonly placeholder: string;
  readonly value: string;
}): JSX.Element {
  return (
    <form class="environment-entry" onSubmit={(event) => props.onSubmit(event)}>
      <Input
        value={props.value}
        placeholder={props.placeholder}
        autocomplete="off"
        spellcheck={false}
        aria-label={props.label}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
      <TooltipIconButton
        type="submit"
        size="icon"
        class="environment-icon-action"
        aria-label={props.label}
        variant="secondary"
        tooltip={props.label}
        disabled={!props.value.trim()}
      >
        <Icon icon="plus" class="button__icon" />
      </TooltipIconButton>
    </form>
  );
}

function EmptyTags(props: { readonly children: JSX.Element }): JSX.Element {
  return <li class="environment-empty">{props.children}</li>;
}

function SheetSection(props: {
  readonly actions: JSX.Element;
  readonly children: JSX.Element;
  readonly count: number;
  readonly id: EnvironmentSection;
  readonly title: string;
}): JSX.Element {
  const headingId = () => `environment-section-${props.id}`;
  return (
    <section class="environment-section" aria-labelledby={headingId()}>
      <div class="environment-section__heading">
        <div class="environment-section__label">
          <h2 id={headingId()} class="environment-section__title">
            {props.title}
          </h2>
          <span class="environment-count">{props.count}</span>
        </div>
        <div class="environment-section__actions">{props.actions}</div>
      </div>
      {props.children}
    </section>
  );
}

export function EnvironmentView(props: EnvironmentViewProps): JSX.Element {
  const [state, setState] = createSignal<EnvironmentState>(props.fixture.state);
  const [questInput, setQuestInput] = createSignal("");
  const [itemInput, setItemInput] = createSignal("");
  const [boostInput, setBoostInput] = createSignal("");
  const [clearingAll, setClearingAll] = createSignal(false);
  const [clearDialogOpen, setClearDialogOpen] = createSignal(false);
  const [fetchingBoosts, setFetchingBoosts] = createSignal(false);
  const [withdrawingBoosts, setWithdrawingBoosts] = createSignal(false);
  const [bankBoostDialogOpen, setBankBoostDialogOpen] = createSignal(false);
  const [bankBoosts, setBankBoosts] = createSignal<
    readonly EnvironmentBankBoostOption[]
  >([]);
  const [selectedBankBoostIds, setSelectedBankBoostIds] = createSignal<
    ReadonlySet<number>
  >(new Set<number>());
  const [syncing, setSyncing] = createSignal(false);
  const [applyDialogOpen, setApplyDialogOpen] = createSignal(false);
  const [error, setError] = createSignal(props.fixture.error ?? "");
  const [editingQuestRewardId, setEditingQuestRewardId] = createSignal<
    number | null
  >(null);
  const questRewardInputs = new Map<number, HTMLInputElement>();
  let canceledQuestRewardEdit = false;

  const totalCount = createMemo(
    () =>
      state().questIds.length +
      state().itemNames.length +
      state().boosts.length,
  );

  createEffect(() => {
    const questId = editingQuestRewardId();
    if (questId === null) {
      return;
    }

    window.requestAnimationFrame(() => {
      const input = questRewardInputs.get(questId);
      input?.focus();
      input?.select();
    });
  });

  const runStateUpdate = async (
    update: Promise<EnvironmentState>,
  ): Promise<EnvironmentState | null> => {
    setError("");
    try {
      const nextState = await update;
      setState(nextState);
      return nextState;
    } catch (cause) {
      console.error("Environment update failed:", cause);
      setError(
        cause instanceof Error ? cause.message : "Environment update failed",
      );
      return null;
    }
  };

  const clearAll = async (): Promise<void> => {
    setClearingAll(true);
    try {
      await runStateUpdate(
        props.callbacks?.clear?.() ?? Promise.resolve(state()),
      );
    } finally {
      setClearingAll(false);
    }
  };

  const addQuests = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const tokens = parseEnvironmentQuestBulkInput(questInput());
    if (tokens.length === 0) {
      setQuestInput("");
      return;
    }

    setQuestInput("");
    await runStateUpdate(
      props.callbacks?.addQuests?.(tokens) ?? Promise.resolve(state()),
    );
  };

  const updateQuestReward = async (
    questId: number,
    value: string,
  ): Promise<void> => {
    const input = value.trim();
    if (input === "") {
      await runStateUpdate(
        props.callbacks?.clearQuestReward?.(questId) ??
          Promise.resolve(state()),
      );
      return;
    }

    const rewardItemId = Number(input);
    if (!Number.isSafeInteger(rewardItemId) || rewardItemId <= 0) {
      setError("Reward item ID must be a positive integer.");
      return;
    }

    await runStateUpdate(
      props.callbacks?.setQuestReward?.(questId, rewardItemId) ??
        Promise.resolve(state()),
    );
  };

  const updateQuestAutoRegister = async (
    options: EnvironmentQuestAutoRegisterOptions,
  ): Promise<void> => {
    await runStateUpdate(
      props.callbacks?.setQuestAutoRegister?.(options) ??
        Promise.resolve(state()),
    );
  };

  const setQuestAutoRegisterOption = async (
    option: keyof EnvironmentQuestAutoRegisterOptions,
    enabled: boolean,
  ): Promise<void> => {
    await updateQuestAutoRegister({
      ...state().questAutoRegister,
      [option]: enabled,
    });
  };

  const updateAutomation = async (
    capability: EnvironmentAutomationCapability,
    enabled: boolean,
  ): Promise<void> => {
    await runStateUpdate(
      props.callbacks?.setAutomationEnabled?.(capability, enabled) ??
        Promise.resolve(state()),
    );
  };

  const showQuestRewardInput = (questId: number): boolean =>
    state().questRewards[questId] !== undefined ||
    editingQuestRewardId() === questId;

  const editQuestReward = (questId: number): void => {
    setEditingQuestRewardId(questId);
  };

  const commitQuestReward = async (
    questId: number,
    value: string,
  ): Promise<void> => {
    setEditingQuestRewardId(null);
    await updateQuestReward(questId, value);
  };

  const cancelQuestRewardEdit: JSX.EventHandler<
    HTMLInputElement,
    KeyboardEvent
  > = (event) => {
    if (event.key === "Escape") {
      canceledQuestRewardEdit = true;
      setEditingQuestRewardId(null);
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  const updateItemRules = async (
    itemRules: EnvironmentItemRules,
  ): Promise<void> => {
    await runStateUpdate(
      props.callbacks?.setItemRules?.(itemRules) ?? Promise.resolve(state()),
    );
  };

  const toggleItemBucket = async (
    bucket: EnvironmentItemBucket,
    checked: boolean,
  ): Promise<void> => {
    const buckets = new Set(state().itemRules.buckets);
    if (checked) {
      buckets.add(bucket);
    } else {
      buckets.delete(bucket);
    }

    await updateItemRules({
      ...state().itemRules,
      buckets: EnvironmentItemBuckets.filter((value) => buckets.has(value)),
    });
  };

  const setRejectElse = async (rejectElse: boolean): Promise<void> => {
    await updateItemRules({
      ...state().itemRules,
      rejectElse,
    });
  };

  const addItems = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const items = splitEnvironmentBulkInput(itemInput());
    setItemInput("");
    if (items.length > 0) {
      await runStateUpdate(
        props.callbacks?.addItems?.(items) ?? Promise.resolve(state()),
      );
    }
  };

  const addBoosts = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const boosts = splitEnvironmentBulkInput(boostInput());
    setBoostInput("");
    if (boosts.length > 0) {
      await runStateUpdate(
        props.callbacks?.addBoosts?.(boosts) ?? Promise.resolve(state()),
      );
    }
  };

  const resetBankBoostDialog = (): void => {
    setBankBoostDialogOpen(false);
    setBankBoosts([]);
    setSelectedBankBoostIds(new Set<number>());
  };

  const toggleBankBoost = (itemId: number, selected: boolean): void => {
    setSelectedBankBoostIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(itemId);
      } else {
        next.delete(itemId);
      }
      return next;
    });
  };

  const fetchBoosts = async (): Promise<void> => {
    setFetchingBoosts(true);
    setError("");
    resetBankBoostDialog();
    try {
      const discovery = await (props.callbacks?.fetchBoosts?.() ??
        Promise.resolve({ bank: [], bankLoaded: true, inventory: [] }));
      let nextState = state();
      if (discovery.inventory.length > 0) {
        nextState =
          (await runStateUpdate(
            props.callbacks?.addBoosts?.(discovery.inventory) ??
              Promise.resolve(state()),
          )) ?? nextState;
      }

      const candidates = prepareEnvironmentBankBoosts(
        discovery.bank,
        nextState.boosts,
      );
      if (candidates.length > 0) {
        setBankBoosts(candidates);
        setBankBoostDialogOpen(true);
      }
      if (!discovery.bankLoaded) {
        setError(
          (current) =>
            current ||
            "Inventory boosts were fetched, but the bank could not be searched.",
        );
      }
    } catch (cause) {
      console.error("Failed to fetch boosts:", cause);
      setError(
        cause instanceof Error ? cause.message : "Failed to fetch boosts",
      );
    } finally {
      setFetchingBoosts(false);
    }
  };

  const withdrawSelectedBankBoosts = async (): Promise<void> => {
    const selectedIds = selectedBankBoostIds();
    const selected = bankBoosts().filter((boost) =>
      selectedIds.has(boost.itemId),
    );
    if (selected.length === 0) {
      return;
    }

    resetBankBoostDialog();
    setWithdrawingBoosts(true);
    setError("");
    try {
      const withdrawnItemIds = await (props.callbacks?.withdrawBoosts?.(
        selected.map((boost) => boost.itemId),
      ) ?? Promise.resolve([]));
      const selectedItemIds = new Set(selected.map((boost) => boost.itemId));
      const withdrawn = new Set(
        withdrawnItemIds.filter((itemId) => selectedItemIds.has(itemId)),
      );
      const names = selected
        .filter((boost) => withdrawn.has(boost.itemId))
        .map((boost) => boost.name);
      if (names.length > 0) {
        await runStateUpdate(
          props.callbacks?.addBoosts?.(names) ?? Promise.resolve(state()),
        );
      }

      const summary = environmentBoostWithdrawalSummary(
        selected.length,
        withdrawn.size,
      );
      if (summary !== "") {
        setError((current) => (current ? `${current} ${summary}` : summary));
      }
    } catch (cause) {
      console.error("Failed to withdraw boosts:", cause);
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to withdraw selected boosts",
      );
    } finally {
      setWithdrawingBoosts(false);
    }
  };

  const syncToAll = async (): Promise<void> => {
    setSyncing(true);
    try {
      await runStateUpdate(
        props.callbacks?.syncToAll?.() ?? Promise.resolve(state()),
      );
    } finally {
      setSyncing(false);
    }
  };

  onMount(() => {
    const unsubscribe = props.callbacks?.onStateChanged?.(setState);
    if (unsubscribe !== undefined) {
      onCleanup(unsubscribe);
    }

    if (props.callbacks?.getState !== undefined) {
      void props.callbacks
        .getState()
        .then(setState)
        .catch((cause: unknown) => {
          console.error("Failed to load environment state:", cause);
          setError("Failed to load environment state");
        });
    }
  });

  const [filter, setFilter] = createSignal<EnvironmentFilter>("all");
  const showsSection = (section: EnvironmentSection): boolean =>
    filter() === "all" || filter() === section;

  const soundEnabled = (item: string): boolean =>
    state().itemNotificationNames.some(
      (name) => name.toLowerCase() === item.toLowerCase(),
    );

  const update = (request: Promise<EnvironmentState> | undefined): void => {
    void runStateUpdate(request ?? Promise.resolve(state()));
  };

  const questRewardEditor = (questId: number): JSX.Element => (
    <>
      <PillButton
        type="button"
        class="environment-quest-id-button"
        aria-label={`Edit reward item ID for quest ${questId}`}
        title="Double-click to set reward item ID"
        onDblClick={() => editQuestReward(questId)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            editQuestReward(questId);
          }
        }}
      >
        {questId}
      </PillButton>
      <Show when={showQuestRewardInput(questId)}>
        <span class="environment-quest-separator">:</span>
        <Input
          ref={(element) => questRewardInputs.set(questId, element)}
          class="environment-reward-input"
          unstyled
          value={state().questRewards[questId] ?? ""}
          placeholder="itemID"
          inputmode="numeric"
          aria-label={`Reward item ID for quest ${questId}`}
          style={{
            width: rewardInputWidth(
              String(state().questRewards[questId] ?? ""),
            ),
          }}
          onInput={(event) => {
            event.currentTarget.style.width = rewardInputWidth(
              event.currentTarget.value,
            );
          }}
          onKeyDown={(event) => cancelQuestRewardEdit(event)}
          onBlur={(event) => {
            if (canceledQuestRewardEdit) {
              canceledQuestRewardEdit = false;
              return;
            }

            void commitQuestReward(questId, event.currentTarget.value);
          }}
        />
      </Show>
    </>
  );

  return (
    <div class="standalone-window environment-root">
      <header class="standalone-window__header environment-header">
        <div class="environment-filter" role="group" aria-label="Show sections">
          <FilterPill
            label="All"
            count={totalCount()}
            pressed={filter() === "all"}
            onSelect={() => setFilter("all")}
          />
          <FilterPill
            label="Drops"
            count={state().itemNames.length}
            pressed={filter() === "drops"}
            onSelect={() => setFilter("drops")}
          />
          <FilterPill
            label="Quests"
            count={state().questIds.length}
            pressed={filter() === "quests"}
            onSelect={() => setFilter("quests")}
          />
          <FilterPill
            label="Boosts"
            count={state().boosts.length}
            pressed={filter() === "boosts"}
            onSelect={() => setFilter("boosts")}
          />
        </div>
        <div class="standalone-window__header-actions">
          <TooltipButton>
            <TooltipButtonTrigger
              variant="outline"
              size="sm"
              disabled={clearingAll() || totalCount() === 0}
              onClick={() => setClearDialogOpen(true)}
            >
              Clear current
            </TooltipButtonTrigger>
            <TooltipButtonContent>
              Remove every registered quest, item, and boost from this
              Environment.
            </TooltipButtonContent>
          </TooltipButton>
          <TooltipButton>
            <TooltipButtonTrigger
              class="environment-sync-action"
              variant="default"
              size="sm"
              aria-busy={syncing()}
              aria-label={syncing() ? "Applying to all" : "Apply to all"}
              disabled={syncing()}
              onClick={() => setApplyDialogOpen(true)}
            >
              {syncing() ? "Applying…" : "Apply to all"}
            </TooltipButtonTrigger>
            <TooltipButtonContent>
              Copy this Environment's settings and lists to every other
              Environment, replacing what's already there.
            </TooltipButtonContent>
          </TooltipButton>
        </div>
      </header>

      <Show when={error()}>
        {(message) => (
          <Alert class="environment-error" variant="error">
            <AlertDescription class="environment-error__message">
              <Icon icon="circle_alert" aria-hidden="true" />
              <span>{message()}</span>
            </AlertDescription>
          </Alert>
        )}
      </Show>

      <div class="environment-sheet">
        <Show when={showsSection("drops")}>
          <SheetSection
            id="drops"
            title="Drops"
            count={state().itemNames.length}
            actions={
              <>
                <ClearButton
                  label="drops"
                  disabled={state().itemNames.length === 0}
                  onClick={() => update(props.callbacks?.clearItems?.())}
                />
                <AutomationSwitch
                  label="drops"
                  checked={state().automation.drops}
                  onChange={(enabled) =>
                    void updateAutomation("drops", enabled)
                  }
                />
              </>
            }
          >
            <RuleGroup
              id="environment-drop-rules"
              label={
                <>
                  Also accept
                  <HelpTooltip
                    aria-label="About the unlisted drop policy"
                    tooltip='Listed drops and drops in selected categories are accepted. Others are ignored unless "Reject others" is on.'
                  />
                </>
              }
            >
              <For each={EnvironmentItemBuckets}>
                {(bucket) => (
                  <TogglePill
                    pressed={state().itemRules.buckets.includes(bucket)}
                    onChange={(pressed) =>
                      void toggleItemBucket(bucket, pressed)
                    }
                  >
                    {bucketLabels[bucket]}
                  </TogglePill>
                )}
              </For>
              <TogglePill
                tone="destructive"
                pressed={state().itemRules.rejectElse}
                onChange={(pressed) => void setRejectElse(pressed)}
              >
                Reject others
              </TogglePill>
            </RuleGroup>
            <EntryForm
              label="Add drop"
              placeholder="Item name; another item"
              value={itemInput()}
              onInput={setItemInput}
              onSubmit={(event) => void addItems(event)}
            />
            <ul class="environment-tags">
              <For
                each={state().itemNames}
                fallback={
                  <EmptyTags>No drops yet. Add item names above.</EmptyTags>
                }
              >
                {(item) => (
                  <li class="environment-tag">
                    <span class="environment-tag__label" title={item}>
                      {item}
                    </span>
                    <SoundToggle
                      item={item}
                      enabled={soundEnabled(item)}
                      onToggle={() =>
                        update(
                          props.callbacks?.setItemNotification?.(
                            item,
                            !soundEnabled(item),
                          ),
                        )
                      }
                    />
                    <RemoveButton
                      label={`Remove ${item}`}
                      onClick={() =>
                        update(props.callbacks?.removeItem?.(item))
                      }
                    />
                  </li>
                )}
              </For>
            </ul>
          </SheetSection>
        </Show>

        <Show when={showsSection("quests")}>
          <SheetSection
            id="quests"
            title="Quests"
            count={state().questIds.length}
            actions={
              <>
                <ClearButton
                  label="quests"
                  disabled={state().questIds.length === 0}
                  onClick={() => update(props.callbacks?.clearQuests?.())}
                />
                <AutomationSwitch
                  label="quests"
                  checked={state().automation.quests}
                  onChange={(enabled) =>
                    void updateAutomation("quests", enabled)
                  }
                />
              </>
            }
          >
            <RuleGroup id="environment-quest-rules" label="Auto register">
              <TogglePill
                pressed={state().questAutoRegister.rewards}
                onChange={(pressed) =>
                  void setQuestAutoRegisterOption("rewards", pressed)
                }
              >
                Rewards
              </TogglePill>
              <TogglePill
                pressed={state().questAutoRegister.requirements}
                onChange={(pressed) =>
                  void setQuestAutoRegisterOption("requirements", pressed)
                }
              >
                Requirements
              </TogglePill>
            </RuleGroup>
            <EntryForm
              label="Add quest"
              placeholder="Quest ID; quest:itemID"
              value={questInput()}
              onInput={setQuestInput}
              onSubmit={(event) => void addQuests(event)}
            />
            <ul class="environment-tags">
              <For
                each={state().questIds}
                fallback={
                  <EmptyTags>No quests yet. Add quest IDs above.</EmptyTags>
                }
              >
                {(questId) => (
                  <li class="environment-tag environment-tag--quest">
                    {questRewardEditor(questId)}
                    <RemoveButton
                      label={`Remove quest ${questId}`}
                      onClick={() =>
                        update(props.callbacks?.removeQuest?.(questId))
                      }
                    />
                  </li>
                )}
              </For>
            </ul>
          </SheetSection>
        </Show>

        <Show when={showsSection("boosts")}>
          <SheetSection
            id="boosts"
            title="Boosts"
            count={state().boosts.length}
            actions={
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  class="environment-fetch-boosts"
                  title="Add boosts from your inventory and choose any from your bank"
                  aria-busy={fetchingBoosts() || withdrawingBoosts()}
                  disabled={fetchingBoosts() || withdrawingBoosts()}
                  onClick={() => void fetchBoosts()}
                >
                  {withdrawingBoosts()
                    ? "Withdrawing…"
                    : fetchingBoosts()
                      ? "Fetching…"
                      : "Fetch"}
                </Button>
                <ClearButton
                  label="boosts"
                  disabled={state().boosts.length === 0}
                  onClick={() => update(props.callbacks?.clearBoosts?.())}
                />
                <AutomationSwitch
                  label="boosts"
                  checked={state().automation.boosts}
                  onChange={(enabled) =>
                    void updateAutomation("boosts", enabled)
                  }
                />
              </>
            }
          >
            <EntryForm
              label="Add boost"
              placeholder="Boost name; another boost"
              value={boostInput()}
              onInput={setBoostInput}
              onSubmit={(event) => void addBoosts(event)}
            />
            <ul class="environment-tags">
              <For
                each={state().boosts}
                fallback={
                  <EmptyTags>No boosts yet. Add names or fetch them.</EmptyTags>
                }
              >
                {(boost) => (
                  <li class="environment-tag">
                    <span class="environment-tag__label" title={boost}>
                      {boost}
                    </span>
                    <RemoveButton
                      label={`Remove ${boost}`}
                      onClick={() =>
                        update(props.callbacks?.removeBoost?.(boost))
                      }
                    />
                  </li>
                )}
              </For>
            </ul>
          </SheetSection>
        </Show>
      </div>

      <AlertDialog
        open={clearDialogOpen()}
        onOpenChange={(details) => setClearDialogOpen(details.open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this Environment?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every registered quest, item, and boost from this
              Environment. Your settings won't change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void clearAll()}
            >
              Clear Environment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={applyDialogOpen()}
        onOpenChange={(details) => setApplyDialogOpen(details.open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply to all Environments?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces every other Environment's settings and lists with
              this Environment's current configuration. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void syncToAll()}
            >
              Apply to all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={bankBoostDialogOpen()}
        onOpenChange={(details) => {
          if (!details.open) {
            resetBankBoostDialog();
          }
        }}
      >
        <AlertDialogContent class="environment-bank-boost-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Bank boosts</AlertDialogTitle>
            <AlertDialogDescription>
              Choose boosts to move to your inventory.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div class="environment-bank-boost-body">
            <div class="environment-bank-boost-list">
              <For each={bankBoosts()}>
                {(boost) => (
                  <Checkbox
                    class="environment-bank-boost-option"
                    checked={selectedBankBoostIds().has(boost.itemId)}
                    onChange={(event) =>
                      toggleBankBoost(boost.itemId, event.currentTarget.checked)
                    }
                  >
                    <span class="environment-bank-boost-option__content">
                      <span class="environment-bank-boost-option__name">
                        <span class="environment-bank-boost-option__quantity">
                          {boost.quantity.toLocaleString()}×
                        </span>
                        <span class="environment-bank-boost-option__label">
                          {boost.name}
                        </span>
                      </span>
                      <Show when={boost.alreadyAdded}>
                        <span class="environment-bank-boost-option__meta">
                          Already added
                        </span>
                      </Show>
                    </span>
                  </Checkbox>
                )}
              </For>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              disabled={selectedBankBoostIds().size === 0}
              onClick={() => void withdrawSelectedBankBoosts()}
            >
              Withdraw selected
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function App(): JSX.Element {
  const environment = selectDesktopBridge(
    window.desktop,
    "environment",
  ).environment;

  return (
    <EnvironmentView
      callbacks={{
        addBoosts: (names) => environment.addBoosts(names),
        addItems: (names) => environment.addItems(names),
        addQuests: (quests) => environment.addQuests(quests),
        clear: () => environment.clear(),
        clearBoosts: () => environment.clearBoosts(),
        clearItems: () => environment.clearItems(),
        clearQuestReward: (questId) => environment.clearQuestReward(questId),
        clearQuests: () => environment.clearQuests(),
        fetchBoosts: () => environment.fetchBoosts(),
        getState: () => environment.getState(),
        onStateChanged: (listener) => environment.onChanged(listener),
        removeBoost: (name) => environment.removeBoost(name),
        removeItem: (name) => environment.removeItem(name),
        removeQuest: (questId) => environment.removeQuest(questId),
        setAutomationEnabled: (capability, enabled) =>
          environment.setAutomationEnabled(capability, enabled),
        setItemNotification: (name, enabled) =>
          environment.setItemNotification(name, enabled),
        setItemRules: (rules) => environment.setItemRules(rules),
        setQuestAutoRegister: (options) =>
          environment.setQuestAutoRegister(options),
        setQuestReward: (questId, rewardItemId) =>
          environment.setQuestReward(questId, rewardItemId),
        syncToAll: () => environment.syncToAll(),
        withdrawBoosts: (itemIds) => environment.withdrawBoosts(itemIds),
      }}
      fixture={{ state: createEmptyEnvironmentState() }}
    />
  );
}
