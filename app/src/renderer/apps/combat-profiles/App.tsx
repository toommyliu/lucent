import { createHotkey } from "@tanstack/solid-hotkeys";
import {
  formatHotkeyDisplay,
  formatHotkeyDisplayParts,
  type HotkeyDisplayPlatform,
} from "@lucent/core/hotkeys";
import {
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
  Button,
  Checkbox,
  HelpTooltip,
  Icon,
  IconButton,
  type IconName,
  Input,
  type InputProps,
  Kbd,
  KbdGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  type SelectTriggerProps,
  Tooltip,
  TooltipButton,
  TooltipButtonContent,
  TooltipButtonTrigger,
  TooltipContent,
  TooltipIconButton,
  TooltipTrigger,
  VirtualizedSelectContent,
  cn,
} from "@lucent/ui";
import {
  For,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  splitProps,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js";
import {
  DEFAULT_COMBAT_PROFILE_ID,
  DEFAULT_COMBAT_PROFILE_DELAY_MS,
  DEFAULT_COMBAT_PROFILE_LIBRARY,
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
  type SkillSlot,
} from "@lucent/core/combatProfiles";
import { selectDesktopBridge } from "../../../shared/desktopBridge";
import type { DesktopRendererProps } from "../../RendererBootstrap";
import {
  readStoredCombatProfileId,
  resolvePreferredCombatProfileId,
  writeStoredCombatProfileId,
} from "./profileSelection";
import {
  buildCombatProfileOptions,
  resolveCombatProfileOptionValue,
  type CombatProfileOption,
} from "../../combatProfileOptions";

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
  readonly platform: HotkeyDisplayPlatform;
}

const SAVE_PROFILE_HOTKEY = "Mod+S";
const COPY_SNIPPET_HOTKEY = "Mod+C";
const NEW_PROFILE_HOTKEY = "Mod+N";
const DUPLICATE_PROFILE_HOTKEY = "Mod+D";
const SWITCH_PROFILE_HOTKEY = "Mod+P";
const PROFILE_PICKER_TRIGGER_ID = "combat-profiles-picker-trigger";

const skillSlots: readonly SkillSlot[] = [0, 1, 2, 3, 4, 5];

const parseSkillSlot = (value: string | undefined): SkillSlot | undefined =>
  value === undefined
    ? undefined
    : skillSlots.find((slot) => String(slot) === value);

type ConditionType = CombatProfileCondition["type"];
type StatCondition = Extract<
  CombatProfileCondition,
  { readonly type: "self-hp" | "self-mp" | "ally-hp" }
>;

interface ChoiceOption<T extends string> {
  readonly label: string;
  readonly value: T;
}

const conditionTypes = [
  { value: "self-hp", label: "Self HP" },
  { value: "self-mp", label: "Self MP" },
  { value: "ally-hp", label: "Any player HP" },
  { value: "self-aura", label: "Self aura" },
  { value: "target-aura", label: "Target aura" },
] as const satisfies readonly ChoiceOption<ConditionType>[];

const comparisonOptions = [
  { value: "<=", label: "≤" },
  { value: ">=", label: "≥" },
] as const satisfies readonly ChoiceOption<CombatProfileCondition["op"]>[];

const cooldownModeOptions = [
  { value: "use-if-ready", label: "Skip it" },
  { value: "wait-for-cooldown", label: "Wait for it" },
] as const satisfies readonly ChoiceOption<CombatProfileCooldownMode>[];

const messageTriggerSourceOptions = [
  { value: "any", label: "Any" },
  { value: "animation", label: "Animation" },
  { value: "aura", label: "Aura" },
] as const satisfies readonly ChoiceOption<CombatProfileMessageTriggerSource>[];

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
): condition is StatCondition =>
  condition.type === "self-hp" ||
  condition.type === "self-mp" ||
  condition.type === "ally-hp";

const auraNameValue = (condition: CombatProfileCondition): string =>
  isStatCondition(condition) ? "" : condition.auraName;

const conditionUnitValue = (condition: CombatProfileCondition): string =>
  isStatCondition(condition) ? condition.unit : "percent";

const hpUnitOptions = [
  { value: "percent", label: "%" },
  { value: "value", label: "HP" },
] as const satisfies readonly ChoiceOption<StatCondition["unit"]>[];

const mpUnitOptions = [
  { value: "percent", label: "%" },
  { value: "value", label: "MP" },
] as const satisfies readonly ChoiceOption<StatCondition["unit"]>[];

const conditionUnitOptions = (condition: CombatProfileCondition) =>
  condition.type === "self-mp" ? mpUnitOptions : hpUnitOptions;

const choiceLabel = <T extends string>(
  options: readonly ChoiceOption<T>[],
  value: string,
): string => options.find((option) => option.value === value)?.label ?? value;

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

const MAX_DELAY_MS = 60_000;
const MAX_TRIGGER_COOLDOWN_MS = 60_000;
const MAX_NAME_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 160;

const conditionValueMax = (condition: CombatProfileCondition): number => {
  if (!isStatCondition(condition)) {
    return 999;
  }

  return condition.unit === "percent" ? 100 : 999_999;
};

const isAuraNameMissing = (condition: CombatProfileCondition): boolean =>
  !isStatCondition(condition) && condition.auraName.trim() === "";

const wholeNumberIssue = (
  value: number | undefined,
  max: number,
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value)) {
    return "Use whole numbers";
  }

  return value < 0 || value > max ? `Use 0–${max.toLocaleString()}` : undefined;
};

const conditionHasIssue = (condition: CombatProfileCondition): boolean =>
  isAuraNameMissing(condition) ||
  wholeNumberIssue(condition.value, conditionValueMax(condition)) !== undefined;

const triggerHasIssue = (trigger: CombatProfileMessageTrigger): boolean =>
  trigger.messageIncludes.trim() === "" ||
  wholeNumberIssue(trigger.cooldownMs, MAX_TRIGGER_COOLDOWN_MS) !== undefined;

const withSortedKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(withSortedKeys);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, withSortedKeys(entryValue)]),
  );
};

const profileSnapshot = (profile: CombatProfile): string =>
  JSON.stringify(
    withSortedKeys({
      ...profile,
      classNames: profile.classNames ?? [],
      messageTriggers: profile.messageTriggers ?? [],
      resetSkillIndexOnTargetDeath:
        profile.resetSkillIndexOnTargetDeath === true,
      steps: profile.steps.map((step) => ({
        ...step,
        priority: step.priority === true,
      })),
    }),
  );

const appendClassName = (
  classNames: readonly string[],
  value: string,
): readonly string[] => {
  const className = value.trim();
  if (
    className === "" ||
    classNames.some(
      (candidate) =>
        candidate.localeCompare(className, undefined, {
          sensitivity: "accent",
        }) === 0,
    )
  ) {
    return classNames;
  }

  return [...classNames, className];
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

const focusFirstInvalidField = (): void => {
  const field = document.querySelector<HTMLElement>(
    ".combat-profiles-sheet [aria-invalid='true']",
  );
  field?.scrollIntoView({ block: "nearest" });
  field?.focus({ preventScroll: true });
};

function createCombatProfilesController(props: CombatProfilesViewProps) {
  const [library, setLibrary] = createSignal<CombatProfileLibrary>(
    props.fixture.library,
  );
  const [selectedId, setSelectedId] = createSignal(
    props.fixture.selectedProfileId ??
      readStoredCombatProfileId() ??
      DEFAULT_COMBAT_PROFILE_ID,
  );
  const [label, setLabel] = createSignal("Generic");
  const [classNames, setClassNames] = createSignal<readonly string[]>([]);
  const [classNameDraft, setClassNameDraft] = createSignal("");
  const [consumable, setConsumable] = createSignal("");
  const [delayMs, setDelayMs] = createSignal(DEFAULT_COMBAT_PROFILE_DELAY_MS);
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
  const [groupProfiles, setGroupProfiles] = createSignal(false);
  const [selectedOptionValue, setSelectedOptionValue] = createSignal("");
  const [profileCopied, setProfileCopied] = createSignal(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [pendingProfileSwitch, setPendingProfileSwitch] = createSignal<{
    readonly run: () => void;
  }>();
  const [showIssues, setShowIssues] = createSignal(false);
  const [error, setError] = createSignal(props.fixture.error ?? "");
  let nameInput: HTMLInputElement | undefined;
  let classNameInput: HTMLInputElement | undefined;
  let profilePickerTrigger: HTMLButtonElement | undefined;
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
  const isDefaultProfile = createMemo(
    () =>
      (selectedProfile()?.id ?? DEFAULT_COMBAT_PROFILE_ID) ===
      DEFAULT_COMBAT_PROFILE_ID,
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
  const profileSelectItems = createMemo(() =>
    buildCombatProfileOptions(profileOptions(), groupProfiles()),
  );
  const profileSelectValue = createMemo(() =>
    resolveCombatProfileOptionValue(
      profileSelectItems(),
      selectedId() ?? "",
      selectedOptionValue(),
    ),
  );
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
    setClassNames(profile.classNames ?? []);
    setClassNameDraft("");
    setConsumable(profile.consumable ?? "");
    setDelayMs(profile.delayMs);
    setCooldownMode(profile.cooldownMode);
    setResetSkillIndexOnTargetDeath(
      profile.resetSkillIndexOnTargetDeath === true,
    );
    setDraftSteps(profile.steps.map((step) => ({ ...step })));
    setDraftMessageTriggers(
      (profile.messageTriggers ?? []).map((trigger) =>
        Object.assign({}, trigger),
      ),
    );
    setShowIssues(false);
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

  const addClassName = (): void => {
    const draft = classNameDraft().trim();
    if (draft === "") {
      return;
    }

    setClassNames((current) => appendClassName(current, draft));
    setClassNameDraft("");
    classNameInput?.focus();
  };

  const removeClassName = (classNameIndex: number): void => {
    setClassNames((current) =>
      current.filter((_, index) => index !== classNameIndex),
    );
    window.requestAnimationFrame(() => classNameInput?.focus());
  };

  const removeLastClassName = (): void => {
    setClassNames((current) => current.slice(0, -1));
  };

  const draftProfile = createMemo((): CombatProfile | undefined => {
    const profile = selectedProfile();
    if (!profile) {
      return undefined;
    }

    const selectedClassNames = appendClassName(classNames(), classNameDraft());
    const trimmedConsumable = consumable().trim();
    return {
      id: profile.id,
      label: label().trim() || profile.label,
      ...(selectedClassNames.length === 0
        ? {}
        : { classNames: selectedClassNames }),
      ...(trimmedConsumable === "" ? {} : { consumable: trimmedConsumable }),
      delayMs: delayMs(),
      cooldownMode: cooldownMode(),
      ...(resetSkillIndexOnTargetDeath()
        ? { resetSkillIndexOnTargetDeath: true }
        : {}),
      steps: draftSteps(),
      messageTriggers: draftMessageTriggers(),
    };
  });

  const draftSnapshot = createMemo(() => {
    const draft = draftProfile();
    return draft === undefined ? "" : profileSnapshot(draft);
  });

  const hasUnsavedChanges = createMemo(() => {
    const profile = selectedProfile();
    return (
      profile !== undefined && draftSnapshot() !== profileSnapshot(profile)
    );
  });

  const hasIssues = createMemo(
    () =>
      wholeNumberIssue(delayMs(), MAX_DELAY_MS) !== undefined ||
      draftSteps().some((step) => step.conditions.some(conditionHasIssue)) ||
      draftMessageTriggers().some(triggerHasIssue),
  );

  const issueMessage = createMemo(() => {
    if (error() !== "") {
      return error();
    }

    return showIssues() && hasIssues()
      ? "Fix the highlighted fields to save."
      : "";
  });

  const blockOnIssues = (): boolean => {
    if (hasIssues()) {
      setShowIssues(true);
      focusFirstInvalidField();
    }
    return hasIssues();
  };

  const confirmDiscardingChanges = (run: () => void): void => {
    if (hasUnsavedChanges()) {
      setPendingProfileSwitch({ run });
    } else {
      run();
    }
  };

  const discardChangesAndContinue = (): void => {
    const pending = pendingProfileSwitch();
    setPendingProfileSwitch(undefined);
    pending?.run();
  };

  const cancelProfileSwitch = (): void => {
    setPendingProfileSwitch(undefined);
  };

  const selectProfileOption = (option: CombatProfileOption): void => {
    if (option.id === selectedProfile()?.id) {
      setSelectedOptionValue(option.value);
      return;
    }

    confirmDiscardingChanges(() => {
      setSelectedOptionValue(option.value);
      selectProfile(option.id);
    });
  };

  const saveSelected = async (): Promise<void> => {
    const profile = draftProfile();
    if (saving() || !profile || blockOnIssues()) {
      return;
    }

    const snapshotAtSave = draftSnapshot();
    const nextLibrary = await runUpdate(
      props.onSaveProfile?.(profile) ?? Promise.resolve(library()),
    );
    const savedProfile = nextLibrary?.profiles.find(
      (candidate) => candidate.id === profile.id,
    );
    if (savedProfile !== undefined && draftSnapshot() === snapshotAtSave) {
      hydrateProfileDraft(savedProfile);
    }
  };

  const copySelectedProfile = async (): Promise<void> => {
    const profile = draftProfile();
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

  const createProfile = (): void => {
    confirmDiscardingChanges(() => void saveNewProfile());
  };

  const saveNewProfile = async (): Promise<void> => {
    if (saving()) {
      return;
    }

    const baseLabel = "New Profile";
    const id = `profile-${crypto.randomUUID()}`;
    const profile: CombatProfile = {
      id,
      label: baseLabel,
      delayMs: DEFAULT_COMBAT_PROFILE_DELAY_MS,
      cooldownMode: "use-if-ready",
      steps: skillSlots.slice(1, 5).map((skill) => ({
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
      focusNameInput();
    }
  };

  const duplicateSelected = async (): Promise<void> => {
    const profile = draftProfile();
    if (saving() || !profile || blockOnIssues()) {
      return;
    }

    const duplicate = duplicateCombatProfile(
      profile,
      library().profiles,
      () => `profile-${crypto.randomUUID()}`,
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

  const updateStepSkill = (stepIndex: number, skill: SkillSlot): void => {
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

  return {
    addClassName,
    addCondition,
    addMessageTrigger,
    addStep,
    cancelProfileSwitch,
    classNameDraft,
    classNames,
    consumable,
    cooldownMode,
    copySelectedProfile,
    createProfile,
    delayMs,
    deleteDialogOpen,
    deleteSelected,
    discardChangesAndContinue,
    draftMessageTriggers,
    draftSteps,
    duplicateSelected,
    duplicateStep,
    groupProfiles,
    hasUnsavedChanges,
    issueMessage,
    isDefaultProfile,
    label,
    moveStep,
    pendingProfileSwitch,
    profileCopied,
    profileSelectItems,
    profileSelectValue,
    removeClassName,
    removeCondition,
    removeLastClassName,
    removeMessageTrigger,
    removeStep,
    resetSkillIndexOnTargetDeath,
    saveSelected,
    saving,
    selectProfileOption,
    selectedProfile,
    selectedProfileLabel,
    setClassNameDraft,
    setClassNameInput: (element: HTMLInputElement) => {
      classNameInput = element;
    },
    setConsumable,
    setCooldownMode,
    setDelayMs,
    setDeleteDialogOpen,
    setGroupProfiles,
    setLabel,
    setNameInput: (element: HTMLInputElement) => {
      nameInput = element;
    },
    setProfilePickerTrigger: (element: HTMLButtonElement) => {
      profilePickerTrigger = element;
    },
    setResetSkillIndexOnTargetDeath,
    showIssues,
    toggleProfilePicker: () => profilePickerTrigger?.click(),
    updateCondition,
    updateConditionType,
    updateMessageTrigger,
    updateStepCooldownMode,
    updateStepPriority,
    updateStepSkill,
  };
}

type CombatProfilesController = ReturnType<
  typeof createCombatProfilesController
>;

interface ControllerProps {
  readonly controller: CombatProfilesController;
}

interface ShortcutControllerProps extends ControllerProps {
  readonly platform: HotkeyDisplayPlatform;
}

const hasTextSelection = (): boolean => {
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement
  ) {
    return active.selectionStart !== active.selectionEnd;
  }

  return window.getSelection()?.isCollapsed === false;
};

function createCombatProfileHotkeys(c: CombatProfilesController): void {
  const options = {
    conflictBehavior: "replace",
    ignoreInputs: false,
  } as const;
  const ignoreShortcut = (event: KeyboardEvent): boolean =>
    event.repeat ||
    c.deleteDialogOpen() ||
    c.pendingProfileSwitch() !== undefined;

  createHotkey(
    SAVE_PROFILE_HOTKEY,
    (event) => {
      if (!ignoreShortcut(event) && c.hasUnsavedChanges()) {
        void c.saveSelected();
      }
    },
    options,
  );

  createHotkey(
    COPY_SNIPPET_HOTKEY,
    (event) => {
      if (ignoreShortcut(event) || hasTextSelection()) {
        return;
      }

      event.preventDefault();
      void c.copySelectedProfile();
    },
    { ...options, preventDefault: false },
  );

  createHotkey(
    NEW_PROFILE_HOTKEY,
    (event) => {
      if (!ignoreShortcut(event) && !c.saving()) {
        c.createProfile();
      }
    },
    options,
  );

  createHotkey(
    DUPLICATE_PROFILE_HOTKEY,
    (event) => {
      if (!ignoreShortcut(event)) {
        void c.duplicateSelected();
      }
    },
    options,
  );

  createHotkey(
    SWITCH_PROFILE_HOTKEY,
    (event) => {
      if (!ignoreShortcut(event)) {
        c.toggleProfilePicker();
      }
    },
    options,
  );
}

const formatAriaKeyshortcuts = (
  hotkey: string,
  platform: HotkeyDisplayPlatform,
): string => hotkey.replace("Mod", platform === "mac" ? "Meta" : "Control");

function ShortcutHint(props: {
  readonly hotkey: string;
  readonly platform: HotkeyDisplayPlatform;
}): JSX.Element {
  return (
    <KbdGroup aria-label={formatHotkeyDisplay(props.hotkey, props.platform)}>
      <For each={formatHotkeyDisplayParts(props.hotkey, props.platform)}>
        {(part) => <Kbd>{part}</Kbd>}
      </For>
    </KbdGroup>
  );
}

function IssueAlert(props: ControllerProps): JSX.Element {
  return (
    <Show when={props.controller.issueMessage()}>
      {(message) => (
        <Alert class="combat-profiles-issue" variant="error">
          <AlertDescription class="combat-profiles-issue__message">
            <Icon icon="circle_alert" aria-hidden="true" />
            <span>{message()}</span>
          </AlertDescription>
        </Alert>
      )}
    </Show>
  );
}

const profileOptionLabel = (profile: CombatProfileOption): string =>
  profile.group === undefined
    ? profile.label
    : `${profile.label} - ${profile.group}`;

function ProfilePicker(props: ShortcutControllerProps): JSX.Element {
  const c = props.controller;
  const [open, setOpen] = createSignal(false);
  return (
    <Tooltip
      closeDelay={0}
      disabled={open()}
      ids={{ trigger: PROFILE_PICKER_TRIGGER_ID }}
      openDelay={200}
      positioning={{ placement: "top" }}
    >
      <Select
        class="combat-profiles-picker"
        composite={false}
        ids={{ trigger: PROFILE_PICKER_TRIGGER_ID }}
        items={c.profileSelectItems()}
        value={c.profileSelectValue() === "" ? [] : [c.profileSelectValue()]}
        onOpenChange={(details) => setOpen(details.open)}
        onValueChange={(details) => {
          const option = c
            .profileSelectItems()
            .find((item) => item.value === details.value[0]);
          if (option !== undefined) {
            c.selectProfileOption(option);
          }
        }}
      >
        <TooltipTrigger
          asChild={(tooltipTriggerProps) => (
            <SelectTrigger
              {...(tooltipTriggerProps({
                ref: (element: HTMLButtonElement) =>
                  c.setProfilePickerTrigger(element),
                "aria-haspopup": "dialog",
                "aria-keyshortcuts": formatAriaKeyshortcuts(
                  SWITCH_PROFILE_HOTKEY,
                  props.platform,
                ),
                "aria-label": "Profile",
              } as SelectTriggerProps) as SelectTriggerProps)}
            >
              <span
                class="select__value"
                data-placeholder={
                  c.selectedProfileLabel() === "" ? "" : undefined
                }
              >
                {c.selectedProfileLabel() || "Profile"}
              </span>
            </SelectTrigger>
          )}
        />
        <ProfilePickerContent controller={c} />
      </Select>
      <TooltipContent>
        Switch profile{" "}
        <ShortcutHint
          hotkey={SWITCH_PROFILE_HOTKEY}
          platform={props.platform}
        />
      </TooltipContent>
    </Tooltip>
  );
}

function ProfilePickerContent(props: ControllerProps): JSX.Element {
  const c = props.controller;
  return (
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
  );
}

function ProfileActions(props: ShortcutControllerProps): JSX.Element {
  const c = props.controller;
  return (
    <div class="combat-profiles-profile-actions">
      <TooltipIconButton
        aria-keyshortcuts={formatAriaKeyshortcuts(
          NEW_PROFILE_HOTKEY,
          props.platform,
        )}
        aria-label="New profile"
        class="combat-profiles-profile-action"
        disabled={c.saving()}
        size="icon-sm"
        tooltip={
          <>
            New profile{" "}
            <ShortcutHint
              hotkey={NEW_PROFILE_HOTKEY}
              platform={props.platform}
            />
          </>
        }
        variant="ghost"
        onClick={() => c.createProfile()}
      >
        <Icon icon="plus" size="sm" />
      </TooltipIconButton>
      <TooltipIconButton
        aria-keyshortcuts={formatAriaKeyshortcuts(
          DUPLICATE_PROFILE_HOTKEY,
          props.platform,
        )}
        aria-label="Duplicate profile"
        class="combat-profiles-profile-action"
        disabled={c.saving() || c.selectedProfile() === undefined}
        size="icon-sm"
        tooltip={
          <>
            Duplicate{" "}
            <ShortcutHint
              hotkey={DUPLICATE_PROFILE_HOTKEY}
              platform={props.platform}
            />
          </>
        }
        variant="ghost"
        onClick={() => void c.duplicateSelected()}
      >
        <Icon icon="files" size="sm" />
      </TooltipIconButton>
      <TooltipIconButton
        aria-label="Delete profile"
        class="combat-profiles-profile-action combat-profiles-remove"
        disabled={c.saving() || c.isDefaultProfile()}
        size="icon-sm"
        tooltip="Delete"
        variant="ghost"
        onClick={() => c.setDeleteDialogOpen(true)}
      >
        <Icon icon="trash_2" size="sm" />
      </TooltipIconButton>
    </div>
  );
}

function CopySnippetButton(props: ShortcutControllerProps): JSX.Element {
  const c = props.controller;
  return (
    <TooltipButton>
      <TooltipButtonTrigger
        aria-keyshortcuts={formatAriaKeyshortcuts(
          COPY_SNIPPET_HOTKEY,
          props.platform,
        )}
        aria-label={
          c.profileCopied() ? "Copied profile snippet" : "Copy profile snippet"
        }
        class="combat-profiles-quiet-action combat-profiles-copy"
        disabled={c.selectedProfile() === undefined}
        size="sm"
        variant="ghost"
        onClick={() => void c.copySelectedProfile()}
      >
        <Icon
          icon={c.profileCopied() ? "check" : "copy"}
          class="button__icon"
        />
        <span class="combat-profiles-copy__label">
          {c.profileCopied() ? "Copied" : "Copy snippet"}
        </span>
      </TooltipButtonTrigger>
      <TooltipButtonContent>
        For use in scripts.{" "}
        <ShortcutHint hotkey={COPY_SNIPPET_HOTKEY} platform={props.platform} />
      </TooltipButtonContent>
    </TooltipButton>
  );
}

function DeleteProfileDialog(props: ControllerProps): JSX.Element {
  const c = props.controller;
  return (
    <AlertDialog
      open={c.deleteDialogOpen()}
      onOpenChange={(details) => c.setDeleteDialogOpen(details.open)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete profile?</AlertDialogTitle>
          <AlertDialogDescription class="combat-profiles-dialog-description">
            {c.selectedProfile()?.label ?? "This profile"} will be permanently
            removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={c.saving()}
            variant="destructive"
            onClick={() => void c.deleteSelected()}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DiscardChangesDialog(props: ControllerProps): JSX.Element {
  const c = props.controller;
  return (
    <AlertDialog
      open={c.pendingProfileSwitch() !== undefined}
      onOpenChange={(details) => {
        if (!details.open) {
          c.cancelProfileSwitch();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription class="combat-profiles-dialog-description">
            Your changes to {c.selectedProfile()?.label ?? "this profile"}{" "}
            haven't been saved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => c.discardChangesAndContinue()}
          >
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const formatNumberDraft = (value: number | undefined): string =>
  value === undefined ? "" : String(value);

const toNumberDraft = (text: string): string => {
  const [whole = "", ...fractions] = text.replaceAll(/[^\d.]/gu, "").split(".");
  return fractions.length === 0 ? whole : `${whole}.${fractions.join("")}`;
};

function NumberField<Empty extends number | undefined>(
  props: Omit<InputProps, "onChange" | "value"> & {
    readonly emptyValue: Empty;
    readonly max: number;
    readonly onChange: (value: number | Empty) => void;
    readonly value: number | Empty;
  },
): JSX.Element {
  const [local, inputProps] = splitProps(props, [
    "emptyValue",
    "max",
    "onChange",
    "value",
  ]);
  const parse = (text: string): number | Empty =>
    text === "" || text === "." ? local.emptyValue : Number(text);
  const [draft, setDraft] = createSignal(formatNumberDraft(local.value));
  const issue = () => wholeNumberIssue(local.value, local.max);
  const issueId = createUniqueId();

  createEffect(() => {
    const value = local.value;
    if (value !== parse(untrack(draft))) {
      setDraft(formatNumberDraft(value));
    }
  });

  return (
    <>
      <Input
        {...inputProps}
        aria-describedby={issue() === undefined ? undefined : issueId}
        autocomplete="off"
        inputmode="numeric"
        invalid={issue() !== undefined}
        value={draft()}
        onInput={(event) => {
          const text = toNumberDraft(event.currentTarget.value);
          event.currentTarget.value = text;
          setDraft(text);
          local.onChange(parse(text));
        }}
        onBlur={() => setDraft(formatNumberDraft(local.value))}
      />
      <Show when={issue()}>
        {(message) => (
          <span id={issueId} class="combat-profiles-field-error">
            {message()}
          </span>
        )}
      </Show>
    </>
  );
}

function RequiredInput(
  props: InputProps & {
    readonly revealMissing: boolean;
    readonly value: string;
  },
): JSX.Element {
  const [local, inputProps] = splitProps(props, ["revealMissing"]);
  const [blurred, setBlurred] = createSignal(false);
  const missing = () => props.value.trim() === "";
  return (
    <Input
      {...inputProps}
      invalid={missing() && (blurred() || local.revealMissing)}
      onBlur={() => setBlurred(true)}
    />
  );
}

function FieldLabel(props: {
  readonly children: string;
  readonly for?: string;
  readonly help?: string;
}): JSX.Element {
  return (
    <span class="combat-profiles-label">
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

function SheetSection(props: {
  readonly action?: JSX.Element;
  readonly children: JSX.Element;
  readonly description: string;
  readonly id: string;
  readonly sticky?: boolean;
  readonly title: string;
}): JSX.Element {
  const headingId = () => `combat-profiles-section-${props.id}`;
  return (
    <section
      class="combat-profiles-section"
      aria-labelledby={headingId()}
      data-sticky={props.sticky ? "" : undefined}
    >
      <div class="combat-profiles-section__heading">
        <div class="combat-profiles-section__label">
          <h2 id={headingId()} class="combat-profiles-section__title">
            {props.title}
          </h2>
          <p class="combat-profiles-section__description">
            {props.description}
          </p>
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

function AddButton(props: {
  readonly children: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <Button
      class="combat-profiles-quiet-action combat-profiles-section__action"
      size="xs"
      variant="ghost"
      onClick={() => props.onClick()}
    >
      <Icon icon="plus" class="button__icon" />
      {props.children}
    </Button>
  );
}

function ChoiceSelect<T extends string>(props: {
  readonly "aria-label": string;
  readonly class?: string;
  readonly "data-overridden"?: string | undefined;
  readonly display?: JSX.Element;
  readonly onChange: (value: T) => void;
  readonly options: readonly ChoiceOption<T>[];
  readonly parse: (value: string | undefined) => T | undefined;
  readonly value: string;
  readonly variant?: "inline" | "field";
}): JSX.Element {
  return (
    <Select
      class={cn(
        "combat-profiles-choice",
        props.variant === "inline" && "combat-profiles-choice--inline",
        props.class,
      )}
      data-overridden={props["data-overridden"]}
      positioning={{ sameWidth: false }}
      value={[props.value]}
      onValueChange={(details) => {
        const value = props.parse(details.value[0]);
        if (value !== undefined) {
          props.onChange(value);
        }
      }}
    >
      <SelectTrigger size="sm" aria-label={props["aria-label"]}>
        <span class="select__value">
          {props.display ?? choiceLabel(props.options, props.value)}
        </span>
      </SelectTrigger>
      <SelectContent class="combat-profiles-choice__content">
        <For each={props.options}>
          {(option) => (
            <SelectItem value={option.value}>{option.label}</SelectItem>
          )}
        </For>
      </SelectContent>
    </Select>
  );
}

const skillOptions = skillSlots.map((skill) => ({
  value: String(skill),
  label: `Skill ${skill}`,
}));

function SkillSelect(props: {
  readonly "aria-label": string;
  readonly onChange: (skill: SkillSlot) => void;
  readonly value: SkillSlot;
}): JSX.Element {
  return (
    <ChoiceSelect
      aria-label={props["aria-label"]}
      class="combat-profiles-skill"
      options={skillOptions}
      parse={(value) =>
        parseSkillSlot(value) === undefined ? undefined : value
      }
      value={String(props.value)}
      onChange={(value) => {
        const skill = parseSkillSlot(value);
        if (skill !== undefined) {
          props.onChange(skill);
        }
      }}
    />
  );
}

function ClassNamesInput(props: ControllerProps): JSX.Element {
  const c = props.controller;
  let input: HTMLInputElement | undefined;
  return (
    <div
      class="combat-profiles-tokens"
      onMouseDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("button, input")
        ) {
          return;
        }

        event.preventDefault();
        input?.focus();
      }}
    >
      <Index each={c.classNames()}>
        {(className, classNameIndex) => (
          <span class="combat-profiles-token">
            <span class="combat-profiles-token__label">{className()}</span>
            <IconButton
              aria-label={`Remove ${className()}`}
              class="combat-profiles-remove"
              size="icon-xs"
              variant="ghost"
              onClick={() => c.removeClassName(classNameIndex)}
            >
              <Icon icon="x" size="xs" />
            </IconButton>
          </span>
        )}
      </Index>
      <input
        ref={(element) => {
          input = element;
          c.setClassNameInput(element);
        }}
        id="combat-profile-class-name"
        class="combat-profiles-tokens__input"
        autocomplete="off"
        maxLength={MAX_NAME_LENGTH}
        name="combat-profile-class-name"
        placeholder={c.classNames().length === 0 ? "Any class" : "Add class…"}
        spellcheck={false}
        value={c.classNameDraft()}
        onInput={(event) => c.setClassNameDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            c.addClassName();
            return;
          }

          if (event.key === "Backspace" && c.classNameDraft() === "") {
            c.removeLastClassName();
          }
        }}
      />
      <span aria-hidden="true" class="combat-profiles-tokens__ring" />
    </div>
  );
}

const consumableHelp =
  "Equips this inventory item before combat. The first running profile controls preflight equipment.";
const resetHelp =
  "Restart at the first matching skill when the active target dies.";
const priorityHelp =
  "Can interrupt the normal rotation. On the next normal cast, the rotation resumes where it left off.";
const triggerCooldownHelp =
  "Minimum time before this trigger can cast again. Leave empty or 0 to allow every matching message.";

function ProfileSection(props: ControllerProps): JSX.Element {
  const c = props.controller;
  return (
    <SheetSection
      id="general"
      title="General"
      description="Name, classes, and pacing for this profile."
    >
      <div class="combat-profiles-fields">
        <div class="combat-profiles-field combat-profiles-field--wide">
          <FieldLabel for="combat-profile-name">Name</FieldLabel>
          <Input
            ref={(element) => c.setNameInput(element)}
            id="combat-profile-name"
            autocomplete="off"
            maxLength={MAX_NAME_LENGTH}
            value={c.label()}
            onInput={(event) => c.setLabel(event.currentTarget.value)}
          />
        </div>
        <div class="combat-profiles-field combat-profiles-field--wide">
          <FieldLabel for="combat-profile-consumable" help={consumableHelp}>
            Skill 5 item
          </FieldLabel>
          <Input
            id="combat-profile-consumable"
            autocomplete="off"
            maxLength={MAX_NAME_LENGTH}
            placeholder="Potent Honor Potion"
            value={c.consumable()}
            onInput={(event) => c.setConsumable(event.currentTarget.value)}
          />
        </div>
      </div>
      <div class="combat-profiles-field combat-profiles-field--full">
        <FieldLabel for="combat-profile-class-name">Classes</FieldLabel>
        <ClassNamesInput controller={c} />
      </div>
      <div class="combat-profiles-fields">
        <div class="combat-profiles-field">
          <FieldLabel for="combat-profile-delay">Delay</FieldLabel>
          <div class="combat-profiles-suffixed">
            <NumberField
              id="combat-profile-delay"
              class="combat-profiles-number"
              emptyValue={0}
              max={MAX_DELAY_MS}
              value={c.delayMs()}
              onChange={c.setDelayMs}
            />
            <span class="combat-profiles-suffix">ms</span>
          </div>
        </div>
        <div class="combat-profiles-field">
          <FieldLabel>On cooldown</FieldLabel>
          <ChoiceSelect
            aria-label="On cooldown"
            class="combat-profiles-cooldown"
            options={cooldownModeOptions}
            parse={(value) =>
              isCombatProfileCooldownMode(value) ? value : undefined
            }
            value={c.cooldownMode()}
            onChange={c.setCooldownMode}
          />
        </div>
        <div class="combat-profiles-check">
          <Checkbox
            size="sm"
            checked={c.resetSkillIndexOnTargetDeath()}
            onChange={(event) =>
              c.setResetSkillIndexOnTargetDeath(event.currentTarget.checked)
            }
          >
            Reset rotation on target death
          </Checkbox>
          <HelpTooltip
            aria-label="About resetting the rotation"
            tooltip={resetHelp}
          />
        </div>
      </div>
    </SheetSection>
  );
}

function RowAction(props: {
  readonly disabled?: boolean;
  readonly icon: IconName;
  readonly label: string;
  readonly onClick: () => void;
  readonly tooltip: string;
  readonly variant?: "remove";
}): JSX.Element {
  return (
    <TooltipIconButton
      aria-label={props.label}
      class={cn(
        "combat-profiles-row-action",
        props.variant === "remove" && "combat-profiles-remove",
      )}
      disabled={props.disabled}
      size="icon-xs"
      tooltip={props.tooltip}
      variant="ghost"
      onClick={() => props.onClick()}
    >
      <Icon icon={props.icon} size="sm" />
    </TooltipIconButton>
  );
}

function RuleRow(props: {
  readonly condition: Accessor<CombatProfileCondition>;
  readonly conditionIndex: number;
  readonly controller: CombatProfilesController;
  readonly stepIndex: number;
}): JSX.Element {
  const c = props.controller;
  const update = (
    change: (condition: CombatProfileCondition) => CombatProfileCondition,
  ): void => c.updateCondition(props.stepIndex, props.conditionIndex, change);

  return (
    <li class="combat-profiles-rule">
      <span class="combat-profiles-rule__joiner">
        {props.conditionIndex === 0 ? "when" : "and"}
      </span>
      <ChoiceSelect
        aria-label="Condition"
        variant="inline"
        options={conditionTypes}
        parse={(value) =>
          conditionTypes.find((option) => option.value === value)?.value
        }
        value={props.condition().type}
        onChange={(type) =>
          c.updateConditionType(props.stepIndex, props.conditionIndex, type)
        }
      />
      <Show when={!isStatCondition(props.condition())}>
        <RequiredInput
          aria-label="Aura name"
          class="combat-profiles-aura"
          autocomplete="off"
          maxLength={MAX_NAME_LENGTH}
          placeholder="Aura name"
          revealMissing={c.showIssues()}
          size="sm"
          spellcheck={false}
          value={auraNameValue(props.condition())}
          onInput={(event) =>
            update((current) =>
              isStatCondition(current)
                ? current
                : { ...current, auraName: event.currentTarget.value },
            )
          }
        />
      </Show>
      <ChoiceSelect
        aria-label="Comparison"
        variant="inline"
        class="combat-profiles-comparison"
        options={comparisonOptions}
        parse={(value) =>
          comparisonOptions.find((option) => option.value === value)?.value
        }
        value={props.condition().op}
        onChange={(op) => update((current) => ({ ...current, op }))}
      />
      <NumberField
        aria-label="Value"
        class="combat-profiles-number combat-profiles-number--rule"
        emptyValue={0}
        max={conditionValueMax(props.condition())}
        size="sm"
        value={props.condition().value}
        onChange={(value) => update((current) => ({ ...current, value }))}
      />
      <Show when={isStatCondition(props.condition())}>
        <ChoiceSelect
          aria-label="Unit"
          variant="inline"
          options={conditionUnitOptions(props.condition())}
          parse={(value) =>
            value === "percent" || value === "value" ? value : undefined
          }
          value={conditionUnitValue(props.condition())}
          onChange={(unit) =>
            update((current) =>
              isStatCondition(current) ? { ...current, unit } : current,
            )
          }
        />
      </Show>
      <IconButton
        aria-label={`Remove rule ${conditionLabel(props.condition())}`}
        class="combat-profiles-remove combat-profiles-rule__remove"
        size="icon-xs"
        variant="ghost"
        onClick={() => c.removeCondition(props.stepIndex, props.conditionIndex)}
      >
        <Icon icon="x" size="sm" />
      </IconButton>
    </li>
  );
}

function StepRow(props: {
  readonly controller: CombatProfilesController;
  readonly step: Accessor<CombatProfileStep>;
  readonly stepIndex: number;
}): JSX.Element {
  const c = props.controller;
  const position = () => props.stepIndex + 1;
  const cooldownOverride = () => props.step().cooldownMode;
  const cooldownOverrideLabel = () => {
    const override = cooldownOverride();
    return override === undefined
      ? "default"
      : choiceLabel(cooldownModeOptions, override);
  };
  const stepCooldownOptions = createMemo<
    readonly ChoiceOption<CombatProfileCooldownMode | "default">[]
  >(() => [
    {
      value: "default",
      label: `Default (${choiceLabel(cooldownModeOptions, c.cooldownMode()).toLowerCase()})`,
    },
    ...cooldownModeOptions,
  ]);

  return (
    <li
      class="combat-profiles-step"
      data-priority={props.step().priority === true ? "" : undefined}
    >
      <div class="combat-profiles-step__main">
        <span class="combat-profiles-step__order" aria-hidden="true">
          {position()}
        </span>
        <SkillSelect
          aria-label={`Step ${position()} skill`}
          value={props.step().skill}
          onChange={(skill) => c.updateStepSkill(props.stepIndex, skill)}
        />
        <TooltipButton>
          <TooltipButtonTrigger
            aria-pressed={props.step().priority === true}
            class="combat-profiles-priority"
            size="xs"
            variant="ghost"
            onClick={() =>
              c.updateStepPriority(
                props.stepIndex,
                props.step().priority !== true,
              )
            }
          >
            <Show when={props.step().priority === true}>
              <Icon icon="check" class="button__icon" />
            </Show>
            Priority
          </TooltipButtonTrigger>
          <TooltipButtonContent>{priorityHelp}</TooltipButtonContent>
        </TooltipButton>
        <ChoiceSelect
          aria-label={`Step ${position()} on cooldown`}
          variant="inline"
          class="combat-profiles-step__cooldown"
          data-overridden={cooldownOverride() === undefined ? undefined : ""}
          display={
            <>
              <span class="combat-profiles-choice__prefix">On cooldown:</span>{" "}
              {cooldownOverrideLabel()}
            </>
          }
          options={stepCooldownOptions()}
          parse={(value) =>
            value === "default" || isCombatProfileCooldownMode(value)
              ? value
              : undefined
          }
          value={cooldownOverride() ?? "default"}
          onChange={(mode) => c.updateStepCooldownMode(props.stepIndex, mode)}
        />
        <div class="combat-profiles-step__actions">
          <Button
            class="combat-profiles-quiet-action"
            size="xs"
            variant="ghost"
            aria-label={`Add rule to step ${position()}`}
            onClick={() => c.addCondition(props.stepIndex)}
          >
            <Icon icon="plus" class="button__icon" />
            Rule
          </Button>
          <RowAction
            icon="arrow_up"
            label={`Move step ${position()} up`}
            tooltip="Move up"
            disabled={props.stepIndex === 0}
            onClick={() => c.moveStep(props.stepIndex, -1)}
          />
          <RowAction
            icon="arrow_down"
            label={`Move step ${position()} down`}
            tooltip="Move down"
            disabled={props.stepIndex === c.draftSteps().length - 1}
            onClick={() => c.moveStep(props.stepIndex, 1)}
          />
          <RowAction
            icon="copy"
            label={`Duplicate step ${position()}`}
            tooltip="Duplicate"
            onClick={() => c.duplicateStep(props.stepIndex)}
          />
          <RowAction
            icon="x"
            label={`Remove step ${position()}`}
            tooltip="Remove"
            variant="remove"
            onClick={() => c.removeStep(props.stepIndex)}
          />
        </div>
      </div>
      <Show when={props.step().conditions.length > 0}>
        <ul
          class="combat-profiles-rules"
          aria-label={`Rules for step ${position()}`}
        >
          <Index each={props.step().conditions}>
            {(condition, conditionIndex) => (
              <RuleRow
                condition={condition}
                conditionIndex={conditionIndex}
                controller={c}
                stepIndex={props.stepIndex}
              />
            )}
          </Index>
        </ul>
      </Show>
    </li>
  );
}

const revealLastRow = (
  list: HTMLElement | undefined,
  focusSelector: string,
): void => {
  const row = list?.lastElementChild;
  if (!(row instanceof HTMLElement)) {
    return;
  }

  row.scrollIntoView({ block: "nearest" });
  row.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
};

function RotationSection(props: ControllerProps): JSX.Element {
  const c = props.controller;
  let list: HTMLOListElement | undefined;
  return (
    <SheetSection
      id="rotation"
      sticky
      title="Rotation"
      description="Tried top to bottom. A skill casts only if all its rules pass."
      action={
        <AddButton
          onClick={() => {
            c.addStep();
            revealLastRow(list, ".combat-profiles-skill .select__trigger");
          }}
        >
          Add skill
        </AddButton>
      }
    >
      <Show
        when={c.draftSteps().length > 0}
        fallback={<p class="combat-profiles-empty">No skills yet.</p>}
      >
        <ol
          ref={(element) => {
            list = element;
          }}
          class="combat-profiles-steps"
          aria-label="Rotation"
        >
          <Index each={c.draftSteps()}>
            {(step, stepIndex) => (
              <StepRow controller={c} step={step} stepIndex={stepIndex} />
            )}
          </Index>
        </ol>
      </Show>
    </SheetSection>
  );
}

function TriggerRow(props: {
  readonly controller: CombatProfilesController;
  readonly trigger: Accessor<CombatProfileMessageTrigger>;
  readonly triggerIndex: number;
}): JSX.Element {
  const c = props.controller;
  const update = (
    change: (
      trigger: CombatProfileMessageTrigger,
    ) => CombatProfileMessageTrigger,
  ): void => c.updateMessageTrigger(props.triggerIndex, change);

  return (
    <li class="combat-profiles-trigger">
      <span class="combat-profiles-trigger__word">When</span>
      <ChoiceSelect
        aria-label="Message source"
        variant="inline"
        options={messageTriggerSourceOptions}
        parse={(value) => (isMessageTriggerSource(value) ? value : undefined)}
        value={props.trigger().source}
        onChange={(source) => update((current) => ({ ...current, source }))}
      />
      <span class="combat-profiles-trigger__word">message contains</span>
      <RequiredInput
        aria-label="Message text"
        class="combat-profiles-trigger__message"
        autocomplete="off"
        maxLength={MAX_MESSAGE_LENGTH}
        placeholder="Message text"
        revealMissing={c.showIssues()}
        size="sm"
        spellcheck={false}
        value={props.trigger().messageIncludes}
        onInput={(event) =>
          update((current) => ({
            ...current,
            messageIncludes: event.currentTarget.value,
          }))
        }
      />
      <span class="combat-profiles-trigger__word">cast</span>
      <SkillSelect
        aria-label="Skill to cast"
        value={props.trigger().skill}
        onChange={(skill) => update((current) => ({ ...current, skill }))}
      />
      <span class="combat-profiles-trigger__cooldown">
        <span class="combat-profiles-trigger__word">cooldown</span>
        <NumberField
          aria-label="Trigger cooldown in milliseconds"
          class="combat-profiles-number combat-profiles-number--cooldown"
          emptyValue={undefined}
          max={MAX_TRIGGER_COOLDOWN_MS}
          placeholder="0"
          size="sm"
          value={props.trigger().cooldownMs}
          onChange={(cooldownMs) =>
            update(({ cooldownMs: _previous, ...current }) =>
              cooldownMs === undefined ? current : { ...current, cooldownMs },
            )
          }
        />
        <span class="combat-profiles-suffix">ms</span>
        <HelpTooltip
          aria-label="About trigger cooldown"
          tooltip={triggerCooldownHelp}
        />
      </span>
      <IconButton
        aria-label="Remove trigger"
        class="combat-profiles-remove combat-profiles-trigger__remove"
        size="icon-xs"
        variant="ghost"
        onClick={() => c.removeMessageTrigger(props.triggerIndex)}
      >
        <Icon icon="x" size="sm" />
      </IconButton>
    </li>
  );
}

function TriggersSection(props: ControllerProps): JSX.Element {
  const c = props.controller;
  let list: HTMLUListElement | undefined;
  return (
    <SheetSection
      id="triggers"
      sticky
      title="Message triggers"
      description="Cast a skill when a combat message contains matching text."
      action={
        <AddButton
          onClick={() => {
            c.addMessageTrigger();
            revealLastRow(list, ".combat-profiles-trigger__message");
          }}
        >
          Add trigger
        </AddButton>
      }
    >
      <Show
        when={c.draftMessageTriggers().length > 0}
        fallback={<p class="combat-profiles-empty">No message triggers.</p>}
      >
        <ul
          ref={(element) => {
            list = element;
          }}
          class="combat-profiles-triggers"
          aria-label="Message triggers"
        >
          <Index each={c.draftMessageTriggers()}>
            {(trigger, triggerIndex) => (
              <TriggerRow
                controller={c}
                trigger={trigger}
                triggerIndex={triggerIndex}
              />
            )}
          </Index>
        </ul>
      </Show>
    </SheetSection>
  );
}

export function CombatProfilesView(
  props: CombatProfilesViewProps,
): JSX.Element {
  const c = createCombatProfilesController(props);
  createCombatProfileHotkeys(c);
  return (
    <div class="standalone-window combat-profiles-root">
      <header class="standalone-window__header combat-profiles-header">
        <span class="combat-profiles-header__label" aria-hidden="true">
          Profile
        </span>
        <div class="combat-profiles-header__picker">
          <ProfilePicker controller={c} platform={props.platform} />
          <ProfileActions controller={c} platform={props.platform} />
        </div>
        <div class="combat-profiles-header__end">
          <CopySnippetButton controller={c} platform={props.platform} />
          <TooltipButton closeDelay={0} openDelay={200}>
            <TooltipButtonTrigger
              aria-keyshortcuts={formatAriaKeyshortcuts(
                SAVE_PROFILE_HOTKEY,
                props.platform,
              )}
              aria-label="Save profile"
              class="combat-profiles-save"
              disabled={c.saving() || !c.hasUnsavedChanges()}
              loading={c.saving()}
              size="sm"
              onClick={() => void c.saveSelected()}
            >
              Save
            </TooltipButtonTrigger>
            <TooltipButtonContent>
              Save{" "}
              <ShortcutHint
                hotkey={SAVE_PROFILE_HOTKEY}
                platform={props.platform}
              />
            </TooltipButtonContent>
          </TooltipButton>
        </div>
      </header>

      <IssueAlert controller={c} />

      <main class="combat-profiles-sheet" aria-label="Combat profile editor">
        <ProfileSection controller={c} />
        <RotationSection controller={c} />
        <TriggersSection controller={c} />
      </main>

      <DeleteProfileDialog controller={c} />
      <DiscardChangesDialog controller={c} />
    </div>
  );
}

export function App(props: DesktopRendererProps): JSX.Element {
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
      platform={props.platform}
    />
  );
}
