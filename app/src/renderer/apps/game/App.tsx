import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
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
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  Input,
  Label,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  TooltipIconButton,
} from "@lucent/ui";
import { Effect, Fiber } from "effect";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";

import type { AppPlatform } from "../../../shared/desktopBridge";
import type {
  AccountGameLaunchPayload,
  AccountScriptReference,
  AccountScriptStatusUpdate,
} from "@lucent/core/accounts";
import {
  DEFAULT_ACCOUNT_SETTINGS,
  type RoomPolicy,
} from "@lucent/core/accountSettings";
import {
  DEFAULT_COMBAT_PROFILE_ID,
  DEFAULT_COMBAT_PROFILE_LIBRARY,
  getCombatProfileById,
  type CombatProfileLibrary,
} from "@lucent/core/combatProfiles";
import type { ScriptFile } from "../../../shared/ipc/scripting";
import {
  normalizeScriptInputValues,
  validateScriptInputValues,
  type ScriptInputField,
  type ScriptInputValue,
  type ScriptInputValues,
  type ScriptInputsDefinition,
} from "@lucent/core/scriptInputs";
import {
  SETTINGS_COMMANDS,
  hotkeyBindingMatchKey,
  readHotkeyBinding,
  type SettingsCommandId,
} from "@lucent/core/hotkeys";
import { hotkeyInputMatchKey } from "../../../shared/hotkeys";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@lucent/core/settings";
import { Api, type ApiService, flashRuntime as runtime } from "./flash";
import type {
  Settings as FlashSettingsSnapshot,
  SettingsPatch as FlashSettingsPatch,
} from "./flash/contract/Settings";
import { Automation } from "./automation/Automation";
import { Environment } from "./environment/Environment";
import {
  parseAutoAttackTargetPriority,
  type AutoAttackState,
} from "./automation/AutoAttack";
import {
  type AutoReloginLifecycleEvent,
  type AutoReloginState,
} from "./automation/AutoRelogin";
import {
  type AutoZoneState,
  type AutoZoneSupportedMap,
} from "./automation/AutoZone";
import {
  ScriptRunner,
  type ScriptRunnerOptions,
  type ScriptRunnerStatus,
} from "./scripting/ScriptRunner";
import {
  formatRoomNumberInput,
  parseRoomNumberInput,
} from "./scripting/roomPolicyInput";
import { prepareScriptStart } from "./scripting/scriptStartPreparation";
import { runScriptEval } from "./scripting/ScriptEvaluator";
import {
  fatalScriptAlertFromError,
  fatalScriptAlertFromStatus,
  type FatalScriptAlert,
} from "./scripting/fatalAlert";
import { resolveAccountScript } from "./scripting/accountScriptResolution";
import {
  TopNav,
  type GameTopNavMenu,
  type TopNavOptionItem,
  type WindowId,
  topNavOptionCommandIds,
  windowCommandIds,
} from "./TopNav";

interface GameLoadState {
  readonly loaded: boolean;
  readonly progress: number;
}

type DebugPanelFrame = {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

type FlashRuntimeServices = Awaited<ReturnType<typeof collectFlashServices>>;

type DebugEvalLogLevel = "debug" | "error" | "info" | "log" | "warn";
type DebugEvalMode = "flash" | "script";

interface DebugEvalLogEntry {
  readonly arguments: readonly unknown[];
  readonly level: DebugEvalLogLevel;
}

interface DebugEvalExecution {
  readonly logs: readonly DebugEvalLogEntry[];
  readonly result: unknown;
}

const DEBUG_EVAL_OUTPUT_LIMIT = 2000;
const DEBUG_PANEL_MARGIN_PX = 12;
const DEBUG_PANEL_MIN_WIDTH_PX = 320;
const DEBUG_PANEL_MIN_HEIGHT_PX = 220;
const DEBUG_PANEL_DEFAULT_WIDTH_PX = 432;
const DEBUG_PANEL_DEFAULT_HEIGHT_PX = 360;

const DEFAULT_FLASH_DEBUG_SOURCE = `return yield* services.player.getCell();`;
const DEFAULT_SCRIPT_DEBUG_SOURCE = `return yield* api.player.getCell();`;
const AUTO_RELOGIN_DEFAULT_DELAY_SECONDS = "3";
const PLAYER_READY_RETRY_INTERVAL_MS = 250;
const PLAYER_READY_RETRY_TIMEOUT_MS = 10_000;
const ACCOUNT_LAUNCH_GAME_LOAD_TIMEOUT_MS = 30_000;
const DEFAULT_FLASH_SETTINGS: FlashSettingsSnapshot = {
  animationsEnabled: true,
  antiCounterEnabled: true,
  collisionsEnabled: true,
  customGuild: "",
  customGuildConfigured: false,
  customName: "",
  customNameConfigured: false,
  deathAdsVisible: true,
  enemyMagnetEnabled: false,
  frameRate: 24,
  infiniteRangeEnabled: false,
  lagKillerEnabled: false,
  otherPlayersVisible: true,
  provokeCellEnabled: false,
  skipCutscenesEnabled: false,
  walkSpeed: 8,
};
const DEFAULT_CELL = "Enter";
const DEFAULT_PAD = "Spawn";
const DEFAULT_PADS = [
  "Spawn",
  "Center",
  "Left",
  "Right",
  "Top",
  "Bottom",
  "Up",
  "Down",
] as const;
const DEFAULT_CELLS = [] as const;

const accountLaunchLifecycleMessage = (
  event: AutoReloginLifecycleEvent,
  server: string | undefined,
): string => {
  if (event.message !== undefined) {
    if (event.message.startsWith("Waiting for ")) return event.message;
    return event.attemptsRemaining > 0
      ? `Retrying login (${event.attemptsRemaining} left): ${event.message}`
      : event.message;
  }

  switch (event.step) {
    case "connect":
      return server === undefined || server === ""
        ? "Connecting..."
        : `Connecting to ${server}...`;
    case "login":
      return "Logging in...";
    case "ready":
      return "Waiting for player...";
  }
};

interface TravelOptions {
  readonly currentCell: string;
  readonly currentPad: string;
  readonly mapCells: readonly string[];
  readonly mapPads: readonly string[];
}

type GameHotkeyHandler = () => void | Promise<void>;

const windowIdsByCommandId = new Map<SettingsCommandId, WindowId>(
  Object.entries(windowCommandIds).flatMap(([id, commandId]) =>
    commandId === undefined ? [] : [[commandId, id as WindowId] as const],
  ),
);

const writeDocumentLoaded = (loaded: boolean): void => {
  document.documentElement.dataset["loaded"] = loaded ? "true" : "false";
};

const writeTopNavHidden = (hidden: boolean): void => {
  document.documentElement.toggleAttribute("data-topnav-hidden", hidden);
};

const isEditableHotkeyTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false;
  }

  const editable = target.closest("input, textarea, select, [contenteditable]");
  if (editable === null) {
    return false;
  }

  return editable.getAttribute("contenteditable") !== "false";
};

const isFlashTextFieldFocused = (): boolean => {
  try {
    return window.swf["flash.isTextFieldFocused"]();
  } catch {
    return false;
  }
};

const getAutoAttackConfiguredProfileLabel = (
  library: CombatProfileLibrary,
  selectedProfileId: string,
): string => {
  const profile = getCombatProfileById(library, selectedProfileId);
  return profile.label;
};

const getAvailableAutoAttackProfileId = (
  library: CombatProfileLibrary,
  profileId: string,
): string =>
  library.profiles.some((profile) => profile.id === profileId)
    ? profileId
    : DEFAULT_COMBAT_PROFILE_ID;

const EffectFunction = Function as unknown as new (
  ...args: string[]
) => (
  services: FlashRuntimeServices,
  effect: typeof Effect,
  console: Console,
) => Effect.Effect<unknown, unknown, never>;

const collectFlashServices = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const api = yield* Api;
      const environment = yield* Environment;

      return {
        ...api,
        environment,
        outfits: api.player.outfits,
      };
    }),
  );

const formatEvalValue = (value: unknown): string => {
  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

const formatEvalError = (error: unknown): string =>
  error instanceof Error && error.message !== ""
    ? error.message
    : String(error);

const formatEvalConsole = (entries: readonly DebugEvalLogEntry[]): string =>
  entries
    .map((entry) => {
      const values = entry.arguments.map((value) => {
        if (value instanceof Error) return formatEvalError(value);
        return typeof value === "string"
          ? JSON.stringify(value)
          : formatEvalValue(value);
      });
      return `[${entry.level}] ${values.join(" ")}`;
    })
    .join("\n");

const truncateOutput = (value: string): string =>
  value.length <= DEBUG_EVAL_OUTPUT_LIMIT
    ? value
    : `${value.slice(0, DEBUG_EVAL_OUTPUT_LIMIT)}...`;

const formatDelaySeconds = (delayMs: number): string =>
  String(Math.max(0, delayMs / 1_000));

const parseDelayMs = (delaySeconds: string): number | null => {
  const seconds = Number.parseFloat(delaySeconds);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1_000) : null;
};

const scriptStatusLabel = (
  loaded: ScriptFile | null,
  status: ScriptRunnerStatus,
): string => {
  if (status.state === "starting") {
    return `Starting ${status.name}`;
  }

  if (status.state === "running") {
    return `Running ${status.name}`;
  }

  if (status.state === "stopping") {
    return `Stopping ${status.name}`;
  }

  if (status.state === "waiting-to-restart") {
    return `Waiting to restart ${status.name}`;
  }

  if (status.state === "failed") {
    return `Failed: ${status.message}`;
  }

  if (status.state === "completed") {
    return `Completed ${status.name}`;
  }

  if (status.state === "stopped") {
    return status.reason === undefined
      ? "Stopped"
      : `Stopped: ${status.reason}`;
  }

  return loaded === null ? "No script loaded" : `Loaded ${loaded.name}`;
};

type ScriptInputsDialogMode = "manual" | "required";
type ScriptInputDraftValue = boolean | string;
type ScriptInputDraftValues = Readonly<Record<string, ScriptInputDraftValue>>;

interface ScriptInputsDialogErrorField {
  readonly key: string;
  readonly label: string;
  readonly message: string;
}

interface ScriptInputsDialogError {
  readonly fields: readonly ScriptInputsDialogErrorField[];
  readonly message: string;
}

const fieldLabel = (field: ScriptInputField): string =>
  field.label || field.key;

const scriptInputFieldError = (
  field: ScriptInputField,
  message: string,
): ScriptInputsDialogErrorField => ({
  key: field.key,
  label: fieldLabel(field),
  message,
});

const scriptInputFieldByKey = (
  definition: ScriptInputsDefinition,
  key: string,
): ScriptInputField | undefined =>
  definition.fields.find((field) => field.key === key);

const scriptInputDraftFromValues = (
  definition: ScriptInputsDefinition,
  values: ScriptInputValues,
): ScriptInputDraftValues => {
  const normalized = normalizeScriptInputValues(definition, values);
  const draft: Record<string, ScriptInputDraftValue> = {};

  for (const field of definition.fields) {
    const value = normalized[field.key];
    draft[field.key] =
      field.type === "boolean" ? value === true : String(value ?? "");
  }

  return draft;
};

const scriptInputValuesFromDraft = (
  definition: ScriptInputsDefinition,
  draft: ScriptInputDraftValues,
):
  | { readonly ok: true; readonly values: ScriptInputValues }
  | { readonly error: ScriptInputsDialogError; readonly ok: false } => {
  const values: Record<string, ScriptInputValue> = {};
  const invalidFields: ScriptInputsDialogErrorField[] = [];

  for (const field of definition.fields) {
    const draftValue = draft[field.key];
    if (field.type === "boolean") {
      values[field.key] = draftValue === true;
      continue;
    }

    const text = typeof draftValue === "string" ? draftValue.trim() : "";
    if (text === "") {
      continue;
    }

    if (field.type === "number") {
      const value = Number(text);
      if (!Number.isFinite(value)) {
        invalidFields.push(scriptInputFieldError(field, "must be a number"));
        continue;
      }
      values[field.key] = value;
      continue;
    }

    if (field.type === "select" && !field.options.includes(text)) {
      invalidFields.push(
        scriptInputFieldError(field, "must match a declared option"),
      );
      continue;
    }

    values[field.key] = text;
  }

  const validation = validateScriptInputValues(definition, values);
  const invalidKeys = new Set(invalidFields.map((field) => field.key));
  const missingFields =
    validation.status === "missing-required"
      ? validation.fieldKeys
          .filter((key) => !invalidKeys.has(key))
          .map((key) => scriptInputFieldByKey(definition, key))
          .filter((field): field is ScriptInputField => field !== undefined)
          .map((field) => scriptInputFieldError(field, ""))
      : [];
  const fields = [...invalidFields, ...missingFields];

  if (fields.length > 0) {
    const message =
      invalidFields.length > 0 && missingFields.length > 0
        ? "Please correct the invalid script inputs."
        : invalidFields.length > 0
          ? "Some script inputs are invalid."
          : "Please fill in all required script inputs.";
    return {
      error: { fields, message },
      ok: false,
    };
  }

  return { ok: true, values: validation.values };
};

const selectFieldOptions = (field: ScriptInputField): readonly string[] =>
  field.type === "select" ? field.options : [];

const clampPanelFrame = (frame: DebugPanelFrame): DebugPanelFrame => {
  const maxWidth = Math.max(
    DEBUG_PANEL_MIN_WIDTH_PX,
    window.innerWidth - DEBUG_PANEL_MARGIN_PX * 2,
  );
  const maxHeight = Math.max(
    DEBUG_PANEL_MIN_HEIGHT_PX,
    window.innerHeight - DEBUG_PANEL_MARGIN_PX * 2,
  );
  const width = Math.min(
    Math.max(frame.width, DEBUG_PANEL_MIN_WIDTH_PX),
    maxWidth,
  );
  const height = Math.min(
    Math.max(frame.height, DEBUG_PANEL_MIN_HEIGHT_PX),
    maxHeight,
  );

  return {
    height,
    width,
    x: Math.min(
      Math.max(frame.x, DEBUG_PANEL_MARGIN_PX),
      Math.max(
        DEBUG_PANEL_MARGIN_PX,
        window.innerWidth - width - DEBUG_PANEL_MARGIN_PX,
      ),
    ),
    y: Math.min(
      Math.max(frame.y, DEBUG_PANEL_MARGIN_PX),
      Math.max(
        DEBUG_PANEL_MARGIN_PX,
        window.innerHeight - height - DEBUG_PANEL_MARGIN_PX,
      ),
    ),
  };
};

const createInitialPanelFrame = (): DebugPanelFrame => {
  const width = Math.min(
    DEBUG_PANEL_DEFAULT_WIDTH_PX,
    Math.max(
      DEBUG_PANEL_MIN_WIDTH_PX,
      window.innerWidth - DEBUG_PANEL_MARGIN_PX * 2,
    ),
  );
  const height = Math.min(
    DEBUG_PANEL_DEFAULT_HEIGHT_PX,
    Math.max(
      DEBUG_PANEL_MIN_HEIGHT_PX,
      window.innerHeight - DEBUG_PANEL_MARGIN_PX * 2,
    ),
  );

  return clampPanelFrame({
    height,
    width,
    x: window.innerWidth - width - DEBUG_PANEL_MARGIN_PX,
    y: window.innerHeight - height - DEBUG_PANEL_MARGIN_PX,
  });
};

const makeDebugConsole = (logs: DebugEvalLogEntry[]): Console => {
  const capture =
    (level: DebugEvalLogLevel) =>
    (...args: unknown[]) => {
      logs.push({ arguments: args, level });
      console[level](...args);
    };

  return Object.assign(Object.create(console) as Console, {
    debug: capture("debug"),
    error: capture("error"),
    info: capture("info"),
    log: capture("log"),
    warn: capture("warn"),
  });
};

const runFlashEval = (
  source: string,
  signal: AbortSignal,
): Promise<DebugEvalExecution> =>
  collectFlashServices().then(async (services) => {
    const logs: DebugEvalLogEntry[] = [];
    const debugConsole = makeDebugConsole(logs);
    const compileInternalEval = new EffectFunction(
      "services",
      "Effect",
      "console",
      `"use strict";
return Effect.gen(function* debugInternalEval() {
${source}
});`,
    );

    const result = await runtime.runPromise(
      compileInternalEval(services, Effect, debugConsole),
      { signal },
    );
    return { logs, result };
  });

const runScriptDebugEval = async (
  source: string,
  signal: AbortSignal,
): Promise<DebugEvalExecution> => {
  const logs: DebugEvalLogEntry[] = [];
  const result = await runtime.runPromise(
    runScriptEval(source, makeDebugConsole(logs)),
    { signal },
  );
  return { logs, result };
};

const runDebugEval = (
  mode: DebugEvalMode,
  source: string,
  signal: AbortSignal,
): Promise<DebugEvalExecution> =>
  mode === "script"
    ? runScriptDebugEval(source, signal)
    : runFlashEval(source, signal);

const readCachedTravelOptions = (): Promise<TravelOptions> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const { map, player } = yield* Api;
      const [mapCells, mapPads, currentCell, currentPad] = yield* Effect.all([
        map.getCells(),
        map.getCellPads(),
        player.getCell(),
        player.getPad(),
      ]);

      return {
        currentCell,
        currentPad,
        mapCells,
        mapPads,
      };
    }),
  );

const readBridgeTravelOptions = (): Promise<TravelOptions> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const { map, player } = yield* Api;
      const [mapCells, mapPads, currentCell, currentPad] = yield* Effect.all([
        map.getCells(),
        map.getCellPads(),
        player.getCell(),
        player.getPad(),
      ]);

      return {
        currentCell,
        currentPad,
        mapCells,
        mapPads,
      };
    }),
  );

const readPlayerReady = (): Promise<boolean> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const { player } = yield* Api;
      return yield* player.isReady();
    }),
  );

function DevDebugEvaluator(): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [mode, setMode] = createSignal<DebugEvalMode>("script");
  const [flashSource, setFlashSource] = createSignal(
    DEFAULT_FLASH_DEBUG_SOURCE,
  );
  const [scriptSource, setScriptSource] = createSignal(
    DEFAULT_SCRIPT_DEBUG_SOURCE,
  );
  const [status, setStatus] = createSignal("Idle");
  const [output, setOutput] = createSignal("");
  const [consoleOutput, setConsoleOutput] = createSignal("");
  const [resultOutput, setResultOutput] = createSignal("");
  const [copyableOutput, setCopyableOutput] = createSignal<string | null>(null);
  const [outputCopied, setOutputCopied] = createSignal(false);
  const [running, setRunning] = createSignal(false);
  const [panelFrame, setPanelFrame] = createSignal<DebugPanelFrame>(
    createInitialPanelFrame(),
  );
  let panelElement: HTMLDivElement | undefined;
  let panelResizeObserver: ResizeObserver | undefined;
  let cleanupPanelPointer: (() => void) | undefined;
  let outputCopiedTimer: number | undefined;
  let evalController: AbortController | undefined;

  const currentSource = createMemo(() =>
    mode() === "script" ? scriptSource() : flashSource(),
  );

  const clearOutput = () => {
    setOutput("");
    setConsoleOutput("");
    setResultOutput("");
    setCopyableOutput(null);
    setOutputCopied(false);
  };

  const selectMode = (nextMode: DebugEvalMode) => {
    if (running() || nextMode === mode()) {
      return;
    }

    setMode(nextMode);
    setStatus("Idle");
    clearOutput();
  };

  onMount(() => {
    const handleResize = () => {
      setPanelFrame(clampPanelFrame);
    };

    panelResizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const borderBoxSize = entry?.borderBoxSize[0];
      const width =
        borderBoxSize === undefined
          ? panelElement?.offsetWidth
          : borderBoxSize.inlineSize;
      const height =
        borderBoxSize === undefined
          ? panelElement?.offsetHeight
          : borderBoxSize.blockSize;

      if (width === undefined || height === undefined) {
        return;
      }

      setPanelFrame((frame) =>
        clampPanelFrame({
          ...frame,
          height: Math.round(height),
          width: Math.round(width),
        }),
      );
    });

    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      cleanupPanelPointer?.();
      if (outputCopiedTimer !== undefined) {
        window.clearTimeout(outputCopiedTimer);
      }
      evalController?.abort();
      panelResizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
    });
  });

  createEffect(() => {
    const element = panelElement;
    const observer = panelResizeObserver;
    if (!open() || element === undefined || observer === undefined) {
      return;
    }

    observer.observe(element);
    onCleanup(() => {
      observer.unobserve(element);
    });
  });

  const markOutputCopied = () => {
    if (outputCopiedTimer !== undefined) {
      window.clearTimeout(outputCopiedTimer);
    }

    setOutputCopied(true);
    outputCopiedTimer = window.setTimeout(() => {
      setOutputCopied(false);
      outputCopiedTimer = undefined;
    }, 900);
  };

  const copyOutput = async () => {
    const value = copyableOutput();
    if (value === null) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setStatus("Result copied");
      markOutputCopied();
    } catch {
      setStatus("Copy failed");
    }
  };

  const runEval = () => {
    if (running()) {
      return;
    }

    const evalMode = mode();
    const source = currentSource().trim();
    if (source === "") {
      setStatus("No code to evaluate");
      clearOutput();
      return;
    }

    const controller = new AbortController();
    evalController = controller;
    setRunning(true);
    setStatus(`Running ${evalMode} eval`);
    clearOutput();

    void runDebugEval(evalMode, source, controller.signal)
      .then((execution) => {
        const formattedConsole = formatEvalConsole(execution.logs);
        const formattedResult = formatEvalValue(execution.result);
        const formattedValue = [
          ...(formattedConsole === "" ? [] : [`Console\n${formattedConsole}`]),
          `Result\n${formattedResult}`,
        ].join("\n\n");
        setStatus("Eval complete");
        setOutput(truncateOutput(formattedValue));
        setConsoleOutput(truncateOutput(formattedConsole));
        setResultOutput(truncateOutput(formattedResult));
        setCopyableOutput(formattedResult);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          setStatus("Eval stopped");
          clearOutput();
          return;
        }

        const formattedError = formatEvalError(error);
        setStatus("Eval failed");
        setOutput(truncateOutput(formattedError));
        setConsoleOutput("");
        setResultOutput(truncateOutput(formattedError));
        setCopyableOutput(formattedError);
      })
      .finally(() => {
        if (evalController === controller) {
          evalController = undefined;
          setRunning(false);
        }
      });
  };

  const stopEval = () => {
    const controller = evalController;
    if (controller === undefined || controller.signal.aborted) {
      return;
    }

    setStatus("Stopping eval");
    controller.abort();
  };

  const startPanelDrag: JSX.EventHandler<HTMLElement, PointerEvent> = (
    event,
  ) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    cleanupPanelPointer?.();
    const startFrame = panelFrame();
    const startX = event.clientX;
    const startY = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setPanelFrame(
        clampPanelFrame({
          ...startFrame,
          x: startFrame.x + moveEvent.clientX - startX,
          y: startFrame.y + moveEvent.clientY - startY,
        }),
      );
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      cleanupPanelPointer = undefined;
    };

    cleanupPanelPointer = handlePointerUp;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
  };

  const handlePanelKeyDown: JSX.EventHandler<HTMLElement, KeyboardEvent> = (
    event,
  ) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();

      runEval();
      return;
    }

    if (event.key !== "Escape" && event.key !== "Tab") {
      event.stopPropagation();
    }
  };

  return (
    <aside
      aria-label="Debug evaluator"
      class="game-debug-eval"
      style={{
        bottom: open() ? undefined : "0.75rem",
        display: "grid",
        gap: "0.5rem",
        left: open() ? `${panelFrame().x}px` : undefined,
        position: "fixed",
        right: open() ? undefined : "0.75rem",
        top: open() ? `${panelFrame().y}px` : undefined,
        "z-index": "10002",
        "pointer-events": "auto",
      }}
    >
      <Show
        when={open()}
        fallback={
          <Button class="game-debug-eval__open" onClick={() => setOpen(true)}>
            Debug Eval
          </Button>
        }
      >
        <div
          ref={(element) => {
            panelElement = element;
          }}
          class="game-debug-eval__panel"
          onKeyDown={handlePanelKeyDown}
          style={{
            height: `${panelFrame().height}px`,
            "max-height": `calc(100vh - ${panelFrame().y + DEBUG_PANEL_MARGIN_PX}px)`,
            "max-width": `calc(100vw - ${panelFrame().x + DEBUG_PANEL_MARGIN_PX}px)`,
            width: `${panelFrame().width}px`,
          }}
        >
          <div class="game-debug-eval__header" onPointerDown={startPanelDrag}>
            <strong>Debug Eval</strong>
            <div
              class="game-debug-eval__header-actions"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Tabs
                aria-label="Debug evaluator mode"
                class="game-debug-eval__mode"
                onValueChange={(details) =>
                  selectMode(details.value as DebugEvalMode)
                }
                value={mode()}
              >
                <TabsList>
                  <TabsTrigger disabled={running()} value="script">
                    Script
                  </TabsTrigger>
                  <TabsTrigger disabled={running()} value="flash">
                    Flash
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Button
                aria-label="Close debug evaluator"
                class="game-debug-eval__close"
                onClick={() => setOpen(false)}
                size="sm"
                variant="outline"
              >
                Close
              </Button>
            </div>
          </div>
          <Textarea
            aria-label={`${mode() === "script" ? "Script" : "Flash"} debug eval code`}
            class="game-debug-eval__source"
            fullWidth
            size="sm"
            spellcheck={false}
            value={currentSource()}
            onInput={(event) => {
              const source = event.currentTarget.value;
              if (mode() === "script") {
                setScriptSource(source);
              } else {
                setFlashSource(source);
              }
            }}
          />
          <div class="game-debug-eval__footer-actions">
            <Button disabled={running()} onClick={runEval} size="sm">
              {running() ? "Running" : "Eval"}
            </Button>
            <Show when={running()}>
              <Button onClick={stopEval} size="sm" variant="outline">
                Stop
              </Button>
            </Show>
            <Button
              aria-label={
                outputCopied()
                  ? "Debug eval result copied"
                  : "Copy debug eval result"
              }
              class="game-debug-eval__copy-output"
              disabled={copyableOutput() === null}
              onClick={() => void copyOutput()}
              size="sm"
              title={outputCopied() ? "Copied" : "Copy result"}
              variant="outline"
            >
              <Icon
                icon={outputCopied() ? "check" : "copy"}
                class="button__icon"
              />
              {outputCopied() ? "Copied" : "Copy"}
            </Button>
          </div>
          <div class="game-debug-eval__output">
            <div class="game-debug-eval__status-row">
              <span>{status()}</span>
            </div>
            <Show when={output() !== ""}>
              <Show when={consoleOutput() !== ""}>
                <section class="game-debug-eval__result">
                  <strong>Console</strong>
                  <pre class="game-debug-eval__pre">{consoleOutput()}</pre>
                </section>
              </Show>
              <section class="game-debug-eval__result">
                <strong>
                  {status() === "Eval failed" ? "Error" : "Result"}
                </strong>
                <pre class="game-debug-eval__pre">{resultOutput()}</pre>
              </section>
            </Show>
          </div>
        </div>
      </Show>
    </aside>
  );
}

export function App(props: {
  readonly initialSettings?: AppSettings | null;
  readonly platform: AppPlatform;
}): JSX.Element {
  const [settings, setSettings] = createSignal<AppSettings>(
    props.initialSettings ?? DEFAULT_APP_SETTINGS,
  );
  const [loadState, setLoadState] = createSignal<GameLoadState>({
    loaded: false,
    progress: 0,
  });
  let resolveGameLoaded: (() => void) | undefined;
  const gameLoadedPromise = new Promise<void>((resolve) => {
    resolveGameLoaded = () => resolve();
  });
  const [openMenu, setOpenMenu] = createSignal<GameTopNavMenu | null>(null);
  const [topNavVisible, setTopNavVisible] = createSignal(true);
  const [flashSettings, setFlashSettings] = createSignal<FlashSettingsSnapshot>(
    DEFAULT_FLASH_SETTINGS,
  );
  const [walkSpeed, setWalkSpeed] = createSignal(
    String(DEFAULT_FLASH_SETTINGS.walkSpeed),
  );
  const [frameRate, setFrameRate] = createSignal(
    String(DEFAULT_FLASH_SETTINGS.frameRate),
  );
  const [customName, setCustomName] = createSignal("");
  const [customGuild, setCustomGuild] = createSignal("");
  const [scriptRoomPolicy, setScriptRoomPolicy] = createSignal<RoomPolicy>(
    DEFAULT_ACCOUNT_SETTINGS.scripts.roomPolicy,
  );
  const [scriptSafeStartStop, setScriptSafeStartStop] = createSignal(true);
  const [scriptReloadBeforeStart, setScriptReloadBeforeStart] = createSignal(
    DEFAULT_ACCOUNT_SETTINGS.scripts.reloadBeforeStart,
  );
  const [scriptRestartAfterReconnect, setScriptRestartAfterReconnect] =
    createSignal(false);
  const [scriptRoomNumberDraft, setScriptRoomNumberDraft] = createSignal("");
  const [scriptRoomNumberError, setScriptRoomNumberError] = createSignal("");
  const [boundScriptSettingsUsername, setBoundScriptSettingsUsername] =
    createSignal<string | null>(null);
  const scriptSettingsReady = createMemo(
    () => boundScriptSettingsUsername() !== null,
  );
  const [loadedScript, setLoadedScript] = createSignal<ScriptFile | null>(null);
  const [scriptInputValues, setScriptInputValues] =
    createSignal<ScriptInputValues>({});
  const [scriptInputDialogOpen, setScriptInputDialogOpen] = createSignal(false);
  const [scriptInputDialogMode, setScriptInputDialogMode] =
    createSignal<ScriptInputsDialogMode>("manual");
  const [scriptInputDraftValues, setScriptInputDraftValues] =
    createSignal<ScriptInputDraftValues>({});
  const [scriptInputDialogError, setScriptInputDialogError] =
    createSignal<ScriptInputsDialogError | null>(null);
  const [scriptInputDialogSaving, setScriptInputDialogSaving] =
    createSignal(false);
  const [scriptReplacementDialogOpen, setScriptReplacementDialogOpen] =
    createSignal(false);
  const [scriptRunnerStatus, setScriptRunnerStatus] =
    createSignal<ScriptRunnerStatus>({ state: "idle" });
  const [scriptBusy, setScriptBusy] = createSignal(false);
  const [scriptStopInFlight, setScriptStopInFlight] = createSignal(false);
  const [fatalScriptAlert, setFatalScriptAlert] =
    createSignal<FatalScriptAlert | null>(null);
  const [fatalScriptAlertOpen, setFatalScriptAlertOpen] = createSignal(false);
  const [fatalScriptAlertCopied, setFatalScriptAlertCopied] =
    createSignal(false);
  const scriptInputFieldRefs = new Map<string, HTMLElement>();
  const scriptInputEditorRefs = new Map<string, HTMLElement>();
  const [selectedAutoAttackProfileId, setSelectedAutoAttackProfileId] =
    createSignal(DEFAULT_COMBAT_PROFILE_ID);
  const [combatProfileLibrary, setCombatProfileLibrary] =
    createSignal<CombatProfileLibrary>(DEFAULT_COMBAT_PROFILE_LIBRARY);
  const [autoAttackEnabled, setAutoAttackEnabled] = createSignal(false);
  const [autoAttackProfileLabel, setAutoAttackProfileLabel] = createSignal("");
  const [autoAttackLastError, setAutoAttackLastError] = createSignal("");
  const [autoAttackTargetPriority, setAutoAttackTargetPriority] =
    createSignal("");
  const [autoZoneMap, setAutoZoneMap] = createSignal<
    AutoZoneSupportedMap | undefined
  >();
  const [autoZoneEnabled, setAutoZoneEnabled] = createSignal(false);
  const [autoReloginDelaySeconds, setAutoReloginDelaySeconds] = createSignal(
    AUTO_RELOGIN_DEFAULT_DELAY_SECONDS,
  );
  const [autoReloginServer, setAutoReloginServer] = createSignal("");
  const [autoReloginServers, setAutoReloginServers] = createSignal<
    readonly string[]
  >([]);
  const [autoReloginEnabled, setAutoReloginEnabled] = createSignal(false);
  const [autoReloginCaptured, setAutoReloginCaptured] = createSignal(false);
  const [autoReloginAttempting, setAutoReloginAttempting] = createSignal(false);
  const [autoReloginWaitingDelay, setAutoReloginWaitingDelay] =
    createSignal(false);
  const [autoReloginToggling, setAutoReloginToggling] = createSignal(false);
  const [autoReloginLastError, setAutoReloginLastError] = createSignal("");
  const [autoReloginAttemptsRemaining, setAutoReloginAttemptsRemaining] =
    createSignal<number | null>(null);
  const [cells, setCells] = createSignal<readonly string[]>(DEFAULT_CELLS);
  const [pads] = createSignal<readonly string[]>(DEFAULT_PADS);
  const [validPads, setValidPads] = createSignal<readonly string[]>([]);
  const [selectedCell, setSelectedCell] = createSignal(DEFAULT_CELL);
  const [selectedPad, setSelectedPad] = createSignal(DEFAULT_PAD);
  const [travelBusy, setTravelBusy] = createSignal(false);
  const gameLoaded = createMemo(() => loadState().loaded);
  const progress = createMemo(() => loadState().progress);
  const platformLabel = createMemo(() => props.platform);
  const [playerReady, setPlayerReady] = createSignal(false);
  const scriptReady = createMemo(() => playerReady() && scriptSettingsReady());
  let autoAttackToggleInFlight = false;
  let playerReadyRefreshVersion = 0;
  let playerReadyRetryTimer: number | undefined;
  let playerReadyRetryToken = 0;
  let activeAccountLaunchPayload: AccountGameLaunchPayload | null = null;
  let accountScriptRunnerStatusPublishQueue = Promise.resolve();
  let activeAccountScriptMissing = false;
  let lastPublishedDirectGameUsername: string | null = null;
  let scriptSettingsBindToken = 0;
  let lastShownFatalScriptAlertKey = "";
  let fatalScriptAlertCopiedTimer: number | undefined;
  const scriptLoaded = createMemo(() => loadedScript() !== null);
  const scriptRunning = createMemo(() => {
    const state = scriptRunnerStatus().state;
    return (
      state === "running" ||
      state === "starting" ||
      state === "stopping" ||
      state === "waiting-to-restart"
    );
  });
  const scriptTogglePending = createMemo(() => {
    const state = scriptRunnerStatus().state;
    return (
      scriptStopInFlight() ||
      state === "stopping" ||
      (scriptBusy() && state !== "running" && state !== "starting")
    );
  });
  const scriptInputsAvailable = createMemo(
    () =>
      loadedScript()?.inputs !== null && loadedScript()?.inputs !== undefined,
  );
  const scriptStatus = createMemo(() =>
    scriptStatusLabel(loadedScript(), scriptRunnerStatus()),
  );
  const setLoadProgress = (percent: number) => {
    const progress = Math.max(0, Math.min(100, Math.round(percent)));
    setLoadState((state) => ({
      loaded: progress >= 100 ? state.loaded : false,
      progress,
    }));
  };
  const markLoaded = () => {
    setLoadState({
      loaded: true,
      progress: 100,
    });
    resolveGameLoaded?.();
  };

  window.onLoaded = markLoaded;
  window.onProgress = setLoadProgress;
  onCleanup(() => {
    if (window.onLoaded === markLoaded) delete window.onLoaded;
    if (window.onProgress === setLoadProgress) delete window.onProgress;
  });

  const applyFlashSettingsState = (state: FlashSettingsSnapshot) => {
    setFlashSettings(state);
    setWalkSpeed(String(state.walkSpeed));
    setFrameRate(String(state.frameRate));
    setCustomName(state.customName);
    setCustomGuild(state.customGuild);
  };

  const patchFlashSettingsState = (patch: Partial<FlashSettingsSnapshot>) => {
    setFlashSettings((state) => ({
      ...state,
      ...patch,
    }));
  };

  const refreshFlashSettings = () => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { settings } = yield* Api;
          return yield* settings.get();
        }),
      )
      .then(applyFlashSettingsState)
      .catch((error: unknown) => {
        console.error("[game:settings]", "refresh failed", error);
      });
  };

  const runSettingsUpdate = (
    label: string,
    optimisticPatch: Partial<FlashSettingsSnapshot>,
    update: (settings: ApiService["settings"]) => Effect.Effect<void>,
  ) => {
    patchFlashSettingsState(optimisticPatch);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { settings } = yield* Api;
          yield* update(settings);
          return yield* settings.get();
        }),
      )
      .then(applyFlashSettingsState)
      .catch((error: unknown) => {
        console.error("[game:settings]", `${label} failed`, error);
        refreshFlashSettings();
      });
  };

  const setFlashSetting = (
    label: string,
    key: keyof Pick<
      FlashSettingsSnapshot,
      | "animationsEnabled"
      | "antiCounterEnabled"
      | "collisionsEnabled"
      | "deathAdsVisible"
      | "enemyMagnetEnabled"
      | "infiniteRangeEnabled"
      | "lagKillerEnabled"
      | "otherPlayersVisible"
      | "provokeCellEnabled"
      | "skipCutscenesEnabled"
    >,
    enabled: boolean,
    update: (
      settings: ApiService["settings"],
      enabled: boolean,
    ) => Effect.Effect<void>,
  ) => {
    runSettingsUpdate(
      label,
      { [key]: enabled } as FlashSettingsPatch,
      (settings) => update(settings, enabled),
    );
  };

  const handleHidePlayersCheckedChange = (hidden: boolean) => {
    const visible = !hidden;
    runSettingsUpdate(
      "hide players",
      { otherPlayersVisible: visible },
      (settings) => settings.setOtherPlayersVisible(visible),
    );
  };

  const handleSetWalkSpeed = (speed: number) => {
    runSettingsUpdate("set walk speed", { walkSpeed: speed }, (settings) =>
      settings.setWalkSpeed(speed),
    );
  };

  const handleSetFrameRate = (fps: number) => {
    runSettingsUpdate("set frame rate", { frameRate: fps }, (settings) =>
      settings.setFrameRate(fps),
    );
  };

  const handleSetCustomName = () => {
    const name = customName();
    runSettingsUpdate("set custom name", { customName: name }, (settings) =>
      settings.setCustomName(name),
    );
  };

  const handleSetCustomGuild = () => {
    const guild = customGuild();
    runSettingsUpdate("set custom guild", { customGuild: guild }, (settings) =>
      settings.setCustomGuild(guild),
    );
  };

  const handleResetCustomName = () => {
    runSettingsUpdate(
      "reset custom name",
      { customName: "", customNameConfigured: false },
      (settings) => settings.resetCustomName,
    );
  };

  const handleResetCustomGuild = () => {
    runSettingsUpdate(
      "reset custom guild",
      { customGuild: "", customGuildConfigured: false },
      (settings) => settings.resetCustomGuild,
    );
  };

  const optionsDisabled = () => !gameLoaded() || !playerReady();

  const optionItems = createMemo<readonly TopNavOptionItem[]>(() => [
    {
      id: "infinite-range",
      label: "Infinite Range",
      checked: flashSettings().infiniteRangeEnabled,
      disabled: optionsDisabled(),
      onCheckedChange: (enabled) =>
        setFlashSetting(
          "toggle infinite range",
          "infiniteRangeEnabled",
          enabled,
          (settings, enabled) => settings.setInfiniteRangeEnabled(enabled),
        ),
    },
    {
      id: "provoke-cell",
      label: "Provoke Cell",
      checked: flashSettings().provokeCellEnabled,
      disabled: optionsDisabled(),
      onCheckedChange: (enabled) =>
        setFlashSetting(
          "toggle provoke cell",
          "provokeCellEnabled",
          enabled,
          (settings, enabled) => settings.setProvokeCellEnabled(enabled),
        ),
    },
    {
      id: "enemy-magnet",
      label: "Enemy Magnet",
      checked: flashSettings().enemyMagnetEnabled,
      disabled: optionsDisabled(),
      onCheckedChange: (enabled) =>
        setFlashSetting(
          "toggle enemy magnet",
          "enemyMagnetEnabled",
          enabled,
          (settings, enabled) => settings.setEnemyMagnetEnabled(enabled),
        ),
    },
    {
      id: "lag-killer",
      label: "Lag Killer",
      checked: flashSettings().lagKillerEnabled,
      disabled: optionsDisabled(),
      onCheckedChange: (enabled) =>
        setFlashSetting(
          "toggle lag killer",
          "lagKillerEnabled",
          enabled,
          (settings, enabled) => settings.setLagKillerEnabled(enabled),
        ),
    },
    {
      id: "hide-players",
      label: "Hide Players",
      checked: !flashSettings().otherPlayersVisible,
      disabled: optionsDisabled(),
      onCheckedChange: handleHidePlayersCheckedChange,
    },
    {
      id: "skip-cutscenes",
      label: "Skip Cutscenes",
      checked: flashSettings().skipCutscenesEnabled,
      disabled: optionsDisabled(),
      onCheckedChange: (enabled) =>
        setFlashSetting(
          "toggle skip cutscenes",
          "skipCutscenesEnabled",
          enabled,
          (settings, enabled) => settings.setSkipCutscenesEnabled(enabled),
        ),
    },
    {
      id: "anti-counter",
      label: "Anti-Counter",
      checked: flashSettings().antiCounterEnabled,
      disabled: optionsDisabled(),
      onCheckedChange: (enabled) =>
        setFlashSetting(
          "toggle anti-counter",
          "antiCounterEnabled",
          enabled,
          (settings, enabled) => settings.setAntiCounterEnabled(enabled),
        ),
    },
    {
      id: "animations",
      label: "Animations",
      checked: flashSettings().animationsEnabled,
      disabled: optionsDisabled(),
      onCheckedChange: (enabled) =>
        setFlashSetting(
          "toggle animations",
          "animationsEnabled",
          enabled,
          (settings, enabled) => settings.setAnimationsEnabled(enabled),
        ),
    },
    {
      id: "collisions",
      label: "Collisions",
      checked: flashSettings().collisionsEnabled,
      disabled: optionsDisabled(),
      onCheckedChange: (enabled) =>
        setFlashSetting(
          "toggle collisions",
          "collisionsEnabled",
          enabled,
          (settings, enabled) => settings.setCollisionsEnabled(enabled),
        ),
    },
    {
      id: "death-ads",
      label: "Death Ads",
      checked: flashSettings().deathAdsVisible,
      disabled: optionsDisabled(),
      onCheckedChange: (enabled) =>
        setFlashSetting(
          "toggle death ads",
          "deathAdsVisible",
          enabled,
          (settings, enabled) => settings.setDeathAdsVisible(enabled),
        ),
    },
  ]);

  const handleSelectAutoAttackProfile = (profileId: string) => {
    if (autoAttackEnabled()) {
      return;
    }

    setSelectedAutoAttackProfileId(
      getAvailableAutoAttackProfileId(combatProfileLibrary(), profileId),
    );
  };

  const applyAutoZoneState = (state: AutoZoneState) => {
    setAutoZoneEnabled(state.enabled);
    setAutoZoneMap(state.map);
  };

  const refreshAutoZoneState = () => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { autoZone } = yield* Automation;
          return yield* autoZone.getState();
        }),
      )
      .then(applyAutoZoneState)
      .catch((error: unknown) => {
        console.error("[game:autozone]", "refresh failed", error);
      });
  };

  const handleToggleAutoZone = () => {
    const nextEnabled = !autoZoneEnabled();
    setAutoZoneEnabled(nextEnabled);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { autoZone } = yield* Automation;
          yield* autoZone.setEnabled(nextEnabled);
          return yield* autoZone.getState();
        }),
      )
      .then(applyAutoZoneState)
      .catch((error: unknown) => {
        console.error("[game:autozone]", "toggle failed", error);
        refreshAutoZoneState();
      });
  };

  const handleSelectAutoZoneMap = (map: AutoZoneSupportedMap | undefined) => {
    setAutoZoneMap(map);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { autoZone } = yield* Automation;
          yield* autoZone.setMap(map);
          return yield* autoZone.getState();
        }),
      )
      .then(applyAutoZoneState)
      .catch((error: unknown) => {
        console.error("[game:autozone]", "set map failed", error);
        refreshAutoZoneState();
      });
  };

  const applyAutoReloginState = (state: AutoReloginState) => {
    setAutoReloginEnabled(state.enabled);
    setAutoReloginCaptured(state.captured);
    setAutoReloginAttempting(state.attempting);
    setAutoReloginWaitingDelay(state.waitingDelay);
    setAutoReloginDelaySeconds(formatDelaySeconds(state.delayMs));
    setAutoReloginServer(state.server ?? "");
    setAutoReloginLastError(state.lastError ?? "");
    setAutoReloginAttemptsRemaining(state.attemptsRemaining ?? null);
  };

  const refreshAutoReloginState = () => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { autoRelogin } = yield* Automation;
          return yield* autoRelogin.getState();
        }),
      )
      .then(applyAutoReloginState)
      .catch((error: unknown) => {
        console.error("[game:autorelogin]", "refresh failed", error);
      });
  };

  const refreshAutoReloginServers = () => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { auth } = yield* Api;
          return yield* auth.getServers();
        }),
      )
      .then((servers) => {
        setAutoReloginServers(servers.map((server) => server.name));
      })
      .catch((error: unknown) => {
        console.error("[game:autorelogin]", "server refresh failed", error);
      });
  };

  const handleToggleAutoRelogin = () => {
    if (autoReloginToggling()) {
      return;
    }

    const nextEnabled = !autoReloginEnabled();
    setAutoReloginToggling(true);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { autoRelogin } = yield* Automation;
          yield* autoRelogin.setEnabled(nextEnabled);
          return yield* autoRelogin.getState();
        }),
      )
      .then(applyAutoReloginState)
      .catch((error: unknown) => {
        console.error("[game:autorelogin]", "toggle failed", error);
        refreshAutoReloginState();
      })
      .finally(() => {
        setAutoReloginToggling(false);
      });
  };

  const handleSelectAutoReloginServer = (server: string) => {
    setAutoReloginServer(server);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { autoRelogin } = yield* Automation;
          yield* autoRelogin.setServer(server);
          return yield* autoRelogin.getState();
        }),
      )
      .then(applyAutoReloginState)
      .catch((error: unknown) => {
        console.error("[game:autorelogin]", "set server failed", error);
        refreshAutoReloginState();
      });
  };

  const handleSetAutoReloginDelay = () => {
    const delayMs = parseDelayMs(autoReloginDelaySeconds());
    if (delayMs === null) {
      refreshAutoReloginState();
      return;
    }

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { autoRelogin } = yield* Automation;
          yield* autoRelogin.setDelay(delayMs);
          return yield* autoRelogin.getState();
        }),
      )
      .then(applyAutoReloginState)
      .catch((error: unknown) => {
        console.error("[game:autorelogin]", "set delay failed", error);
        refreshAutoReloginState();
      });
  };

  const refreshPlayerReady = async (): Promise<boolean> => {
    const version = ++playerReadyRefreshVersion;
    try {
      const ready = await readPlayerReady();
      // Once a session is ready, transient cell/map transition reads must not
      // disable the controls. Explicit unload and disconnect events reset it.
      if (version !== playerReadyRefreshVersion || !ready) return false;

      const settingsBound = await bindScriptSettingsForAuthenticatedAccount();
      if (version !== playerReadyRefreshVersion || !settingsBound) {
        return false;
      }

      setPlayerReady(true);
      return true;
    } catch (error) {
      console.error("[game:player]", "readiness refresh failed", error);
      return false;
    }
  };

  const clearPlayerReadyRetry = () => {
    if (playerReadyRetryTimer === undefined) {
      return;
    }

    window.clearTimeout(playerReadyRetryTimer);
    playerReadyRetryTimer = undefined;
  };

  const stopPlayerReadyRetry = () => {
    playerReadyRetryToken += 1;
    playerReadyRefreshVersion += 1;
    clearPlayerReadyRetry();
  };

  const schedulePlayerReadyRefresh = ({
    onReady,
    retry = false,
  }: {
    readonly onReady?: () => void;
    readonly retry?: boolean;
  } = {}) => {
    const token = ++playerReadyRetryToken;
    const startedAt = Date.now();

    playerReadyRefreshVersion += 1;
    clearPlayerReadyRetry();

    const run = () => {
      playerReadyRetryTimer = undefined;

      if (token !== playerReadyRetryToken || !gameLoaded()) {
        return;
      }

      void refreshPlayerReady().then((ready) => {
        if (token !== playerReadyRetryToken || !gameLoaded()) {
          return;
        }

        if (ready) {
          onReady?.();
          return;
        }

        if (!retry || Date.now() - startedAt >= PLAYER_READY_RETRY_TIMEOUT_MS) {
          return;
        }

        playerReadyRetryTimer = window.setTimeout(
          run,
          PLAYER_READY_RETRY_INTERVAL_MS,
        );
      });
    };

    run();
  };

  const ensurePlayerReady = (): Promise<boolean> =>
    playerReady() ? Promise.resolve(true) : refreshPlayerReady();

  const applyTravelOptions = ({
    currentCell,
    currentPad,
    mapCells,
    mapPads,
  }: TravelOptions) => {
    setCells(mapCells.length > 0 ? mapCells : DEFAULT_CELLS);
    setValidPads(mapPads);
    setSelectedCell(currentCell || mapCells[0] || DEFAULT_CELL);
    setSelectedPad(currentPad || DEFAULT_PAD);
  };

  const syncTravelOptionsFromState = () => {
    void ensurePlayerReady()
      .then((ready) => (ready ? readCachedTravelOptions() : null))
      .then((options) => {
        if (options !== null) {
          applyTravelOptions(options);
        }
      })
      .catch((error: unknown) => {
        console.error("[game:travel]", "state sync failed", error);
      });
  };

  const refreshTravelOptions = () => {
    if (!playerReady()) {
      return;
    }

    void readCachedTravelOptions()
      .then((options) => {
        if (options === null) {
          return null;
        }

        applyTravelOptions(options);
        return readBridgeTravelOptions();
      })
      .then((options) => {
        if (options !== null) {
          applyTravelOptions(options);
        }
      })
      .catch((error: unknown) => {
        console.error("[game:travel]", "refresh failed", error);
      });
  };

  const refreshTravelOptionsAfterJump = () => {
    if (!playerReady()) {
      return;
    }

    void readBridgeTravelOptions()
      .then((options) => {
        if (options !== null) {
          applyTravelOptions(options);
        }
      })
      .catch((error: unknown) => {
        console.error("[game:travel]", "post-jump refresh failed", error);
      });
  };

  const resetTravelOptions = () => {
    setCells(DEFAULT_CELLS);
    setValidPads([]);
    setSelectedCell(DEFAULT_CELL);
    setSelectedPad(DEFAULT_PAD);
    setTravelBusy(false);
  };

  const jumpToCellPad = (cell: string, pad: string) => {
    if (!playerReady() || travelBusy()) {
      return;
    }

    const targetCell = cell.trim() || DEFAULT_CELL;
    const targetPad = pad.trim();

    setTravelBusy(true);
    setSelectedCell(targetCell);
    if (targetPad !== "") {
      setSelectedPad(targetPad);
    }
    setOpenMenu(null);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { player } = yield* Api;
          yield* player.jumpToCell(
            targetCell,
            targetPad === "" ? undefined : targetPad,
          );
          const [currentCell, currentPad] = yield* Effect.all([
            player.getCell(),
            player.getPad(),
          ]);

          return {
            currentCell,
            currentPad,
          };
        }),
      )
      .then(({ currentCell, currentPad }) => {
        setSelectedCell(currentCell.trim() || targetCell);
        setSelectedPad(currentPad.trim() || targetPad || DEFAULT_PAD);
        refreshTravelOptionsAfterJump();
      })
      .catch((error: unknown) => {
        console.error("[game:travel]", "jump failed", error);
        schedulePlayerReadyRefresh({ retry: true });
      })
      .finally(() => {
        setTravelBusy(false);
      });
  };

  const handleSelectCell = (cell: string) => {
    jumpToCellPad(cell, selectedPad());
  };

  const handleSelectPad = (pad: string) => {
    jumpToCellPad(selectedCell(), pad);
  };

  const autoAttackConfiguredProfileLabel = createMemo(() =>
    getAutoAttackConfiguredProfileLabel(
      combatProfileLibrary(),
      selectedAutoAttackProfileId(),
    ),
  );

  const applyAutoAttackState = (state: AutoAttackState): void => {
    setAutoAttackEnabled(state.enabled);
    setAutoAttackProfileLabel(
      state.profileLabel ?? autoAttackConfiguredProfileLabel(),
    );
    setAutoAttackLastError(state.lastError ?? "");
  };

  const refreshAutoAttackState = (): void => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { autoAttack } = yield* Automation;
          return yield* autoAttack.getState();
        }),
      )
      .then(applyAutoAttackState)
      .catch((error: unknown) => {
        console.error("[game:autoattack]", "state refresh failed", error);
      });
  };

  const applyCombatProfileLibrary = (library: CombatProfileLibrary): void => {
    setCombatProfileLibrary(library);
    const selectedProfileId = getAvailableAutoAttackProfileId(
      library,
      selectedAutoAttackProfileId(),
    );
    if (selectedProfileId !== selectedAutoAttackProfileId()) {
      setSelectedAutoAttackProfileId(selectedProfileId);
    }
    if (!autoAttackEnabled()) {
      setAutoAttackProfileLabel(
        getAutoAttackConfiguredProfileLabel(library, selectedProfileId),
      );
    }
  };

  const handleToggleAutoAttack = (): void => {
    if (autoAttackToggleInFlight || (!autoAttackEnabled() && !playerReady())) {
      return;
    }

    autoAttackToggleInFlight = true;
    const nextEnabled = !autoAttackEnabled();
    setAutoAttackEnabled(nextEnabled);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { autoAttack } = yield* Automation;
          const library = combatProfileLibrary();
          const selectedProfileId = getAvailableAutoAttackProfileId(
            library,
            selectedAutoAttackProfileId(),
          );
          if (selectedProfileId !== selectedAutoAttackProfileId()) {
            setSelectedAutoAttackProfileId(selectedProfileId);
          }
          return nextEnabled
            ? yield* autoAttack.enable({
                library,
                profileId: selectedProfileId,
                targetPriority: parseAutoAttackTargetPriority(
                  autoAttackTargetPriority(),
                ),
              })
            : yield* autoAttack.disable();
        }),
      )
      .then(applyAutoAttackState)
      .catch((error: unknown) => {
        console.error("[game:autoattack]", "toggle failed", error);
        refreshAutoAttackState();
      })
      .finally(() => {
        autoAttackToggleInFlight = false;
      });
  };

  const handleOpenBank = () => {
    if (!playerReady()) {
      return;
    }

    setOpenMenu(null);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { bank } = yield* Api;
          yield* bank.open();
        }),
      )
      .catch((error: unknown) => {
        console.error("[game:bank]", "open failed", error);
        schedulePlayerReadyRefresh({ retry: true });
      });
  };

  const toggleTopNav = () => {
    setTopNavVisible((visible) => !visible);
    setOpenMenu(null);
  };

  const toggleOptionsMenu = () => {
    setOpenMenu((menu) => (menu === "options" ? null : "options"));
  };

  const handleOpenWindow = (id: WindowId) => {
    setOpenMenu(null);
    void window.desktop.windows?.open(id).catch((error: unknown) => {
      console.error(`[game] failed to open window ${id}`, error);
    });
  };

  const getScriptInputsDefinition = (): ScriptInputsDefinition | null =>
    loadedScript()?.inputs ?? null;

  const resetScriptInputDialogRefs = (): void => {
    scriptInputFieldRefs.clear();
    scriptInputEditorRefs.clear();
  };

  const setScriptInputFieldRef = (key: string, element: HTMLElement): void => {
    scriptInputFieldRefs.set(key, element);
  };

  const setScriptInputEditorRef = (key: string, element: HTMLElement): void => {
    scriptInputEditorRefs.set(key, element);
  };

  const scriptInputFieldHasError = (key: string): boolean =>
    scriptInputDialogError()?.fields.some((field) => field.key === key) ??
    false;

  const scriptInputFieldErrorMessage = (key: string): string | undefined =>
    scriptInputDialogError()?.fields.find((field) => field.key === key)
      ?.message;

  const scriptInputFieldElement = (key: string): HTMLElement | undefined =>
    scriptInputFieldRefs.get(key) ??
    Array.from(
      document.querySelectorAll<HTMLElement>(
        ".game-script-inputs-dialog__field[data-script-input-key]",
      ),
    ).find((element) => element.dataset["scriptInputKey"] === key);

  const scriptInputEditorElement = (
    fieldElement: HTMLElement | undefined,
    key: string,
  ): HTMLElement | undefined =>
    fieldElement?.querySelector<HTMLElement>(
      "[data-slot='combobox-input'], [data-slot='input'], .checkbox__input, input, button, [tabindex]:not([tabindex='-1'])",
    ) ??
    scriptInputEditorRefs.get(key) ??
    undefined;

  const focusScriptInputField = (key: string): void => {
    const fieldElement = scriptInputFieldElement(key);
    fieldElement?.scrollIntoView({ block: "center", inline: "nearest" });
    window.requestAnimationFrame(() => {
      const editorElement = scriptInputEditorElement(
        scriptInputFieldElement(key),
        key,
      );
      try {
        editorElement?.focus({ preventScroll: true });
      } catch {
        editorElement?.focus();
      }
    });
  };

  const refreshScriptInputValues = (
    definition: ScriptInputsDefinition,
  ): Promise<ScriptInputValues> => {
    const bridge = window.desktop.scripting;
    return bridge === undefined
      ? Promise.resolve(normalizeScriptInputValues(definition, {}))
      : bridge.getInputValues(definition);
  };

  const saveScriptInputValues = (
    definition: ScriptInputsDefinition,
    values: ScriptInputValues,
  ): Promise<ScriptInputValues> => {
    const normalized = normalizeScriptInputValues(definition, values);
    const bridge = window.desktop.scripting;
    return bridge === undefined
      ? Promise.resolve(normalized)
      : bridge.saveInputValues(definition, normalized);
  };

  const showFatalScriptAlert = (alert: FatalScriptAlert): void => {
    if (alert.key === lastShownFatalScriptAlertKey) {
      return;
    }

    lastShownFatalScriptAlertKey = alert.key;
    setOpenMenu(null);
    setFatalScriptAlert(alert);
    setFatalScriptAlertCopied(false);
    setFatalScriptAlertOpen(true);
  };

  const showFatalScriptError = (
    sourceName: string,
    error: unknown,
    sourcePath?: string,
  ): void => {
    showFatalScriptAlert(
      fatalScriptAlertFromError(sourceName, error, sourcePath),
    );
  };

  const applyScriptRunnerStatus = (status: ScriptRunnerStatus): void => {
    setScriptRunnerStatus(status);
    if (status.state === "failed") {
      showFatalScriptAlert(fatalScriptAlertFromStatus(status));
    }
  };

  const markFatalScriptAlertCopied = (): void => {
    if (fatalScriptAlertCopiedTimer !== undefined) {
      window.clearTimeout(fatalScriptAlertCopiedTimer);
    }

    setFatalScriptAlertCopied(true);
    fatalScriptAlertCopiedTimer = window.setTimeout(() => {
      setFatalScriptAlertCopied(false);
      fatalScriptAlertCopiedTimer = undefined;
    }, 900);
  };

  const copyFatalScriptAlertDetails = async (): Promise<void> => {
    const detailsText = fatalScriptAlert()?.detailsText;
    if (detailsText === undefined || detailsText.trim() === "") {
      return;
    }

    try {
      await navigator.clipboard.writeText(detailsText);
      markFatalScriptAlertCopied();
    } catch (error) {
      console.error("Failed to copy script stack trace:", error);
    }
  };

  const selectScript = async (stopCurrent = false) => {
    if (scriptBusy()) {
      return;
    }

    const bridge = window.desktop.scripting;
    if (bridge === undefined) {
      console.warn("[game:script]", "desktop scripting bridge unavailable");
      return;
    }

    setScriptBusy(true);
    try {
      const stopPromise = stopCurrent
        ? runtime.runPromise(
            Effect.gen(function* () {
              const runner = yield* ScriptRunner;
              return yield* runner.stop("replaced");
            }),
          )
        : Promise.resolve<ScriptRunnerStatus | null>(null);
      const [stoppedStatus, result] = await Promise.all([
        stopPromise,
        bridge.openFile(),
      ]);
      if (stoppedStatus !== null) {
        applyScriptRunnerStatus(stoppedStatus);
      }
      if (result.canceled) {
        return;
      }

      const inputValues =
        result.file.inputs === null
          ? {}
          : await refreshScriptInputValues(result.file.inputs);

      if (!stopCurrent && scriptRunning()) {
        const status = await runtime.runPromise(
          Effect.gen(function* () {
            const runner = yield* ScriptRunner;
            return yield* runner.stop("replaced");
          }),
        );
        applyScriptRunnerStatus(status);
      }

      setLoadedScript(result.file);
      setScriptRunnerStatus({ state: "idle" });
      setScriptInputDialogError(null);
      setScriptInputValues(inputValues);
      setOpenMenu(null);
    } catch (error) {
      console.error("[game:script]", "load failed", error);
    } finally {
      setScriptBusy(false);
    }
  };

  const loadScript = (): void => {
    if (scriptBusy()) {
      return;
    }

    if (scriptRunning()) {
      setOpenMenu(null);
      setScriptReplacementDialogOpen(true);
      return;
    }

    void selectScript();
  };

  const openScriptInputsDialog = (
    mode: ScriptInputsDialogMode,
    definition: ScriptInputsDefinition,
    values: ScriptInputValues,
  ): void => {
    resetScriptInputDialogRefs();
    setScriptInputDialogMode(mode);
    setScriptInputDraftValues(scriptInputDraftFromValues(definition, values));
    setScriptInputDialogError(null);
    setScriptInputDialogSaving(false);
    setScriptInputDialogOpen(true);
    setOpenMenu(null);
  };

  const openScriptInputs = () => {
    const definition = getScriptInputsDefinition();
    if (definition === null || scriptRunning() || scriptInputDialogSaving()) {
      return;
    }

    openScriptInputsDialog("manual", definition, scriptInputValues());
  };

  const cancelScriptInputsDialog = (): void => {
    if (scriptInputDialogSaving()) {
      return;
    }

    resetScriptInputDialogRefs();
    setScriptInputDialogOpen(false);
    setScriptInputDialogError(null);
  };

  const startLoadedScript = async (
    file: ScriptFile,
    inputValues: ScriptInputValues,
  ): Promise<void> => {
    const status = await runtime.runPromise(
      Effect.gen(function* () {
        const runner = yield* ScriptRunner;
        return yield* runner.start(file, inputValues);
      }),
    );
    applyScriptRunnerStatus(status);
    setOpenMenu(null);
  };

  const prepareAndStartLoadedScript = async (
    currentFile: ScriptFile,
    currentInputValues: ScriptInputValues,
    inputsPersistedForRevision?: string,
  ): Promise<void> => {
    const scripting = window.desktop.scripting;
    const prepared = await prepareScriptStart(
      { file: currentFile, inputValues: currentInputValues },
      scriptReloadBeforeStart(),
      {
        getInputValues: refreshScriptInputValues,
        readFile: (path) => {
          if (scripting === undefined) {
            return Promise.reject(
              new Error("Desktop scripting bridge unavailable"),
            );
          }
          return scripting.readFile(path);
        },
      },
    );
    const revisionChanged = prepared.file.revision !== currentFile.revision;

    setLoadedScript(prepared.file);
    setScriptInputValues(prepared.inputValues);
    setScriptInputDialogError(null);
    if (revisionChanged) {
      setScriptRunnerStatus({ state: "idle" });
    }

    if (
      prepared.status === "missing-required" &&
      prepared.file.inputs !== null
    ) {
      openScriptInputsDialog(
        "required",
        prepared.file.inputs,
        prepared.inputValues,
      );
      return;
    }

    let inputValues = prepared.inputValues;
    if (
      prepared.file.inputs !== null &&
      prepared.file.revision !== inputsPersistedForRevision
    ) {
      inputValues = await saveScriptInputValues(
        prepared.file.inputs,
        inputValues,
      );
      setScriptInputValues(inputValues);
    }

    await startLoadedScript(prepared.file, inputValues);
  };

  const accountScriptLabel = (
    script: AccountScriptReference | undefined,
  ): string | undefined => script?.name ?? script?.path;

  const publishAccountStatus = async (
    update: AccountScriptStatusUpdate,
  ): Promise<boolean> => {
    const bridge = window.desktop.gameAccounts;
    if (bridge === undefined) {
      return false;
    }

    try {
      await bridge.updateScriptStatus(update);
      return true;
    } catch (error) {
      console.error("[game:account-launch]", "status publish failed", error);
      return false;
    }
  };

  const readAccountCurrentUsername = async (): Promise<string | undefined> => {
    try {
      const username = await runtime.runPromise(
        Effect.gen(function* () {
          const { auth } = yield* Api;
          return yield* auth.getUsername();
        }),
      );
      const normalized = username.trim();
      return normalized === "" ? undefined : normalized;
    } catch (error) {
      console.error("[game:account-launch]", "username refresh failed", error);
      return undefined;
    }
  };

  const applyScriptOptions = (options: ScriptRunnerOptions): void => {
    setScriptReloadBeforeStart(options.reloadBeforeStart);
    setScriptRestartAfterReconnect(options.restartAfterReconnect);
    setScriptRoomPolicy({ ...options.roomPolicy });
    setScriptSafeStartStop(options.safeStartStop);
    setScriptRoomNumberDraft(
      formatRoomNumberInput(
        options.roomPolicy.kind === "specific"
          ? options.roomPolicy.roomNumber
          : null,
      ),
    );
    setScriptRoomNumberError("");
  };

  const clearScriptSettingsBinding = (): void => {
    scriptSettingsBindToken += 1;
    setBoundScriptSettingsUsername(null);
  };

  const bindScriptSettingsForAuthenticatedAccount =
    async (): Promise<boolean> => {
      const username = await readAccountCurrentUsername();
      if (username === undefined) {
        clearScriptSettingsBinding();
        return false;
      }

      void publishDirectGameConnectionStatus(username);

      const normalized = username.toLowerCase();
      if (boundScriptSettingsUsername() === normalized) {
        return true;
      }

      const token = ++scriptSettingsBindToken;
      setBoundScriptSettingsUsername(null);
      try {
        const options = await runtime.runPromise(
          Effect.gen(function* () {
            const runner = yield* ScriptRunner;
            return yield* runner.bindAccount(username);
          }),
        );
        if (token !== scriptSettingsBindToken) return false;

        applyScriptOptions(options);
        setBoundScriptSettingsUsername(normalized);
        return true;
      } catch (error) {
        if (token === scriptSettingsBindToken) {
          setBoundScriptSettingsUsername(null);
        }
        console.error(
          "[game:script]",
          "account settings binding failed",
          error,
        );
        return false;
      }
    };

  const publishDirectGameConnectionStatus = async (
    currentUsername: string,
  ): Promise<void> => {
    if (activeAccountLaunchPayload !== null) {
      return;
    }

    const normalized = currentUsername.trim().toLowerCase();
    if (normalized === "" || normalized === lastPublishedDirectGameUsername) {
      return;
    }

    const published = await publishAccountStatus({
      currentUsername,
      status: "stopped",
      message: "Logged in",
    });
    if (published) {
      lastPublishedDirectGameUsername = normalized;
    }
  };

  const accountScriptRunnerUpdate = (
    status: ScriptRunnerStatus,
    currentUsername: string,
    scriptName: string | undefined,
  ): AccountScriptStatusUpdate => ({
    currentUsername,
    ...(scriptName === undefined ? {} : { scriptName }),
    status:
      status.state === "starting"
        ? "starting"
        : status.state === "waiting-to-restart"
          ? "starting"
          : status.state === "running" || status.state === "stopping"
            ? "running"
            : status.state === "failed"
              ? "failed"
              : status.state === "idle"
                ? "idle"
                : "stopped",
    ...(status.state === "failed"
      ? { message: status.message }
      : status.state === "waiting-to-restart"
        ? { message: "Waiting to restart" }
        : status.state === "stopped"
          ? { message: status.reason ?? "Stopped" }
          : status.state === "completed"
            ? { message: "Completed" }
            : {}),
  });

  const publishAccountLaunchStatus = async (
    status: AccountScriptStatusUpdate["status"],
    message?: string,
  ): Promise<void> => {
    const payload = activeAccountLaunchPayload;
    if (payload === null) {
      return;
    }

    const scriptName = accountScriptLabel(payload.script);
    const currentUsername =
      (await readAccountCurrentUsername()) ?? payload.account.username;
    await publishAccountStatus({
      currentUsername,
      ...(scriptName === undefined ? {} : { scriptName }),
      status,
      ...(message === undefined ? {} : { message }),
    });
  };

  const publishAccountScriptRunnerStatus = async (
    status: ScriptRunnerStatus,
  ): Promise<void> => {
    const payload = activeAccountLaunchPayload;
    if (payload === null) {
      return;
    }

    const scriptName =
      "name" in status ? status.name : accountScriptLabel(payload.script);
    const currentUsername =
      (await readAccountCurrentUsername()) ?? payload.account.username;
    await publishAccountStatus(
      accountScriptRunnerUpdate(status, currentUsername, scriptName),
    );
  };

  const enqueueAccountScriptRunnerStatus = (
    status: ScriptRunnerStatus,
  ): void => {
    accountScriptRunnerStatusPublishQueue =
      accountScriptRunnerStatusPublishQueue
        .then(() => publishAccountScriptRunnerStatus(status))
        .catch((error: unknown) => {
          console.error(
            "[game:account-launch]",
            "runner status publish failed",
            error,
          );
        });
  };

  const publishAccountConnectionStatus = async (): Promise<void> => {
    const payload = activeAccountLaunchPayload;
    const currentUsername = await readAccountCurrentUsername();
    if (currentUsername === undefined) {
      return;
    }
    if (payload === null) {
      await publishDirectGameConnectionStatus(currentUsername);
      return;
    }

    if (payload.script === undefined || activeAccountScriptMissing) {
      await publishAccountStatus({
        currentUsername,
        status: "stopped",
        message: "Logged in",
      });
      return;
    }

    const status = scriptRunnerStatus();
    const scriptName =
      "name" in status ? status.name : accountScriptLabel(payload.script);
    await publishAccountStatus(
      accountScriptRunnerUpdate(status, currentUsername, scriptName),
    );
  };

  const wait = (delayMs: number): Promise<void> =>
    new Promise((resolve) => window.setTimeout(resolve, delayMs));

  const waitForGameLoaded = async (): Promise<boolean> => {
    if (gameLoaded()) return true;
    return Promise.race([
      gameLoadedPromise.then(() => true),
      wait(ACCOUNT_LAUNCH_GAME_LOAD_TIMEOUT_MS).then(() => false),
    ]);
  };

  const runAccountLaunch = async (
    payload: AccountGameLaunchPayload,
  ): Promise<void> => {
    activeAccountLaunchPayload = payload;
    activeAccountScriptMissing = false;
    await publishAccountLaunchStatus("starting", "Waiting...");

    try {
      if (!(await waitForGameLoaded())) {
        throw new Error(`Game did not finish loading (${progress()}%)`);
      }

      const loginResult = await runtime.runPromise(
        Effect.gen(function* () {
          const { autoRelogin } = yield* Automation;
          return yield* autoRelogin.runLogin({
            onLifecycle: (event) =>
              Effect.promise(() =>
                publishAccountLaunchStatus(
                  "starting",
                  accountLaunchLifecycleMessage(event, payload.server),
                ),
              ),
            password: payload.account.password,
            ...(payload.server === undefined ? {} : { server: payload.server }),
            username: payload.account.username,
          });
        }),
      );

      if (loginResult.status === "server-select") {
        if (payload.script !== undefined) {
          throw new Error("Login server required to start script");
        }

        await publishAccountLaunchStatus("stopped", "Logged in");
        return;
      }

      await refreshPlayerReady();
      if (payload.script === undefined) {
        await publishAccountLaunchStatus("stopped", "Logged in");
        return;
      }

      const bridge = window.desktop.scripting;
      if (bridge === undefined) {
        throw new Error("Desktop scripting bridge unavailable");
      }

      await publishAccountLaunchStatus("starting", "Loading script...");
      const file = await resolveAccountScript(
        (path) => bridge.resolveFile(path),
        payload.script.path,
      );
      if (file === null) {
        activeAccountScriptMissing = true;
        setLoadedScript(null);
        setScriptRunnerStatus({ state: "idle" });
        setScriptInputValues({});
        setScriptInputDialogError(null);
        await publishAccountLaunchStatus("stopped", "Logged in");
        return;
      }
      setLoadedScript(file);
      setScriptRunnerStatus({ state: "idle" });
      setScriptInputDialogError(null);

      let inputValues: ScriptInputValues = {};
      if (file.inputs !== null) {
        const refreshed = await refreshScriptInputValues(file.inputs);
        const validation = validateScriptInputValues(file.inputs, refreshed);
        if (validation.status === "missing-required") {
          throw new Error("Script inputs required");
        }
        inputValues = await saveScriptInputValues(
          file.inputs,
          validation.values,
        );
      }
      setScriptInputValues(inputValues);

      await publishAccountLaunchStatus("starting", "Starting script...");
      await startLoadedScript(file, inputValues);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Account launch failed";
      console.error("[game:account-launch]", message, error);
      if (payload.script !== undefined) {
        showFatalScriptError(
          accountScriptLabel(payload.script) ?? "script",
          error,
          payload.script.path,
        );
      }
      await publishAccountLaunchStatus("failed", message);
    }
  };

  const persistScriptInputs = async () => {
    const file = loadedScript();
    if (file?.inputs === null || file?.inputs === undefined) {
      setScriptInputDialogOpen(false);
      return;
    }
    const definition = file.inputs;

    if (scriptInputDialogSaving()) {
      return;
    }

    const result = scriptInputValuesFromDraft(
      definition,
      scriptInputDraftValues(),
    );
    if (!result.ok) {
      setScriptInputDialogError(result.error);
      window.requestAnimationFrame(() => {
        const first = result.error.fields[0];
        if (first !== undefined) {
          focusScriptInputField(first.key);
        }
      });
      return;
    }

    setScriptInputDialogSaving(true);
    const shouldStart = scriptInputDialogMode() === "required";
    if (shouldStart) {
      setScriptBusy(true);
    }

    try {
      const saved = await saveScriptInputValues(definition, result.values);
      setScriptInputValues(saved);
      setScriptInputDialogError(null);
      setScriptInputDialogOpen(false);
      resetScriptInputDialogRefs();

      if (shouldStart) {
        await prepareAndStartLoadedScript(file, saved, file.revision);
      }
    } catch (error) {
      console.error("[game:script]", "save inputs failed", error);
      if (shouldStart) {
        const file = loadedScript();
        if (file !== null) {
          showFatalScriptError(file.name, error, file.path);
        }
      }
      setScriptInputDialogError({
        fields: [],
        message: shouldStart
          ? "Failed to save inputs or start script."
          : "Failed to save inputs.",
      });
    } finally {
      setScriptInputDialogSaving(false);
      if (shouldStart) {
        setScriptBusy(false);
      }
    }
  };

  const updateScriptInputDraft = (
    key: string,
    value: ScriptInputDraftValue,
  ): void => {
    setScriptInputDraftValues((current) => ({ ...current, [key]: value }));
    setScriptInputDialogError(null);
  };

  const toggleScript = async () => {
    const wasRunning = scriptRunning();
    if (wasRunning) {
      if (scriptStopInFlight()) {
        return;
      }

      setScriptStopInFlight(true);
      try {
        const status = await runtime.runPromise(
          Effect.gen(function* () {
            const runner = yield* ScriptRunner;
            return yield* runner.stop("user requested stop");
          }),
        );
        setScriptRunnerStatus(status);
      } catch (error) {
        console.error("[game:script]", "stop failed", error);
      } finally {
        setScriptStopInFlight(false);
      }
      return;
    }

    if (scriptBusy() || !scriptReady()) {
      return;
    }

    const file = loadedScript();
    setScriptBusy(true);
    try {
      if (file === null) {
        return;
      }

      await prepareAndStartLoadedScript(file, scriptInputValues());
    } catch (error) {
      console.error("[game:script]", "toggle failed", error);
      if (!wasRunning && file !== null) {
        showFatalScriptError(file.name, error, file.path);
      }
    } finally {
      setScriptBusy(false);
    }
  };

  const syncScriptOptions = () => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          return yield* runner.getOptions();
        }),
      )
      .then(applyScriptOptions)
      .catch((error: unknown) => {
        console.error("[game:script]", "option sync failed", error);
      });
  };

  const handleSelectScriptRoomPolicy = (
    policy: Exclude<RoomPolicy, { readonly kind: "specific" }>,
  ) => {
    setScriptRoomPolicy(policy);
    setScriptRoomNumberDraft("");
    setScriptRoomNumberError("");
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          return yield* runner.setRoomPolicy(policy);
        }),
      )
      .then(applyScriptOptions)
      .catch((error: unknown) => {
        console.error("[game:script]", "room mode update failed", error);
        syncScriptOptions();
      });
  };

  const handleToggleScriptSafeStartStop = () => {
    const enabled = !scriptSafeStartStop();
    setScriptSafeStartStop(enabled);
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          return yield* runner.setSafeStartStop(enabled);
        }),
      )
      .then(applyScriptOptions)
      .catch((error: unknown) => {
        console.error("[game:script]", "safe-start-stop toggle failed", error);
        syncScriptOptions();
      });
  };

  const handleToggleScriptReloadBeforeStart = () => {
    const enabled = !scriptReloadBeforeStart();
    setScriptReloadBeforeStart(enabled);
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          return yield* runner.setReloadBeforeStart(enabled);
        }),
      )
      .then(applyScriptOptions)
      .catch((error: unknown) => {
        console.error(
          "[game:script]",
          "reload-before-start toggle failed",
          error,
        );
        syncScriptOptions();
      });
  };

  const handleToggleScriptRestartAfterReconnect = () => {
    const enabled = !scriptRestartAfterReconnect();
    setScriptRestartAfterReconnect(enabled);
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          return yield* runner.setRestartAfterReconnect(enabled);
        }),
      )
      .then(applyScriptOptions)
      .catch((error: unknown) => {
        console.error(
          "[game:script]",
          "restart-after-reconnect toggle failed",
          error,
        );
        syncScriptOptions();
      });
  };

  const handleCommitScriptRoomNumber = () => {
    const parsed = parseRoomNumberInput(scriptRoomNumberDraft());
    if (parsed.status === "invalid") {
      setScriptRoomNumberError("Enter a room from 1 to 99999.");
      return;
    }

    setScriptRoomNumberError("");
    const policy: RoomPolicy = {
      kind: "specific",
      roomNumber: parsed.value,
    };
    setScriptRoomPolicy(policy);
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          return yield* runner.setRoomPolicy(policy);
        }),
      )
      .then(applyScriptOptions)
      .catch((error: unknown) => {
        console.error(
          "[game:script]",
          "specific-room number update failed",
          error,
        );
        syncScriptOptions();
      });
  };

  const handleToggleFollower = () => {
    setOpenMenu(null);
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { follower } = yield* Automation;
          return yield* follower.toggle(combatProfileLibrary());
        }),
      )
      .catch((error: unknown) => {
        console.error("[game:follower]", "toggle failed", error);
      });
  };

  const selectOptionCommand = (commandId: SettingsCommandId) => {
    const optionId = topNavOptionCommandIds[commandId];
    if (optionId === undefined) {
      return;
    }

    const option = optionItems().find((item) => item.id === optionId);
    if (option === undefined || option.disabled === true) {
      return;
    }

    option.onCheckedChange(!option.checked);
    setOpenMenu(null);
  };

  const commandHandlers = createMemo<
    ReadonlyMap<SettingsCommandId, GameHotkeyHandler>
  >(() => {
    const handlers = new Map<SettingsCommandId, GameHotkeyHandler>([
      ["toggleTopBar", toggleTopNav],
      ["loadScript", loadScript],
      ["toggleScript", toggleScript],
      ["toggleOptionsMenu", toggleOptionsMenu],
      ["toggleAutoattack", handleToggleAutoAttack],
      ["toggleFollower", handleToggleFollower],
      ["toggleBank", handleOpenBank],
    ]);

    for (const commandId of Object.keys(
      topNavOptionCommandIds,
    ) as SettingsCommandId[]) {
      handlers.set(commandId, () => selectOptionCommand(commandId));
    }

    for (const commandId of windowIdsByCommandId.keys()) {
      handlers.set(commandId, () => {
        const windowId = windowIdsByCommandId.get(commandId);
        if (windowId !== undefined) {
          handleOpenWindow(windowId);
        }
      });
    }

    return handlers;
  });

  const hotkeyHandlersByMatchKey = createMemo(() => {
    const handlers = commandHandlers();
    const byMatchKey = new Map<string, GameHotkeyHandler>();

    for (const command of SETTINGS_COMMANDS) {
      const handler = handlers.get(command.id);
      if (handler === undefined) {
        continue;
      }

      const matchKey = hotkeyBindingMatchKey(
        readHotkeyBinding(settings().hotkeys.bindings, command.id),
        props.platform,
      );
      if (matchKey !== null && !byMatchKey.has(matchKey)) {
        byMatchKey.set(matchKey, handler);
      }
    }

    return byMatchKey;
  });

  onMount(() => {
    let disposed = false;
    const unsubscribeSettings = window.desktop.settings.onChanged(setSettings);
    const unsubscribeCombatProfiles =
      window.desktop.combatProfiles?.onChanged(applyCombatProfileLibrary) ??
      (() => {});

    void window.desktop.settings
      .get()
      .then((nextSettings) => {
        if (!disposed) {
          setSettings(nextSettings);
        }
      })
      .catch((error: unknown) => {
        console.error("[game:settings]", "desktop sync failed", error);
      });

    void window.desktop.combatProfiles
      ?.getState()
      .then((library) => {
        if (!disposed) {
          applyCombatProfileLibrary(library);
        }
      })
      .catch((error: unknown) => {
        console.error("[game:combat-profiles]", "desktop sync failed", error);
      });

    onCleanup(() => {
      disposed = true;
      unsubscribeSettings();
      unsubscribeCombatProfiles();
    });
  });

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        fatalScriptAlertOpen() ||
        isEditableHotkeyTarget(event.target) ||
        isFlashTextFieldFocused()
      ) {
        return;
      }

      const matchKey = hotkeyInputMatchKey(event, props.platform);
      if (matchKey === null) {
        return;
      }

      const handler = hotkeyHandlersByMatchKey().get(matchKey);
      if (handler === undefined) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void handler();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    });
  });

  onMount(() => {
    let autoAttackDisposer: (() => void) | undefined;
    let autoReloginDisposer: (() => void) | undefined;
    let autoZoneDisposer: (() => void) | undefined;
    let flashSettingsDisposer: (() => void) | undefined;
    let scriptOptionsDisposer: (() => void) | undefined;
    let scriptStatusDisposer: (() => void) | undefined;
    let cleanedUp = false;

    const travelEventFiber = runtime.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const { events } = yield* Api;
          yield* events.on({ type: "join-map" }, () =>
            Effect.sync(() => {
              resetTravelOptions();
              schedulePlayerReadyRefresh({
                onReady: syncTravelOptionsFromState,
                retry: true,
              });
            }),
          );
          yield* events.on({ type: "connection" }, (event) =>
            Effect.sync(() => {
              const status = event.type === "connection" ? event.status : "";
              if (
                status === "OnConnectionLost" ||
                status === "OnConnectionFailed"
              ) {
                stopPlayerReadyRetry();
                setPlayerReady(false);
                clearScriptSettingsBinding();
                resetTravelOptions();
              }

              if (status === "OnConnection") {
                schedulePlayerReadyRefresh({ retry: true });
                void publishAccountConnectionStatus();
              }
              refreshAutoReloginState();
            }),
          );
          return yield* Effect.never;
        }),
      ),
    );

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { settings } = yield* Api;
          return yield* settings.onState(applyFlashSettingsState);
        }),
      )
      .then((dispose) => {
        if (cleanedUp) {
          dispose();
          return;
        }

        flashSettingsDisposer = dispose;
      })
      .catch((error: unknown) => {
        console.error("[game:settings]", "state subscription failed", error);
        refreshFlashSettings();
      });

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { autoAttack } = yield* Automation;
          return yield* autoAttack.onState(applyAutoAttackState);
        }),
      )
      .then((dispose) => {
        if (cleanedUp) {
          dispose();
          return;
        }

        autoAttackDisposer = dispose;
      })
      .catch((error: unknown) => {
        console.error("[game:autoattack]", "state subscription failed", error);
        refreshAutoAttackState();
      });

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { autoZone } = yield* Automation;
          return yield* autoZone.onState(applyAutoZoneState);
        }),
      )
      .then((dispose) => {
        if (cleanedUp) {
          dispose();
          return;
        }

        autoZoneDisposer = dispose;
      })
      .catch((error: unknown) => {
        console.error("[game:autozone]", "state subscription failed", error);
      });

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const { autoRelogin } = yield* Automation;
          return yield* autoRelogin.onState(applyAutoReloginState);
        }),
      )
      .then((dispose) => {
        if (cleanedUp) {
          dispose();
          return;
        }

        autoReloginDisposer = dispose;
      })
      .catch((error: unknown) => {
        console.error("[game:autorelogin]", "state subscription failed", error);
      });

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          const status = yield* runner.getStatus();
          const options = yield* runner.getOptions();
          const dispose = yield* runner.onStatus((nextStatus) => {
            applyScriptRunnerStatus(nextStatus);
            enqueueAccountScriptRunnerStatus(nextStatus);
          });
          const disposeOptions = yield* runner.onOptions((nextOptions) => {
            applyScriptOptions(nextOptions);
          });
          return { dispose, disposeOptions, options, status };
        }),
      )
      .then(({ dispose, disposeOptions, options, status }) => {
        applyScriptRunnerStatus(status);
        applyScriptOptions(options);

        if (cleanedUp) {
          dispose();
          disposeOptions();
          return;
        }

        scriptStatusDisposer = dispose;
        scriptOptionsDisposer = disposeOptions;
      })
      .catch((error: unknown) => {
        console.error("[game:script]", "state subscription failed", error);
      });

    void window.desktop.gameAccounts
      ?.getGameLaunch()
      .then((payload) => {
        if (payload !== null) {
          void runAccountLaunch(payload);
        }
      })
      .catch((error: unknown) => {
        console.error("[game:account-launch]", "payload load failed", error);
      });

    onCleanup(() => {
      cleanedUp = true;
      autoAttackDisposer?.();
      autoReloginDisposer?.();
      autoZoneDisposer?.();
      flashSettingsDisposer?.();
      scriptOptionsDisposer?.();
      scriptStatusDisposer?.();
      stopPlayerReadyRetry();
      resetTravelOptions();
      runtime.runFork(Fiber.interrupt(travelEventFiber));
      if (fatalScriptAlertCopiedTimer !== undefined) {
        window.clearTimeout(fatalScriptAlertCopiedTimer);
      }
    });
  });

  createEffect(() => {
    const loaded = gameLoaded();
    writeDocumentLoaded(loaded);
    if (loaded) {
      schedulePlayerReadyRefresh({ retry: true });
    } else {
      stopPlayerReadyRetry();
      setPlayerReady(false);
      clearScriptSettingsBinding();
    }
  });

  createEffect(() => {
    writeTopNavHidden(!topNavVisible());
  });

  onCleanup(() => {
    writeTopNavHidden(false);
  });

  const renderScriptInputField = (field: ScriptInputField): JSX.Element => {
    const value = () => scriptInputDraftValues()[field.key];
    const label = () => fieldLabel(field);
    const hasError = () => scriptInputFieldHasError(field.key);

    if (field.type === "boolean") {
      return (
        <div
          class="game-script-inputs-dialog__field"
          data-invalid={hasError() ? "" : undefined}
          data-script-input-key={field.key}
          ref={(element) => setScriptInputFieldRef(field.key, element)}
        >
          <Checkbox
            aria-label={label()}
            checked={value() === true}
            disabled={scriptInputDialogSaving()}
            invalid={hasError()}
            ref={(element) => setScriptInputEditorRef(field.key, element)}
            onInput={(event) =>
              updateScriptInputDraft(field.key, event.currentTarget.checked)
            }
          >
            <span class="game-script-inputs-dialog__checkbox-label-content">
              <span class="game-script-inputs-dialog__checkbox-label-text">
                {label()}
                <Show when={field.required === true}>
                  <span
                    aria-hidden="true"
                    class="game-script-inputs-dialog__field-required game-script-inputs-dialog__field-required--inline"
                  >
                    {" "}
                    *
                  </span>
                </Show>
                <Show when={field.required !== true}>
                  <span class="game-script-inputs-dialog__field-optional game-script-inputs-dialog__field-optional--inline">
                    {" "}
                    (optional)
                  </span>
                </Show>
              </span>
            </span>
          </Checkbox>
          <Show when={field.description}>
            {(description) => (
              <span class="game-script-inputs-dialog__description">
                {description()}
              </span>
            )}
          </Show>
          <Show when={scriptInputFieldErrorMessage(field.key)}>
            {(message) => (
              <span class="game-script-inputs-dialog__field-error-msg">
                {message()}
              </span>
            )}
          </Show>
        </div>
      );
    }

    return (
      <div
        class="game-script-inputs-dialog__field"
        data-invalid={hasError() ? "" : undefined}
        data-script-input-key={field.key}
        ref={(element) => setScriptInputFieldRef(field.key, element)}
      >
        <Label class="game-script-inputs-dialog__label">
          <span class="game-script-inputs-dialog__label-text">
            {label()}
            <Show when={field.required === true}>
              <span
                aria-hidden="true"
                class="game-script-inputs-dialog__field-required game-script-inputs-dialog__field-required--inline"
              >
                {" "}
                *
              </span>
            </Show>
            <Show when={field.required !== true}>
              <span class="game-script-inputs-dialog__field-optional game-script-inputs-dialog__field-optional--inline">
                {" "}
                (optional)
              </span>
            </Show>
          </span>
        </Label>
        <Show when={field.description}>
          {(description) => (
            <span class="game-script-inputs-dialog__description">
              {description()}
            </span>
          )}
        </Show>
        <Show
          when={field.type === "select"}
          fallback={
            <Input
              aria-label={label()}
              disabled={scriptInputDialogSaving()}
              fullWidth
              invalid={hasError()}
              inputMode={field.type === "number" ? "decimal" : undefined}
              ref={(element) => setScriptInputEditorRef(field.key, element)}
              type={field.type === "number" ? "number" : "text"}
              value={String(value() ?? "")}
              onInput={(event) =>
                updateScriptInputDraft(field.key, event.currentTarget.value)
              }
            />
          }
        >
          <Combobox
            class={
              hasError()
                ? "game-script-inputs-dialog__combobox--invalid"
                : undefined
            }
            disabled={scriptInputDialogSaving()}
            inputBehavior="autohighlight"
            openOnClick
            value={value() ? [String(value())] : []}
            onValueChange={(details) =>
              updateScriptInputDraft(field.key, details.value[0] ?? "")
            }
          >
            <ComboboxInput
              aria-label={label()}
              aria-invalid={hasError() ? "true" : undefined}
              disabled={scriptInputDialogSaving()}
              placeholder={field.required === true ? "Select a value" : ""}
              ref={(element) => setScriptInputEditorRef(field.key, element)}
              showClear={field.required !== true}
            />
            <ComboboxContent>
              <ComboboxEmpty>No matching options</ComboboxEmpty>
              <ComboboxList>
                <For each={selectFieldOptions(field)}>
                  {(option) => (
                    <ComboboxItem value={option}>{option}</ComboboxItem>
                  )}
                </For>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Show>
        <Show when={scriptInputFieldErrorMessage(field.key)}>
          {(message) => (
            <span class="game-script-inputs-dialog__field-error-msg">
              {message()}
            </span>
          )}
        </Show>
      </div>
    );
  };

  return (
    <main
      class="game-app"
      classList={{ "game-app--topnav-hidden": !topNavVisible() }}
      data-platform={platformLabel()}
    >
      <Dialog
        open={scriptInputDialogOpen()}
        onOpenChange={(details) => {
          if (details.open) {
            setScriptInputDialogOpen(true);
            return;
          }

          cancelScriptInputsDialog();
        }}
      >
        <DialogContent
          class="game-script-inputs-dialog"
          closeProps={{ disabled: scriptInputDialogSaving() }}
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle>
              {scriptInputDialogMode() === "required"
                ? "Script inputs required"
                : "Script inputs"}
            </DialogTitle>
            <DialogDescription>
              {loadedScript()?.name ?? "script"}
            </DialogDescription>
          </DialogHeader>
          <Show when={scriptInputDialogError()}>
            {(error) => (
              <Alert class="game-script-inputs-dialog__error" variant="error">
                <AlertDescription>
                  <Icon
                    aria-hidden="true"
                    class="game-script-inputs-dialog__error-icon"
                    icon="circle_alert"
                  />
                  <span class="game-script-inputs-dialog__error-message">
                    <span>{error().message} </span>
                    <Show when={error().fields.length > 0}>
                      <span class="game-script-inputs-dialog__error-fields">
                        <For each={error().fields}>
                          {(field, index) => (
                            <>
                              <a
                                class="game-script-inputs-dialog__error-field-link"
                                href={`#script-input-${field.key}`}
                                onClick={(event) => {
                                  event.preventDefault();
                                  focusScriptInputField(field.key);
                                }}
                              >
                                <Show
                                  when={field.message !== ""}
                                  fallback={
                                    <span class="game-script-inputs-dialog__error-field-link-label">
                                      {field.label}
                                      <Show
                                        when={
                                          index() < error().fields.length - 1
                                        }
                                      >
                                        ,
                                      </Show>
                                    </span>
                                  }
                                >
                                  <span>
                                    <span class="game-script-inputs-dialog__error-field-link-label">
                                      {field.label}
                                    </span>
                                    : {field.message}
                                    <Show
                                      when={index() < error().fields.length - 1}
                                    >
                                      ,
                                    </Show>
                                  </span>
                                </Show>
                              </a>{" "}
                            </>
                          )}
                        </For>
                      </span>
                    </Show>
                  </span>
                </AlertDescription>
              </Alert>
            )}
          </Show>
          <div class="game-script-inputs-dialog__fields">
            <div class="game-script-inputs-dialog__field-list">
              <For each={getScriptInputsDefinition()?.fields ?? []}>
                {renderScriptInputField}
              </For>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={scriptInputDialogSaving()}
              size="sm"
              type="button"
              variant="outline"
              onClick={cancelScriptInputsDialog}
            >
              Cancel
            </Button>
            <Button
              disabled={scriptInputDialogSaving()}
              size="sm"
              type="button"
              onClick={() => void persistScriptInputs()}
            >
              {scriptInputDialogMode() === "required"
                ? "Save and Start"
                : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={scriptReplacementDialogOpen()}
        onOpenChange={(details) => setScriptReplacementDialogOpen(details.open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop the current script?</AlertDialogTitle>
            <AlertDialogDescription>
              Another script can’t be loaded while this one is running.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void selectScript(true)}>
              Stop and Load
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={fatalScriptAlertOpen()}
        onOpenChange={(details) => {
          setFatalScriptAlertOpen(details.open);
          if (!details.open) {
            setFatalScriptAlertCopied(false);
          }
        }}
      >
        <AlertDialogContent class="game-script-error-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Script failed</AlertDialogTitle>
            <AlertDialogDescription>
              <span class="game-script-error-dialog__source">
                <span>{fatalScriptAlert()?.sourceName ?? "script"}</span>
                <Show when={fatalScriptAlert()?.sourcePath}>
                  {(path) => (
                    <TooltipIconButton
                      aria-label="Open script file"
                      class="game-script-error-dialog__open-source"
                      onClick={() => {
                        const bridge = window.desktop.scripting;
                        if (bridge !== undefined) {
                          void bridge.openPath(path()).catch((error) => {
                            console.error("Failed to open script file", error);
                          });
                        }
                      }}
                      portal={false}
                      positioning={{ placement: "right" }}
                      size="icon-xs"
                      tooltip="Open script file"
                      variant="ghost"
                    >
                      <Icon icon="external_link" class="button__icon" />
                    </TooltipIconButton>
                  )}
                </Show>
              </span>
              <span class="game-script-error-dialog__message">
                {fatalScriptAlert()?.message ?? "Script failed"}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Show when={fatalScriptAlert()?.detailsText}>
            {(detailsText) => (
              <Accordion
                collapsible
                class="game-script-error-dialog__accordion"
              >
                <AccordionItem value="stack-trace">
                  <AccordionTrigger>Stack trace</AccordionTrigger>
                  <AccordionContent>
                    <pre class="game-script-error-dialog__stack">
                      {detailsText()}
                    </pre>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </Show>
          <AlertDialogFooter>
            <Show when={fatalScriptAlert()?.detailsText}>
              <Button
                class="game-script-error-dialog__copy"
                onClick={() => void copyFatalScriptAlertDetails()}
                size="sm"
                variant="outline"
              >
                <Icon
                  icon={fatalScriptAlertCopied() ? "check" : "copy"}
                  class="button__icon"
                />
                {fatalScriptAlertCopied() ? "Copied" : "Copy stack trace"}
              </Button>
            </Show>
            <AlertDialogAction size="sm">OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <TopNav
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        hotkeyBindings={() => settings().hotkeys.bindings}
        hotkeyPlatform={props.platform}
        gameLoaded={gameLoaded}
        playerReady={playerReady}
        optionItems={optionItems}
        walkSpeed={walkSpeed}
        setWalkSpeed={setWalkSpeed}
        handleSetWalkSpeed={handleSetWalkSpeed}
        frameRate={frameRate}
        setFrameRate={setFrameRate}
        handleSetFrameRate={handleSetFrameRate}
        customName={customName}
        customNameConfigured={() => flashSettings().customNameConfigured}
        setCustomName={setCustomName}
        handleSetCustomName={handleSetCustomName}
        handleResetCustomName={handleResetCustomName}
        customGuild={customGuild}
        customGuildConfigured={() => flashSettings().customGuildConfigured}
        setCustomGuild={setCustomGuild}
        handleSetCustomGuild={handleSetCustomGuild}
        handleResetCustomGuild={handleResetCustomGuild}
        autoAttackEnabled={autoAttackEnabled}
        autoAttackProfileLabel={autoAttackProfileLabel}
        autoAttackConfiguredProfileLabel={autoAttackConfiguredProfileLabel}
        autoAttackLastError={autoAttackLastError}
        autoAttackTargetPriority={autoAttackTargetPriority}
        setAutoAttackTargetPriority={setAutoAttackTargetPriority}
        combatProfiles={() => combatProfileLibrary().profiles}
        selectedAutoAttackProfileId={selectedAutoAttackProfileId}
        handleToggleAutoAttack={handleToggleAutoAttack}
        handleSelectAutoAttackProfile={handleSelectAutoAttackProfile}
        scriptLoaded={scriptLoaded}
        scriptRunning={scriptRunning}
        scriptStatus={scriptStatus}
        scriptTogglePending={scriptTogglePending}
        scriptReloadBeforeStart={scriptReloadBeforeStart}
        scriptRestartAfterReconnect={scriptRestartAfterReconnect}
        scriptRoomPolicy={scriptRoomPolicy}
        scriptSafeStartStop={scriptSafeStartStop}
        scriptOptionsReady={scriptReady}
        scriptRoomNumberDraft={scriptRoomNumberDraft}
        setScriptRoomNumberDraft={(value) => {
          setScriptRoomNumberDraft(value);
          setScriptRoomNumberError("");
        }}
        scriptRoomNumberError={scriptRoomNumberError}
        scriptInputsAvailable={scriptInputsAvailable}
        loadScript={loadScript}
        toggleScript={toggleScript}
        openScriptInputs={openScriptInputs}
        handleSelectScriptRoomPolicy={handleSelectScriptRoomPolicy}
        handleCommitScriptRoomNumber={handleCommitScriptRoomNumber}
        handleToggleScriptRestartAfterReconnect={
          handleToggleScriptRestartAfterReconnect
        }
        handleToggleScriptReloadBeforeStart={
          handleToggleScriptReloadBeforeStart
        }
        handleToggleScriptSafeStartStop={handleToggleScriptSafeStartStop}
        autoZoneEnabled={autoZoneEnabled}
        autoZoneMap={autoZoneMap}
        handleToggleAutoZone={handleToggleAutoZone}
        handleSelectAutoZoneMap={handleSelectAutoZoneMap}
        autoReloginEnabled={autoReloginEnabled}
        autoReloginCaptured={autoReloginCaptured}
        autoReloginAttempting={autoReloginAttempting}
        autoReloginWaitingDelay={autoReloginWaitingDelay}
        autoReloginToggling={autoReloginToggling}
        autoReloginDelaySeconds={autoReloginDelaySeconds}
        setAutoReloginDelaySeconds={setAutoReloginDelaySeconds}
        autoReloginServer={autoReloginServer}
        autoReloginServers={autoReloginServers}
        autoReloginLastError={autoReloginLastError}
        autoReloginAttemptsRemaining={autoReloginAttemptsRemaining}
        handleToggleAutoRelogin={handleToggleAutoRelogin}
        handleRefreshAutoReloginServers={refreshAutoReloginServers}
        handleSelectAutoReloginServer={handleSelectAutoReloginServer}
        handleSetAutoReloginDelay={handleSetAutoReloginDelay}
        cells={cells}
        pads={pads}
        validPads={validPads}
        selectedCell={selectedCell}
        selectedPad={selectedPad}
        travelBusy={travelBusy}
        handleRefreshTravelOptions={refreshTravelOptions}
        handleSelectCell={handleSelectCell}
        handleSelectPad={handleSelectPad}
        handleOpenBank={handleOpenBank}
        handleOpenWindow={handleOpenWindow}
      />

      <section
        id="loader-container"
        class="game-loader"
        classList={{ "game-loader--hidden": gameLoaded() }}
        aria-hidden={gameLoaded() ? "true" : undefined}
        aria-live="polite"
      >
        <div class="game-loader__content">
          <Spinner class="game-loader__spinner" size="xl" />
          <span class="game-loader__progress">{progress()}%</span>
        </div>
      </section>

      <section
        id="game-container"
        class="game-viewport"
        classList={{ "game-viewport--loaded": gameLoaded() }}
      >
        <div class="game-visual-cover" aria-hidden="true" />
      </section>

      <Show when={window.desktop.debug}>
        <DevDebugEvaluator />
      </Show>
    </main>
  );
}
