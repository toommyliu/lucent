import {
  Icon,
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  type ButtonProps,
  Card,
  CardContent,
  CardFrame,
  CardFrameAction,
  CardFrameHeader,
  CardFrameTitle,
  Checkbox,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TooltipButton,
  TooltipButtonContent,
  TooltipButtonTrigger,
  TooltipIconButton,
} from "@lucent/ui";
import {
  For,
  Index,
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
  DEFAULT_COMBAT_PROFILE_DELAY_MS,
  DEFAULT_COMBAT_PROFILE_LIBRARY,
  DEFAULT_COMBAT_PROFILE_ROLE,
  duplicateCombatProfile,
  type CombatProfile,
  type CombatProfileMessageTrigger,
  type CombatProfileMessageTriggerDefinition,
  type CombatProfileMessageTriggerSource,
  type CombatProfileCondition,
  type CombatProfileCooldownMode,
  type CombatProfileDefinition,
  type CombatProfileLibrary,
  type CombatProfileStep,
  type CombatProfileStepDefinition,
} from "@lucent/core/combatProfiles";
import { selectDesktopBridge } from "../../../shared/desktopBridge";
import {
  readStoredCombatProfileId,
  resolvePreferredCombatProfileId,
  writeStoredCombatProfileId,
} from "./profileSelection";
import { createRandomId } from "../../../shared/randomId";

export interface CombatProfilesViewFixture {
  readonly error?: string;
  readonly library: CombatProfileLibrary;
  readonly selectedProfileId?: string;
}

export interface CombatProfilesViewProps {
  readonly fixture: CombatProfilesViewFixture;
  readonly getLibrary?: () => Promise<CombatProfileLibrary>;
  readonly onCopyText: (text: string) => Promise<void>;
  readonly onDeleteProfile?: (
    profileId: string,
  ) => Promise<CombatProfileLibrary>;
  readonly onLibraryChanged?: (
    listener: (library: CombatProfileLibrary) => void,
  ) => () => void;
  readonly onSaveProfile?: (
    profile: CombatProfile,
  ) => Promise<CombatProfileLibrary>;
}

type ConditionType = CombatProfileCondition["type"];

const conditionTypes = [
  { value: "self-hp", label: "Self HP" },
  { value: "self-mp", label: "Self MP" },
  { value: "ally-hp", label: "Any player HP" },
  { value: "self-aura", label: "Self aura" },
  { value: "target-aura", label: "Target aura" },
] as const satisfies readonly {
  readonly value: ConditionType;
  readonly label: string;
}[];

const skillIndices = [0, 1, 2, 3, 4, 5] as const;

const cooldownModeOptions = [
  { value: "use-if-ready", label: "Use if ready" },
  { value: "wait-for-cooldown", label: "Wait for cooldown" },
] as const satisfies readonly {
  readonly value: CombatProfileCooldownMode;
  readonly label: string;
}[];

const stepCooldownModeOptions = [
  { value: "default", label: "Use profile default" },
  { value: "use-if-ready", label: "Skip if unavailable" },
  { value: "wait-for-cooldown", label: "Wait for cooldown" },
] as const;

const messageTriggerSourceOptions = [
  { value: "any", label: "Any" },
  { value: "animation", label: "Animation" },
  { value: "aura", label: "Aura" },
] as const satisfies readonly {
  readonly value: CombatProfileMessageTriggerSource;
  readonly label: string;
}[];

const jsIdentifierPattern = /^[A-Za-z_$][\w$]*$/u;

const isCombatProfileCooldownMode = (
  value: string | undefined,
): value is CombatProfileCooldownMode =>
  value === "use-if-ready" || value === "wait-for-cooldown";

const isMessageTriggerSource = (
  value: string | undefined,
): value is CombatProfileMessageTriggerSource =>
  value === "any" || value === "animation" || value === "aura";

const isStatCondition = (
  condition: CombatProfileCondition,
): condition is Extract<
  CombatProfileCondition,
  { readonly type: "self-hp" | "self-mp" | "ally-hp" }
> =>
  condition.type === "self-hp" ||
  condition.type === "self-mp" ||
  condition.type === "ally-hp";

const auraNameValue = (condition: CombatProfileCondition): string =>
  isStatCondition(condition) ? "" : condition.auraName;

const conditionUnitValue = (condition: CombatProfileCondition): string =>
  isStatCondition(condition) ? condition.unit : "percent";

const createCondition = (type: ConditionType): CombatProfileCondition => {
  if (type === "self-aura" || type === "target-aura") {
    return {
      type,
      auraName: "",
      op: ">=",
      value: 1,
    };
  }

  return {
    type,
    op: "<=",
    value: type === "self-mp" ? 20 : 50,
    unit: "percent",
  };
};

const clampRuleValue = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const conditionLabel = (condition: CombatProfileCondition): string => {
  switch (condition.type) {
    case "self-hp":
      return `HP ${condition.op} ${condition.value}${condition.unit === "percent" ? "%" : ""}`;
    case "self-mp":
      return `MP ${condition.op} ${condition.value}${condition.unit === "percent" ? "%" : ""}`;
    case "ally-hp":
      return `Any player HP ${condition.op} ${condition.value}${condition.unit === "percent" ? "%" : ""}`;
    case "self-aura":
      return `Self ${condition.auraName} ${condition.op} ${condition.value}`;
    case "target-aura":
      return `Target ${condition.auraName} ${condition.op} ${condition.value}`;
  }
};

const formatJsPropertyName = (key: string): string =>
  jsIdentifierPattern.test(key) ? key : JSON.stringify(key);

const formatJsLiteral = (value: unknown, depth = 0): string => {
  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    return `[\n${value
      .map((item) => `${childIndent}${formatJsLiteral(item, depth + 1)}`)
      .join(",\n")}\n${indent}]`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).filter(
      ([, entryValue]) => entryValue !== undefined,
    );
    if (entries.length === 0) {
      return "{}";
    }

    return `{\n${entries
      .map(
        ([key, entryValue]) =>
          `${childIndent}${formatJsPropertyName(key)}: ${formatJsLiteral(
            entryValue,
            depth + 1,
          )}`,
      )
      .join(",\n")}\n${indent}}`;
  }

  return JSON.stringify(value) ?? "undefined";
};

const toScriptProfileStep = (
  step: CombatProfileStep,
): CombatProfileStepDefinition => ({
  skill: step.skill,
  conditions: step.conditions.map((condition) => ({ ...condition })),
  ...(step.priority === true ? { priority: true } : {}),
  ...(step.cooldownMode === undefined
    ? {}
    : { cooldownMode: step.cooldownMode }),
  ...(step.waitMs === undefined ? {} : { waitMs: step.waitMs }),
});

const toScriptMessageTrigger = (
  trigger: CombatProfileMessageTrigger,
): CombatProfileMessageTriggerDefinition => ({
  messageIncludes: trigger.messageIncludes,
  skill: trigger.skill,
  source: trigger.source,
  ...(trigger.cooldownMs === undefined
    ? {}
    : { cooldownMs: trigger.cooldownMs }),
});

const toScriptProfileDefinition = (
  profile: CombatProfile,
): CombatProfileDefinition => {
  const messageTriggers =
    profile.messageTriggers === undefined ||
    profile.messageTriggers.length === 0
      ? undefined
      : profile.messageTriggers.map(toScriptMessageTrigger);

  return {
    delayMs: profile.delayMs,
    cooldownMode: profile.cooldownMode,
    ...(profile.consumable === undefined
      ? {}
      : { consumable: profile.consumable }),
    ...(profile.resetSkillIndexOnTargetDeath === true
      ? { resetSkillIndexOnTargetDeath: true }
      : {}),
    steps: profile.steps.map(toScriptProfileStep),
    ...(messageTriggers === undefined ? {} : { messageTriggers }),
  };
};

const formatCombatProfileScriptProperty = (profile: CombatProfile): string =>
  `profile: ${formatJsLiteral(toScriptProfileDefinition(profile))}`;

function CombatProfilesLabelHelp(props: {
  readonly label: string;
  readonly tooltip: string;
}): JSX.Element {
  return (
    <span class="combat-profiles-label-help">
      <span>{props.label}</span>
      <TooltipIconButton
        aria-label={`${props.label} help`}
        class="combat-profiles-help-button"
        size="icon-sm"
        tooltip={props.tooltip}
      >
        <Icon icon="help_circle" class="button__icon" />
      </TooltipIconButton>
    </span>
  );
}

/** Renders the Combat Profiles editor from a typed library fixture. */
export function CombatProfilesView(
  props: CombatProfilesViewProps,
): JSX.Element {
  const [library, setLibrary] = createSignal<CombatProfileLibrary>(
    props.fixture.library,
  );
  const [selectedId, setSelectedId] = createSignal(
    props.fixture.selectedProfileId ??
      readStoredCombatProfileId() ??
      DEFAULT_COMBAT_PROFILE_ID,
  );
  const [label, setLabel] = createSignal("Generic");
  const [className, setClassName] = createSignal("");
  const [consumable, setConsumable] = createSignal("");
  const [role, setRole] = createSignal(DEFAULT_COMBAT_PROFILE_ROLE);
  const [delayMs, setDelayMs] = createSignal(
    String(DEFAULT_COMBAT_PROFILE_DELAY_MS),
  );
  const [cooldownMode, setCooldownMode] =
    createSignal<CombatProfileCooldownMode>("use-if-ready");
  const [resetSkillIndexOnTargetDeath, setResetSkillIndexOnTargetDeath] =
    createSignal(false);
  const [draftSteps, setDraftSteps] = createSignal<
    readonly CombatProfileStep[]
  >(DEFAULT_COMBAT_PROFILE_LIBRARY.profiles[0]?.steps ?? []);
  const [draftMessageTriggers, setDraftMessageTriggers] = createSignal<
    readonly CombatProfileMessageTrigger[]
  >(DEFAULT_COMBAT_PROFILE_LIBRARY.profiles[0]?.messageTriggers ?? []);
  const [saving, setSaving] = createSignal(false);
  const [profileCopied, setProfileCopied] = createSignal(false);
  const [error, setError] = createSignal(props.fixture.error ?? "");
  let nameInput: HTMLInputElement | undefined;
  let hydratedProfileId = "";
  let profileCopiedTimer: number | undefined;

  const selectedProfile = createMemo(
    () =>
      library().profiles.find((profile) => profile.id === selectedId()) ??
      library().profiles[0],
  );
  const selectedProfileLabel = createMemo(
    () => selectedProfile()?.label ?? selectedId() ?? "",
  );
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
  const selectProfile = (profileId: string): void => {
    setSelectedId(profileId);
    writeStoredCombatProfileId(profileId);
  };

  const focusNameInput = (): void => {
    window.requestAnimationFrame(() => {
      nameInput?.focus();
      nameInput?.select();
    });
  };

  const markProfileCopied = (): void => {
    if (profileCopiedTimer !== undefined) {
      window.clearTimeout(profileCopiedTimer);
    }

    setProfileCopied(true);
    profileCopiedTimer = window.setTimeout(() => {
      setProfileCopied(false);
      profileCopiedTimer = undefined;
    }, 900);
  };

  const hydrateProfileDraft = (profile: CombatProfile): void => {
    hydratedProfileId = profile.id;
    setLabel(profile.label);
    setClassName(profile.className ?? "");
    setConsumable(profile.consumable ?? "");
    setRole(profile.role);
    setDelayMs(String(profile.delayMs));
    setCooldownMode(profile.cooldownMode);
    setResetSkillIndexOnTargetDeath(
      profile.resetSkillIndexOnTargetDeath === true,
    );
    setDraftSteps(profile.steps.map((step) => Object.assign({}, step)));
    setDraftMessageTriggers(
      (profile.messageTriggers ?? []).map((trigger) =>
        Object.assign({}, trigger),
      ),
    );
  };

  createEffect(() => {
    const profile = selectedProfile();
    if (!profile) {
      return;
    }

    if (profile.id === hydratedProfileId) {
      return;
    }

    hydrateProfileDraft(profile);
  });

  onMount(() => {
    const unsubscribe = props.onLibraryChanged?.((nextLibrary) => {
      setLibrary(nextLibrary);
      if (
        !nextLibrary.profiles.some((profile) => profile.id === selectedId())
      ) {
        selectProfile(
          resolvePreferredCombatProfileId(
            nextLibrary.profiles,
            readStoredCombatProfileId(),
          ),
        );
      }
    });

    if (props.getLibrary !== undefined) {
      void props
        .getLibrary()
        .then((nextLibrary) => {
          setLibrary(nextLibrary);
          selectProfile(
            resolvePreferredCombatProfileId(
              nextLibrary.profiles,
              readStoredCombatProfileId(),
            ),
          );
        })
        .catch((cause: unknown) => {
          console.error("Failed to load combat profiles:", cause);
          setError("Failed to load profiles");
        });
    }

    if (unsubscribe !== undefined) {
      onCleanup(unsubscribe);
    }
  });

  onCleanup(() => {
    if (profileCopiedTimer !== undefined) {
      window.clearTimeout(profileCopiedTimer);
    }
  });

  const runUpdate = async (
    update: Promise<CombatProfileLibrary>,
  ): Promise<CombatProfileLibrary | null> => {
    setSaving(true);
    setError("");
    try {
      const nextLibrary = await update;
      setLibrary(nextLibrary);
      return nextLibrary;
    } catch (cause) {
      console.error("Combat profile update failed:", cause);
      setError(cause instanceof Error ? cause.message : "Update failed");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const buildSelectedProfileDraft = (): CombatProfile | null => {
    const profile = selectedProfile();
    if (!profile) {
      return null;
    }

    const parsedDelay = Number.parseInt(delayMs(), 10);
    const trimmedClassName = className().trim();
    const trimmedConsumable = consumable().trim();
    const selectedCooldownMode = cooldownMode();
    const profileWithoutClassName = {
      id: profile.id,
      label: profile.label,
      role: profile.role,
      delayMs: profile.delayMs,
      cooldownMode: selectedCooldownMode,
      ...(resetSkillIndexOnTargetDeath()
        ? { resetSkillIndexOnTargetDeath: true }
        : {}),
      steps: draftSteps().map((step) => {
        if (step.cooldownMode === selectedCooldownMode) {
          const { cooldownMode: _cooldownMode, ...rest } = step;
          return rest;
        }

        return step;
      }),
      messageTriggers: draftMessageTriggers(),
    } satisfies CombatProfile;
    return {
      ...profileWithoutClassName,
      label: label().trim() || profile.label,
      ...(trimmedClassName === "" ? {} : { className: trimmedClassName }),
      ...(trimmedConsumable === "" ? {} : { consumable: trimmedConsumable }),
      role: role().trim() || DEFAULT_COMBAT_PROFILE_ROLE,
      delayMs: Number.isFinite(parsedDelay)
        ? Math.max(0, parsedDelay)
        : profile.delayMs,
    };
  };

  const saveSelected = async (): Promise<void> => {
    if (saving()) {
      return;
    }

    const profile = buildSelectedProfileDraft();
    if (!profile) {
      return;
    }

    const nextLibrary = await runUpdate(
      props.onSaveProfile?.(profile) ?? Promise.resolve(library()),
    );
    const savedProfile = nextLibrary?.profiles.find(
      (candidate) => candidate.id === profile.id,
    );
    if (savedProfile !== undefined) {
      hydrateProfileDraft(savedProfile);
    }
  };

  const copySelectedProfile = async (): Promise<void> => {
    const profile = buildSelectedProfileDraft();
    if (!profile) {
      return;
    }

    try {
      await props.onCopyText(formatCombatProfileScriptProperty(profile));
      setError("");
      markProfileCopied();
    } catch (cause) {
      console.error("Failed to copy combat profile:", cause);
      setError(
        cause instanceof Error
          ? `Copy failed: ${cause.message}`
          : "Copy failed",
      );
    }
  };

  const createProfile = async (): Promise<void> => {
    if (saving()) {
      return;
    }

    const baseLabel = "New Profile";
    const id = createRandomId("profile");
    const profile: CombatProfile = {
      id,
      label: baseLabel,
      role: DEFAULT_COMBAT_PROFILE_ROLE,
      delayMs: DEFAULT_COMBAT_PROFILE_DELAY_MS,
      cooldownMode: "use-if-ready",
      steps: [1, 2, 3, 4].map((skill) => ({
        skill,
        conditions: [],
      })),
      messageTriggers: [],
    };

    const nextLibrary = await runUpdate(
      props.onSaveProfile?.(profile) ?? Promise.resolve(library()),
    );
    if (nextLibrary !== null) {
      selectProfile(id);
    }
  };

  const duplicateSelected = async (): Promise<void> => {
    if (saving()) {
      return;
    }

    const profile = buildSelectedProfileDraft();
    if (!profile) {
      return;
    }

    const duplicate = duplicateCombatProfile(profile, library().profiles, () =>
      createRandomId("profile"),
    );
    const nextLibrary = await runUpdate(
      props.onSaveProfile?.(duplicate) ?? Promise.resolve(library()),
    );
    if (nextLibrary === null) {
      return;
    }

    selectProfile(duplicate.id);
    const savedProfile = nextLibrary.profiles.find(
      (candidate) => candidate.id === duplicate.id,
    );
    if (savedProfile !== undefined) {
      hydrateProfileDraft(savedProfile);
      focusNameInput();
    }
  };

  const deleteSelected = async (): Promise<void> => {
    if (saving()) {
      return;
    }

    const profile = selectedProfile();
    if (!profile || profile.id === DEFAULT_COMBAT_PROFILE_ID) {
      return;
    }

    const nextLibrary = await runUpdate(
      props.onDeleteProfile?.(profile.id) ?? Promise.resolve(library()),
    );
    if (nextLibrary !== null) {
      selectProfile(
        resolvePreferredCombatProfileId(nextLibrary.profiles, undefined),
      );
    }
  };

  const updateStep = (
    stepIndex: number,
    update: (step: CombatProfileStep) => CombatProfileStep,
  ): void => {
    setDraftSteps((steps) =>
      steps.map((step, index) => (index === stepIndex ? update(step) : step)),
    );
  };

  const addStep = (): void => {
    setDraftSteps((steps) => [
      ...steps,
      {
        skill: 1,
        conditions: [],
      },
    ]);
  };

  const removeStep = (stepIndex: number): void => {
    setDraftSteps((steps) => steps.filter((_, index) => index !== stepIndex));
  };

  const moveStep = (stepIndex: number, offset: -1 | 1): void => {
    setDraftSteps((steps) => {
      const destinationIndex = stepIndex + offset;
      if (destinationIndex < 0 || destinationIndex >= steps.length) {
        return steps;
      }

      const reorderedSteps = [...steps];
      [reorderedSteps[stepIndex], reorderedSteps[destinationIndex]] = [
        reorderedSteps[destinationIndex]!,
        reorderedSteps[stepIndex]!,
      ];
      return reorderedSteps;
    });
  };

  const duplicateStep = (stepIndex: number): void => {
    setDraftSteps((steps) => {
      const step = steps[stepIndex];
      if (step === undefined) {
        return steps;
      }

      const duplicate = {
        ...step,
        conditions: step.conditions.map((condition) =>
          Object.assign({}, condition),
        ),
      };
      return [
        ...steps.slice(0, stepIndex + 1),
        duplicate,
        ...steps.slice(stepIndex + 1),
      ];
    });
  };

  const updateStepSkill = (stepIndex: number, skill: number): void => {
    updateStep(stepIndex, (step) => ({
      ...step,
      skill,
    }));
  };

  const updateStepPriority = (stepIndex: number, priority: boolean): void => {
    updateStep(stepIndex, (step) => {
      if (!priority) {
        const { priority: _priority, ...rest } = step;
        return rest;
      }

      return {
        ...step,
        priority: true,
      };
    });
  };

  const updateStepCooldownMode = (
    stepIndex: number,
    mode: CombatProfileCooldownMode | "default",
  ): void => {
    updateStep(stepIndex, (step) => {
      if (mode === "default") {
        const { cooldownMode: _cooldownMode, ...rest } = step;
        return rest;
      }

      return {
        ...step,
        cooldownMode: mode,
      };
    });
  };

  const updateCondition = (
    stepIndex: number,
    conditionIndex: number,
    update: (condition: CombatProfileCondition) => CombatProfileCondition,
  ): void => {
    updateStep(stepIndex, (step) => ({
      ...step,
      conditions: step.conditions.map((condition, index) =>
        index === conditionIndex ? update(condition) : condition,
      ),
    }));
  };

  const addCondition = (stepIndex: number): void => {
    updateStep(stepIndex, (step) => ({
      ...step,
      conditions: [...step.conditions, createCondition("self-hp")],
    }));
  };

  const removeCondition = (stepIndex: number, conditionIndex: number): void => {
    updateStep(stepIndex, (step) => ({
      ...step,
      conditions: step.conditions.filter(
        (_, index) => index !== conditionIndex,
      ),
    }));
  };

  const updateConditionType = (
    stepIndex: number,
    conditionIndex: number,
    type: ConditionType,
  ): void => {
    updateCondition(stepIndex, conditionIndex, () => createCondition(type));
  };

  const updateMessageTrigger = (
    triggerIndex: number,
    update: (
      trigger: CombatProfileMessageTrigger,
    ) => CombatProfileMessageTrigger,
  ): void => {
    setDraftMessageTriggers((triggers) =>
      triggers.map((trigger, index) =>
        index === triggerIndex ? update(trigger) : trigger,
      ),
    );
  };

  const addMessageTrigger = (): void => {
    setDraftMessageTriggers((triggers) => [
      ...triggers,
      {
        messageIncludes: "",
        skill: 5,
        source: "any",
      },
    ]);
  };

  const removeMessageTrigger = (triggerIndex: number): void => {
    setDraftMessageTriggers((triggers) =>
      triggers.filter((_, index) => index !== triggerIndex),
    );
  };

  return (
    <div class="standalone-window">
      <header class="standalone-window__header combat-profiles-toolbar">
        <div class="combat-profiles-profile-dropdown">
          <span>Profile</span>
          <Select
            class="combat-profiles-profile-dropdown__select"
            value={[selectedId()]}
            onValueChange={(details) => {
              const id = details.value[0];
              if (id) {
                selectProfile(id);
              }
            }}
          >
            <SelectTrigger>
              <span
                class="select__value"
                data-placeholder={
                  selectedProfileLabel() === "" ? "" : undefined
                }
              >
                {selectedProfileLabel() || "Profile"}
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
          <Button
            aria-label="Duplicate selected profile"
            class="combat-profiles-duplicate-profile"
            disabled={saving() || selectedProfile() === undefined}
            size="sm"
            variant="outline"
            onClick={() => void duplicateSelected()}
          >
            <Icon icon="files" class="button__icon" />
            <span class="combat-profiles-toolbar-action__label">Duplicate</span>
          </Button>
        </div>

        <div class="standalone-window__header-actions">
          <Button
            aria-label="Create new profile"
            class="combat-profiles-toolbar-action"
            disabled={saving()}
            size="sm"
            variant="secondary"
            onClick={createProfile}
          >
            <Icon
              icon="plus"
              class="button__icon combat-profiles-new-profile__icon"
            />
            <span class="combat-profiles-toolbar-action__label">New</span>
          </Button>
          <Button
            aria-label="Save profile"
            class="combat-profiles-toolbar-action"
            disabled={saving()}
            loading={saving()}
            size="sm"
            onClick={() => void saveSelected()}
          >
            <Icon icon="save" class="button__icon" />
            <span class="combat-profiles-toolbar-action__label">Save</span>
          </Button>
        </div>
      </header>

      <div class="standalone-window__content-frame">
        <main
          class="standalone-window__content combat-profiles-body"
          aria-label="Combat profile controls"
        >
          <section class="combat-profiles-editor">
            <Show when={error()}>
              {(message) => (
                <Alert class="combat-profiles-error" variant="error">
                  <AlertDescription class="combat-profiles-error__message">
                    <Icon icon="circle_alert" aria-hidden="true" />
                    {message()}
                  </AlertDescription>
                </Alert>
              )}
            </Show>

            <CardFrame>
              <CardFrameHeader class="combat-profiles-frame-header">
                <CardFrameTitle>Details</CardFrameTitle>
                <CardFrameAction class="combat-profiles-profile-actions">
                  <TooltipButton>
                    <TooltipButtonTrigger
                      aria-label={
                        profileCopied()
                          ? "Copied profile snippet"
                          : "Copy profile snippet"
                      }
                      class="combat-profiles-copy-profile combat-profiles-frame-action"
                      disabled={selectedProfile() === undefined}
                      size="sm"
                      variant="ghost"
                      onClick={() => void copySelectedProfile()}
                    >
                      <Icon
                        icon={profileCopied() ? "check" : "copy"}
                        class="button__icon"
                      />
                      <span class="combat-profiles-frame-action__label">
                        {profileCopied() ? "Copied" : "Copy snippet"}
                      </span>
                    </TooltipButtonTrigger>
                    <TooltipButtonContent>
                      For <code>combat.kill</code> and related kill APIs.
                    </TooltipButtonContent>
                  </TooltipButton>
                  <AlertDialog>
                    <AlertDialogTrigger
                      asChild={(triggerProps) => (
                        <Button
                          {...(triggerProps({
                            "aria-label": "Delete profile",
                            class:
                              "combat-profiles-profile-delete combat-profiles-frame-action",
                            disabled:
                              saving() ||
                              selectedId() === DEFAULT_COMBAT_PROFILE_ID,
                            size: "sm",
                            variant: "ghost",
                          } as ButtonProps) as ButtonProps)}
                        >
                          <Icon icon="trash_2" class="button__icon" />
                          <span class="combat-profiles-frame-action__label">
                            Delete profile
                          </span>
                        </Button>
                      )}
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete profile</AlertDialogTitle>
                        <AlertDialogDescription>
                          Delete {selectedProfile()?.label ?? "this profile"}?
                          This skill profile will be permanently removed.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={saving()}
                          variant="destructive"
                          onClick={() => void deleteSelected()}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardFrameAction>
              </CardFrameHeader>
              <Card>
                <CardContent class="combat-profiles-form">
                  <Label>
                    <span>Name</span>
                    <Input
                      ref={(element) => {
                        nameInput = element;
                      }}
                      value={label()}
                      onInput={(event) => setLabel(event.currentTarget.value)}
                    />
                  </Label>
                  <Label>
                    <span>Class name</span>
                    <Input
                      placeholder="Any class"
                      value={className()}
                      onInput={(event) =>
                        setClassName(event.currentTarget.value)
                      }
                    />
                  </Label>
                  <Label>
                    <CombatProfilesLabelHelp
                      label="Skill 5 item"
                      tooltip="Equips this inventory item before combat. The first running profile controls preflight equipment."
                    />
                    <Input
                      placeholder="Potent Honor Potion"
                      value={consumable()}
                      onInput={(event) =>
                        setConsumable(event.currentTarget.value)
                      }
                    />
                  </Label>
                  <Label>
                    <span>Role</span>
                    <Input
                      value={role()}
                      onInput={(event) => setRole(event.currentTarget.value)}
                    />
                  </Label>
                  <Label>
                    <span>Delay (ms)</span>
                    <Input
                      min="0"
                      step="1"
                      type="number"
                      value={delayMs()}
                      onInput={(event) => setDelayMs(event.currentTarget.value)}
                    />
                  </Label>
                  <Label>
                    <span>Cooldown mode</span>
                    <Select
                      class="combat-profiles-select"
                      value={[cooldownMode()]}
                      onValueChange={(details) => {
                        const mode = details.value[0];
                        if (isCombatProfileCooldownMode(mode)) {
                          setCooldownMode(mode);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Cooldown mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <For each={cooldownModeOptions}>
                          {(option) => (
                            <SelectItem value={option.value}>
                              {option.label}
                            </SelectItem>
                          )}
                        </For>
                      </SelectContent>
                    </Select>
                  </Label>
                  <div class="combat-profiles-checkbox-field">
                    <Checkbox
                      checked={resetSkillIndexOnTargetDeath()}
                      onChange={(event) =>
                        setResetSkillIndexOnTargetDeath(
                          event.currentTarget.checked,
                        )
                      }
                    >
                      Reset rotation on target death
                    </Checkbox>
                    <TooltipIconButton
                      aria-label="Reset rotation on target death help"
                      class="combat-profiles-help-button"
                      size="icon-sm"
                      tooltip="Restart at the first matching skill when the active target dies."
                    >
                      <Icon icon="help_circle" class="button__icon" />
                    </TooltipIconButton>
                  </div>
                </CardContent>
              </Card>
            </CardFrame>

            <CardFrame>
              <CardFrameHeader class="combat-profiles-frame-header">
                <CardFrameTitle>Message triggers</CardFrameTitle>
                <Button
                  aria-label="Add message trigger"
                  class="combat-profiles-add-skill-button combat-profiles-frame-action"
                  size="sm"
                  variant="ghost"
                  onClick={addMessageTrigger}
                >
                  <Icon icon="plus" class="button__icon" />
                  <span class="combat-profiles-frame-action__label">
                    Trigger
                  </span>
                </Button>
              </CardFrameHeader>
              <Card>
                <CardContent class="combat-profiles-triggers">
                  <Show
                    when={draftMessageTriggers().length > 0}
                    fallback={
                      <Empty class="combat-profiles-empty">
                        <EmptyHeader>
                          <EmptyTitle>No message triggers</EmptyTitle>
                          <EmptyDescription>
                            Add a trigger to cast a skill when a matching
                            message appears.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    }
                  >
                    <Index each={draftMessageTriggers()}>
                      {(trigger, triggerIndex) => (
                        <div class="combat-profiles-trigger">
                          <div class="combat-profiles-trigger__fields">
                            <Label>
                              <span>Message</span>
                              <Input
                                value={trigger().messageIncludes}
                                placeholder="message text"
                                onInput={(event) =>
                                  updateMessageTrigger(
                                    triggerIndex,
                                    (current) => ({
                                      ...current,
                                      messageIncludes:
                                        event.currentTarget.value,
                                    }),
                                  )
                                }
                              />
                            </Label>
                            <Label>
                              <span>Source</span>
                              <Select
                                class="combat-profiles-select combat-profiles-select--source"
                                value={[trigger().source]}
                                onValueChange={(details) =>
                                  updateMessageTrigger(
                                    triggerIndex,
                                    (current) => {
                                      const source = details.value[0];
                                      return isMessageTriggerSource(source)
                                        ? { ...current, source }
                                        : current;
                                    },
                                  )
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Source" />
                                </SelectTrigger>
                                <SelectContent class="combat-profiles-select-content--source">
                                  <For each={messageTriggerSourceOptions}>
                                    {(option) => (
                                      <SelectItem value={option.value}>
                                        {option.label}
                                      </SelectItem>
                                    )}
                                  </For>
                                </SelectContent>
                              </Select>
                            </Label>
                            <Label>
                              <span>Skill</span>
                              <Select
                                class="combat-profiles-select combat-profiles-select--skill"
                                value={[String(trigger().skill)]}
                                onValueChange={(details) =>
                                  updateMessageTrigger(
                                    triggerIndex,
                                    (current) => ({
                                      ...current,
                                      skill: Number.parseInt(
                                        details.value[0] ?? "5",
                                        10,
                                      ),
                                    }),
                                  )
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Skill" />
                                </SelectTrigger>
                                <SelectContent>
                                  <For each={skillIndices}>
                                    {(skill) => (
                                      <SelectItem value={String(skill)}>
                                        {skill}
                                      </SelectItem>
                                    )}
                                  </For>
                                </SelectContent>
                              </Select>
                            </Label>
                            <Label>
                              <CombatProfilesLabelHelp
                                label="Cooldown (ms)"
                                tooltip="Minimum time before this trigger can cast again. Leave empty or 0 to allow every matching message."
                              />
                              <Input
                                min="0"
                                step="1"
                                type="number"
                                value={String(trigger().cooldownMs ?? "")}
                                placeholder="0"
                                onInput={(event) =>
                                  updateMessageTrigger(
                                    triggerIndex,
                                    (current) => {
                                      const raw =
                                        event.currentTarget.value.trim();
                                      if (raw === "") {
                                        const {
                                          cooldownMs: _cooldownMs,
                                          ...rest
                                        } = current;
                                        return rest;
                                      }

                                      const parsed = Number.parseInt(raw, 10);
                                      if (
                                        Number.isFinite(parsed) &&
                                        parsed >= 0
                                      ) {
                                        return {
                                          ...current,
                                          cooldownMs: parsed,
                                        };
                                      }

                                      return current;
                                    },
                                  )
                                }
                              />
                            </Label>
                          </div>
                          <Button
                            class="combat-profiles-item-remove"
                            aria-label="Remove trigger"
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => removeMessageTrigger(triggerIndex)}
                          >
                            <Icon icon="x" class="button__icon" />
                          </Button>
                        </div>
                      )}
                    </Index>
                  </Show>
                </CardContent>
              </Card>
            </CardFrame>

            <CardFrame>
              <CardFrameHeader class="combat-profiles-frame-header">
                <CardFrameTitle>Rotation</CardFrameTitle>
                <Button
                  aria-label="Add rotation skill"
                  class="combat-profiles-add-skill-button combat-profiles-frame-action"
                  size="sm"
                  variant="ghost"
                  onClick={addStep}
                >
                  <Icon icon="plus" class="button__icon" />
                  <span class="combat-profiles-frame-action__label">Skill</span>
                </Button>
              </CardFrameHeader>
              <Card>
                <CardContent class="combat-profiles-steps">
                  <Index
                    each={draftSteps()}
                    fallback={
                      <Empty class="combat-profiles-empty">
                        <EmptyHeader>
                          <EmptyTitle>No rotation skills</EmptyTitle>
                          <EmptyDescription>
                            Add a skill to define this profile&apos;s rotation.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    }
                  >
                    {(step, stepIndex) => (
                      <div class="combat-profiles-step">
                        <div class="combat-profiles-step__header">
                          <Label class="combat-profiles-inline-field">
                            <span>Skill</span>
                            <Select
                              class="combat-profiles-select combat-profiles-select--skill"
                              value={[String(step().skill)]}
                              onValueChange={(details) =>
                                updateStepSkill(
                                  stepIndex,
                                  Number.parseInt(details.value[0] ?? "1", 10),
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Skill" />
                              </SelectTrigger>
                              <SelectContent>
                                <For each={skillIndices}>
                                  {(skill) => (
                                    <SelectItem value={String(skill)}>
                                      {skill}
                                    </SelectItem>
                                  )}
                                </For>
                              </SelectContent>
                            </Select>
                          </Label>
                          <Label class="combat-profiles-inline-field combat-profiles-inline-field--availability">
                            <span>Cooldown</span>
                            <Select
                              class="combat-profiles-select combat-profiles-select--availability"
                              value={[step().cooldownMode ?? "default"]}
                              onValueChange={(details) => {
                                const value = details.value[0];
                                updateStepCooldownMode(
                                  stepIndex,
                                  isCombatProfileCooldownMode(value)
                                    ? value
                                    : "default",
                                );
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Cooldown" />
                              </SelectTrigger>
                              <SelectContent>
                                <For each={stepCooldownModeOptions}>
                                  {(option) => (
                                    <SelectItem value={option.value}>
                                      {option.label}
                                    </SelectItem>
                                  )}
                                </For>
                              </SelectContent>
                            </Select>
                          </Label>
                          <div class="combat-profiles-step__priority">
                            <Checkbox
                              checked={step().priority === true}
                              onChange={(event) =>
                                updateStepPriority(
                                  stepIndex,
                                  event.currentTarget.checked,
                                )
                              }
                            >
                              Priority
                            </Checkbox>
                            <TooltipIconButton
                              aria-label={`Priority skill ${step().skill} help`}
                              class="combat-profiles-help-button"
                              size="icon-sm"
                              tooltip="This skill can interrupt the normal rotation. On the next normal cast, the rotation resumes where it left off."
                            >
                              <Icon icon="help_circle" class="button__icon" />
                            </TooltipIconButton>
                          </div>
                          <div class="combat-profiles-step__actions">
                            <Button
                              aria-label={`Move skill ${step().skill} up`}
                              disabled={stepIndex === 0}
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => moveStep(stepIndex, -1)}
                            >
                              <Icon icon="arrow_up" class="button__icon" />
                            </Button>
                            <Button
                              aria-label={`Move skill ${step().skill} down`}
                              disabled={stepIndex === draftSteps().length - 1}
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => moveStep(stepIndex, 1)}
                            >
                              <Icon icon="arrow_down" class="button__icon" />
                            </Button>
                            <Button
                              aria-label={`Duplicate skill ${step().skill}`}
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => duplicateStep(stepIndex)}
                            >
                              <Icon icon="copy" class="button__icon" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => addCondition(stepIndex)}
                            >
                              <Icon icon="plus" class="button__icon" />
                              Rule
                            </Button>
                            <Button
                              class="combat-profiles-item-remove"
                              aria-label={`Remove skill ${step().skill}`}
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => removeStep(stepIndex)}
                            >
                              <Icon icon="x" class="button__icon" />
                            </Button>
                          </div>
                        </div>
                        <div class="combat-profiles-rules">
                          <Show
                            when={step().conditions.length > 0}
                            fallback={
                              <div class="combat-profiles-empty-rule">
                                This skill has no rules and can run whenever it
                                is ready.
                              </div>
                            }
                          >
                            <Index each={step().conditions}>
                              {(condition, conditionIndex) => (
                                <div class="combat-profiles-rule">
                                  <div
                                    class={
                                      isStatCondition(condition())
                                        ? "combat-profiles-rule__fields combat-profiles-rule__fields--stat"
                                        : "combat-profiles-rule__fields combat-profiles-rule__fields--aura"
                                    }
                                  >
                                    <Label class="combat-profiles-rule-field">
                                      <span>Condition</span>
                                      <Select
                                        class="combat-profiles-select"
                                        value={[condition().type]}
                                        onValueChange={(details) =>
                                          updateConditionType(
                                            stepIndex,
                                            conditionIndex,
                                            (details.value[0] ??
                                              "self-hp") as ConditionType,
                                          )
                                        }
                                      >
                                        <SelectTrigger>
                                          <SelectValue placeholder="Rule type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <For each={conditionTypes}>
                                            {(option) => (
                                              <SelectItem value={option.value}>
                                                {option.label}
                                              </SelectItem>
                                            )}
                                          </For>
                                        </SelectContent>
                                      </Select>
                                    </Label>
                                    <Show when={!isStatCondition(condition())}>
                                      <Label class="combat-profiles-rule-field">
                                        <span>Aura</span>
                                        <Input
                                          placeholder="Aura name"
                                          value={auraNameValue(condition())}
                                          onInput={(event) =>
                                            updateCondition(
                                              stepIndex,
                                              conditionIndex,
                                              (current) =>
                                                isStatCondition(current)
                                                  ? current
                                                  : {
                                                      ...current,
                                                      auraName:
                                                        event.currentTarget
                                                          .value,
                                                    },
                                            )
                                          }
                                        />
                                      </Label>
                                    </Show>
                                    <Label class="combat-profiles-rule-field">
                                      <span>Operator</span>
                                      <Select
                                        class="combat-profiles-select combat-profiles-select--op"
                                        value={[condition().op]}
                                        onValueChange={(details) =>
                                          updateCondition(
                                            stepIndex,
                                            conditionIndex,
                                            (current) => ({
                                              ...current,
                                              op: (details.value[0] ?? "<=") as
                                                | "<="
                                                | ">=",
                                            }),
                                          )
                                        }
                                      >
                                        <SelectTrigger>
                                          <SelectValue placeholder="Op" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="<=">
                                            &lt;=
                                          </SelectItem>
                                          <SelectItem value=">=">
                                            &gt;=
                                          </SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </Label>
                                    <Label class="combat-profiles-rule-field">
                                      <span>Value</span>
                                      <Input
                                        inputMode="numeric"
                                        value={String(condition().value)}
                                        onInput={(event) =>
                                          updateCondition(
                                            stepIndex,
                                            conditionIndex,
                                            (current) => ({
                                              ...current,
                                              value: clampRuleValue(
                                                event.currentTarget.value,
                                              ),
                                            }),
                                          )
                                        }
                                      />
                                    </Label>
                                    <Show when={isStatCondition(condition())}>
                                      <Label class="combat-profiles-rule-field">
                                        <span>Unit</span>
                                        <Select
                                          class="combat-profiles-select combat-profiles-select--unit"
                                          value={[
                                            conditionUnitValue(condition()),
                                          ]}
                                          onValueChange={(details) =>
                                            updateCondition(
                                              stepIndex,
                                              conditionIndex,
                                              (current) =>
                                                isStatCondition(current)
                                                  ? {
                                                      ...current,
                                                      unit: (details.value[0] ??
                                                        "percent") as
                                                        | "percent"
                                                        | "value",
                                                    }
                                                  : current,
                                            )
                                          }
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder="Unit" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="percent">
                                              %
                                            </SelectItem>
                                            <SelectItem value="value">
                                              Value
                                            </SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </Label>
                                    </Show>
                                  </div>
                                  <Button
                                    class="combat-profiles-item-remove"
                                    aria-label={`Remove rule ${conditionLabel(condition())}`}
                                    size="icon-sm"
                                    variant="ghost"
                                    onClick={() =>
                                      removeCondition(stepIndex, conditionIndex)
                                    }
                                  >
                                    <Icon icon="x" class="button__icon" />
                                  </Button>
                                </div>
                              )}
                            </Index>
                          </Show>
                        </div>
                      </div>
                    )}
                  </Index>
                </CardContent>
              </Card>
            </CardFrame>
          </section>
        </main>
      </div>
    </div>
  );
}

/** Connects the fixture-driven Combat Profiles view to the Electron bridge. */
export function App(): JSX.Element {
  const combatProfiles = selectDesktopBridge(
    window.desktop,
    "combat-profiles",
  ).combatProfiles;

  return (
    <CombatProfilesView
      fixture={{ library: DEFAULT_COMBAT_PROFILE_LIBRARY }}
      getLibrary={() => combatProfiles.getState()}
      onCopyText={(text) => navigator.clipboard.writeText(text)}
      onDeleteProfile={(profileId) => combatProfiles.deleteProfile(profileId)}
      onLibraryChanged={(listener) => combatProfiles.onChanged(listener)}
      onSaveProfile={(profile) => combatProfiles.saveProfile(profile)}
    />
  );
}
