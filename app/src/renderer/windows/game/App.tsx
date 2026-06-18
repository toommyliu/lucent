import {
  markGameStartup,
  writeGameStartupTiming,
  writeGameStartupTimingOnce,
} from "./startupTelemetry";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
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
  Textarea,
  TooltipIconButton,
  Toaster,
  createToastController,
} from "@lucent/ui";
import { mountWindow } from "../mount";
import { Data, Effect, Fiber } from "effect";
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
import {
  DEFAULT_APPEARANCE,
  DEFAULT_HOTKEYS,
  DEFAULT_PREFERENCES,
  type AppSettings,
} from "../../../shared/settings";
import {
  DEFAULT_COMBAT_PROFILE_ID,
  DEFAULT_COMBAT_PROFILE_LIBRARY,
  autoAttackStateToProfileRef,
  findCombatProfileByRef,
  type CombatProfileAutoAttackMode,
  type CombatProfileLibrary,
} from "../../../shared/combat-profiles";
import type {
  AccountGameWindowShutdownRequest,
  AccountGameLaunchPayload,
  FastTravelsRequestMessage,
  FollowerStartPayload,
  ScriptExecutePayload,
} from "../../../shared/ipc";
import {
  normalizeScriptInputValueForField,
  resolveScriptInputValues,
  type ScriptInputField,
  type ScriptInputValue,
  type ScriptInputValues,
  type ScriptInputsDefinition,
} from "../../../shared/script-inputs";
import { fastTravelMapTarget } from "../../../shared/fast-travels";
import type { WindowId } from "../../../shared/windows";
import { runtime } from "./Runtime";
import { installPacketsBridge } from "./packetsBridge";
import { installLoaderGrabberBridge } from "./loaderGrabberBridge";
import { Settings, type SettingsShape } from "./flash/Services/Settings";
import { Auth } from "./flash/Services/Auth";
import { SwfMethodNotFoundError, SwfUnavailableError } from "./flash/Errors";
import { Bank } from "./flash/Services/Bank";
import { Combat } from "./flash/Services/Combat";
import { Drops } from "./flash/Services/Drops";
import { House } from "./flash/Services/House";
import { Inventory } from "./flash/Services/Inventory";
import { Outfits } from "./flash/Services/Outfits";
import { Packet } from "./flash/Services/Packet";
import { Player } from "./flash/Services/Player";
import { Quests } from "./flash/Services/Quests";
import { Shops } from "./flash/Services/Shops";
import { TempInventory } from "./flash/Services/TempInventory";
import { World } from "./flash/Services/World";
import { Army } from "./army/Services/Army";
import { Environment } from "./environment/Services/Environment";
import {
  AutoAttack,
  type AutoAttackState,
} from "./features/Services/AutoAttack";
import {
  AutoRelogin,
  type AutoReloginState,
} from "./features/Services/AutoRelogin";
import {
  AutoZone,
  type AutoZoneState,
  type AutoZoneSupportedMap,
} from "./features/Services/AutoZone";
import { Follower } from "./features/Services/Follower";
import {
  TopNav,
  TopNavHiddenOptionsMenu,
  type TopNavOptionsMenuContentProps,
} from "./TopNav";
import { createGameCommands, type GameCommand } from "./commands";
import { GameHotkeys } from "./hotkeys";
import {
  getGameLoadState,
  onGameLoaded,
  subscribeGameLoadState,
} from "./loadState";
import {
  findTopNavOption,
  type GameTopNavMenu,
  type TopNavOptionItem,
} from "./topNavOptions";
import { ScriptRunner } from "./scripting/Services/ScriptRunner";
import { createAccountManagerStatusPublisher } from "./accountManagerStatusBridge";
import { DEBUG_EVAL_SOURCE_NAME, createDebugScriptSource } from "./debugEval";
import {
  diagnosticDetailsText,
  fatalScriptAlertFromError,
  stoppedScriptFatalAlertCandidate,
  type FatalScriptAlert,
} from "./scripting/fatalAlert";
import { toDiagnosticDetails, toErrorMessage } from "./scripting/errorDetails";
import type { ScriptDiagnostic } from "./scripting/Types";
import type { ScriptRunnerStatus } from "./scripting/scriptRunnerStatus";

markGameStartup("app-module-evaluated");

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly NODE_ENV?: string;
    }
  }
}

const AUTO_RELOGIN_DEFAULT_DELAY_MS = 3000;
const AUTO_RELOGIN_MAX_DELAY_MS = 300_000;
const DEFAULT_CELL = "Enter";
const DEFAULT_PAD = "Spawn";
const MS_PER_SECOND = 1000;
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

type AccountLaunchErrorCode = "inputs_required";

class AccountLaunchError extends Data.TaggedError("AccountLaunchError")<{
  readonly message: string;
  readonly code?: AccountLaunchErrorCode;
  readonly cause?: unknown;
}> {}

const accountLaunchError = (
  message: string,
  options?: {
    readonly code?: AccountLaunchErrorCode;
    readonly cause?: unknown;
  },
): AccountLaunchError =>
  new AccountLaunchError(
    options === undefined
      ? { message }
      : {
          message,
          ...(options.code === undefined ? {} : { code: options.code }),
          ...(options.cause === undefined ? {} : { cause: options.cause }),
        },
  );

const formatAccountLaunchError = (error: unknown): string => {
  if (error instanceof AccountLaunchError) {
    return error.message;
  }

  if (error instanceof Error && error.message !== "") {
    return error.message;
  }

  return "Account launch failed";
};

const isAccountLaunchInputsRequired = (error: unknown): boolean =>
  error instanceof AccountLaunchError && error.code === "inputs_required";

const uniqueNonEmpty = (values: readonly string[]): string[] => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];

const formatDelaySeconds = (delayMs: number): string =>
  String(delayMs / MS_PER_SECOND);

const parseDelaySecondsToMs = (value: string): number => {
  const seconds = Number.parseFloat(value);
  return Number.isFinite(seconds)
    ? Math.min(
        AUTO_RELOGIN_MAX_DELAY_MS,
        Math.max(0, Math.round(seconds * MS_PER_SECOND)),
      )
    : Number.NaN;
};

const formatScriptStatus = (loaded: boolean, running: boolean) => {
  if (running) {
    return "Running";
  }

  return loaded ? "Loaded" : "No script loaded";
};

const defaultSettings: AppSettings = {
  preferences: DEFAULT_PREFERENCES,
  appearance: DEFAULT_APPEARANCE,
  hotkeys: DEFAULT_HOTKEYS,
};

type DebugEvalMode = "script" | "internal";
type ScriptInputsDialogMode = "manual" | "required";
type ScriptInputDraftValue = string | boolean;
type ScriptInputDraftValues = Readonly<Record<string, ScriptInputDraftValue>>;
interface ScriptInputsDialogErrorField {
  readonly key: string;
  readonly label: string;
  readonly message: string;
}

interface ScriptInputsDialogError {
  readonly message: string;
  readonly fields: readonly ScriptInputsDialogErrorField[];
}

interface DevDebugEvaluatorProps {
  readonly applyLoadedScript: (
    source: string,
    name: string,
    path?: string,
    inputs?: ScriptInputsDefinition,
  ) => void;
  readonly refreshScriptMeta: () => Promise<void>;
}

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

const DevDebugEvaluator =
  process.env.NODE_ENV === "development"
    ? (props: DevDebugEvaluatorProps): JSX.Element => {
        const DEBUG_EVAL_OUTPUT_LIMIT = 2000;
        const DEFAULT_SCRIPT_DEBUG_SOURCE = `const cell = yield* api.player.getCell();
script.log(\`Cell: \${cell}\`);`;
        const DEFAULT_INTERNAL_DEBUG_SOURCE = `return yield* services.player.getCell();`;
        const DEBUG_PANEL_MARGIN_PX = 12;
        const DEBUG_PANEL_MIN_WIDTH_PX = 320;
        const DEBUG_PANEL_MIN_HEIGHT_PX = 220;
        const DEBUG_PANEL_DEFAULT_WIDTH_PX = 432;
        const DEBUG_PANEL_DEFAULT_HEIGHT_PX = 360;
        const EffectFunction = Function as unknown as new (
          ...args: string[]
        ) => (
          services: Record<string, unknown>,
          effect: typeof Effect,
        ) => Effect.Effect<unknown, unknown>;
        type DebugPanelFrame = {
          readonly height: number;
          readonly width: number;
          readonly x: number;
          readonly y: number;
        };

        const [open, setOpen] = createSignal(false);
        const [mode, setMode] = createSignal<DebugEvalMode>("script");
        const [scriptSource, setScriptSource] = createSignal(
          DEFAULT_SCRIPT_DEBUG_SOURCE,
        );
        const [internalSource, setInternalSource] = createSignal(
          DEFAULT_INTERNAL_DEBUG_SOURCE,
        );
        const [status, setStatus] = createSignal("Idle");
        const [output, setOutput] = createSignal("");
        const [copyableOutput, setCopyableOutput] = createSignal("");
        const [outputCopied, setOutputCopied] = createSignal(false);
        const [running, setRunning] = createSignal(false);
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
        const [panelFrame, setPanelFrame] = createSignal<DebugPanelFrame>(
          createInitialPanelFrame(),
        );
        let panelElement: HTMLDivElement | undefined;
        let panelResizeObserver: ResizeObserver | undefined;
        let cleanupPanelPointer: (() => void) | undefined;
        let outputCopiedTimer: number | undefined;

        const currentSource = () =>
          mode() === "script" ? scriptSource() : internalSource();

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

        const truncateOutput = (value: string): string =>
          value.length <= DEBUG_EVAL_OUTPUT_LIMIT
            ? value
            : `${value.slice(0, DEBUG_EVAL_OUTPUT_LIMIT)}...`;

        const runInternalEval = (source: string): Promise<unknown> =>
          runtime.runPromise(
            Effect.gen(function* () {
              const army = yield* Army;
              const auth = yield* Auth;
              const autoAttack = yield* AutoAttack;
              const autoRelogin = yield* AutoRelogin;
              const autoZone = yield* AutoZone;
              const bank = yield* Bank;
              const combat = yield* Combat;
              const drops = yield* Drops;
              const environment = yield* Environment;
              const house = yield* House;
              const inventory = yield* Inventory;
              const outfits = yield* Outfits;
              const packet = yield* Packet;
              const player = yield* Player;
              const quests = yield* Quests;
              const settings = yield* Settings;
              const shops = yield* Shops;
              const tempInventory = yield* TempInventory;
              const world = yield* World;
              const services = {
                army,
                auth,
                autoAttack,
                autoRelogin,
                autoZone,
                bank,
                combat,
                drops,
                environment,
                house,
                inventory,
                outfits,
                packet,
                player,
                quests,
                settings,
                shops,
                tempInventory,
                world,
              };
              const compileInternalEval = new EffectFunction(
                "services",
                "Effect",
                `"use strict";
return Effect.gen(function* debugInternalEval() {
${source}
});`,
              );

              return yield* compileInternalEval(services, Effect);
            }),
          );

        const loadAsScript = () => {
          if (running()) {
            return;
          }

          if (mode() !== "script") {
            setStatus("Script API mode required to load");
            return;
          }

          const source = currentSource().trim();
          if (source === "") {
            setStatus("No code to load");
            return;
          }

          props.applyLoadedScript(
            createDebugScriptSource(source),
            DEBUG_EVAL_SOURCE_NAME,
          );
          setStatus("Loaded into script runner");
          setOutput("");
          setCopyableOutput("");
          setOutputCopied(false);
          void props.refreshScriptMeta();
        };

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
          if (value === "") {
            return;
          }

          try {
            await navigator.clipboard.writeText(value);
            setStatus("Output copied");
            markOutputCopied();
          } catch {
            setStatus("Copy failed");
          }
        };

        const runEval = () => {
          if (running()) {
            return;
          }

          const source = currentSource().trim();
          if (source === "") {
            setStatus("No code to evaluate");
            setOutput("");
            setCopyableOutput("");
            return;
          }

          const evalMode = mode();
          setRunning(true);
          setStatus(`Running ${evalMode} eval`);
          setOutput("");
          setCopyableOutput("");
          setOutputCopied(false);

          const task =
            evalMode === "script"
              ? runtime.runPromise(
                  Effect.gen(function* () {
                    const runner = yield* ScriptRunner;
                    yield* runner.run(createDebugScriptSource(source), {
                      name: DEBUG_EVAL_SOURCE_NAME,
                    });
                    return "Script eval started";
                  }),
                )
              : runInternalEval(source);

          void task
            .then((value) => {
              const formattedValue = formatEvalValue(value);
              setStatus("Eval complete");
              setOutput(truncateOutput(formattedValue));
              setCopyableOutput(formattedValue);
              void props.refreshScriptMeta();
            })
            .catch((error: unknown) => {
              const formattedError = formatEvalError(error);
              setStatus("Eval failed");
              setOutput(truncateOutput(formattedError));
              setCopyableOutput(formattedError);
              void props.refreshScriptMeta();
            })
            .finally(() => {
              setRunning(false);
            });
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
          window.addEventListener("pointercancel", handlePointerUp, {
            once: true,
          });
        };

        const handlePanelKeyDown: JSX.EventHandler<
          HTMLElement,
          KeyboardEvent
        > = (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();

            if (event.shiftKey) {
              loadAsScript();
            } else {
              runEval();
            }
            return;
          }

          if (event.key !== "Escape" && event.key !== "Tab") {
            event.stopPropagation();
          }
        };

        return (
          <aside
            aria-label="Debug evaluator"
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
                <Button
                  class="game-debug-eval__open"
                  onClick={() => setOpen(true)}
                >
                  Debug Eval
                </Button>
              }
            >
              <div
                ref={panelElement}
                class="game-debug-eval__panel"
                onKeyDown={handlePanelKeyDown}
                style={{
                  "background-color": "rgb(var(--popover))",
                  border: "1px solid var(--color-border)",
                  "border-radius": "var(--radius-md)",
                  "box-sizing": "border-box",
                  "box-shadow":
                    "0 16px 44px rgba(var(--black), 0.22), 0 2px 8px rgba(var(--black), 0.12)",
                  color: "rgb(var(--popover-foreground))",
                  display: "grid",
                  gap: "0.5rem",
                  "grid-template-rows": "auto minmax(0, 1fr) auto auto",
                  height: `${panelFrame().height}px`,
                  "min-height": `${DEBUG_PANEL_MIN_HEIGHT_PX}px`,
                  "min-width": `${DEBUG_PANEL_MIN_WIDTH_PX}px`,
                  "max-height": `calc(100vh - ${panelFrame().y + DEBUG_PANEL_MARGIN_PX}px)`,
                  "max-width": `calc(100vw - ${panelFrame().x + DEBUG_PANEL_MARGIN_PX}px)`,
                  overflow: "hidden",
                  padding: "0.625rem",
                  position: "relative",
                  resize: "both",
                  width: `${panelFrame().width}px`,
                }}
              >
                <div
                  onPointerDown={startPanelDrag}
                  style={{
                    "align-items": "center",
                    cursor: "move",
                    display: "flex",
                    gap: "0.5rem",
                    "justify-content": "space-between",
                    "touch-action": "none",
                    "user-select": "none",
                  }}
                >
                  <strong style={{ "font-size": "var(--text-sm)" }}>
                    Debug Eval
                  </strong>
                  <div
                    onPointerDown={(event) => event.stopPropagation()}
                    class="game-debug-eval__header-actions"
                  >
                    <select
                      aria-label="Debug eval mode"
                      class="game-debug-eval__mode"
                      value={mode()}
                      onChange={(event) => {
                        const nextMode = event.currentTarget.value;
                        if (nextMode === "script" || nextMode === "internal") {
                          setMode(nextMode);
                        }
                      }}
                    >
                      <option value="script">Script API</option>
                      <option value="internal">Internal API</option>
                    </select>
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
                  aria-label="Debug eval code"
                  class="game-debug-eval__source"
                  fullWidth
                  size="sm"
                  spellcheck={false}
                  value={currentSource()}
                  onInput={(event) => {
                    if (mode() === "script") {
                      setScriptSource(event.currentTarget.value);
                    } else {
                      setInternalSource(event.currentTarget.value);
                    }
                  }}
                />
                <div class="game-debug-eval__footer-actions">
                  <Button
                    disabled={running()}
                    onClick={runEval}
                    size="sm"
                    title="Run (Cmd/Ctrl+Enter)"
                  >
                    {running() ? "Running" : "Eval"}
                  </Button>
                  <Button
                    disabled={mode() !== "script" || running()}
                    onClick={loadAsScript}
                    size="sm"
                    title="Load (Cmd/Ctrl+Shift+Enter)"
                    variant="outline"
                  >
                    Load
                  </Button>
                </div>
                <div class="game-debug-eval__output">
                  <div class="game-debug-eval__status-row">
                    <span>{status()}</span>
                    <Show when={output() !== ""}>
                      <Button
                        aria-label={
                          outputCopied()
                            ? "Debug eval output copied"
                            : "Copy debug eval output"
                        }
                        class="game-debug-eval__copy-output"
                        onClick={() => void copyOutput()}
                        size="sm"
                        title={outputCopied() ? "Copied" : "Copy output"}
                        variant="outline"
                      >
                        <Icon
                          icon={outputCopied() ? "check" : "copy"}
                          class="button__icon"
                        />
                        {outputCopied() ? "Copied" : "Copy"}
                      </Button>
                    </Show>
                  </div>
                  <Show when={output() !== ""}>
                    <pre
                      style={{
                        "background-color": "rgba(var(--muted), 0.62)",
                        border: "1px solid rgba(var(--border), 0.75)",
                        "border-radius": "var(--radius-sm)",
                        color: "var(--color-foreground)",
                        "font-family": "var(--font-mono)",
                        margin: "0",
                        "max-height": "9rem",
                        overflow: "auto",
                        padding: "0.5rem",
                        "white-space": "pre-wrap",
                        "word-break": "break-word",
                      }}
                    >
                      {output()}
                    </pre>
                  </Show>
                </div>
              </div>
            </Show>
          </aside>
        );
      }
    : undefined;

export default function App(props: {
  readonly initialSettings?: AppSettings | null;
}): JSX.Element {
  markGameStartup("app-component-created");
  const initialSettings = props.initialSettings ?? defaultSettings;
  const [settings, setSettings] = createSignal<AppSettings>(initialSettings);
  const [gameLoaded, setGameLoaded] = createSignal(getGameLoadState().loaded);
  const [playerReady, setPlayerReady] = createSignal(false);
  const [autoAttackEnabled, setAutoAttackEnabled] = createSignal(false);
  const [followerEnabled, setFollowerEnabled] = createSignal(false);
  const [autoAttackProfileLabel, setAutoAttackProfileLabel] =
    createSignal("Generic");
  const [autoAttackLastError, setAutoAttackLastError] = createSignal("");
  const [combatProfileLibrary, setCombatProfileLibrary] =
    createSignal<CombatProfileLibrary>(DEFAULT_COMBAT_PROFILE_LIBRARY);
  const [scriptName, setScriptName] = createSignal("");
  const [scriptPath, setScriptPath] = createSignal<string | undefined>();
  const [scriptSource, setScriptSource] = createSignal("");
  const [scriptLoaded, setScriptLoaded] = createSignal(false);
  const [scriptRunning, setScriptRunning] = createSignal(false);
  const [scriptStatus, setScriptStatus] = createSignal("No script loaded");
  const [scriptDiagnosticsCount, setScriptDiagnosticsCount] = createSignal(0);
  const [scriptUsePrivateRooms, setScriptUsePrivateRooms] = createSignal(false);
  const [scriptSafeStartStop, setScriptSafeStartStop] = createSignal(false);
  const [scriptInputsDefinition, setScriptInputsDefinition] = createSignal<
    ScriptInputsDefinition | undefined
  >();
  const [scriptInputsDialogOpen, setScriptInputsDialogOpen] =
    createSignal(false);
  const [scriptInputsDialogMode, setScriptInputsDialogMode] =
    createSignal<ScriptInputsDialogMode>("manual");
  const [scriptInputsDialogDefinition, setScriptInputsDialogDefinition] =
    createSignal<ScriptInputsDefinition | undefined>();
  const [scriptInputsDialogDraft, setScriptInputsDialogDraft] =
    createSignal<ScriptInputDraftValues>({});
  const [scriptInputsDialogError, setScriptInputsDialogError] = createSignal<
    ScriptInputsDialogError | undefined
  >();
  const [scriptInputsDialogSaving, setScriptInputsDialogSaving] =
    createSignal(false);
  const [fatalScriptAlert, setFatalScriptAlert] =
    createSignal<FatalScriptAlert | null>(null);
  const [fatalScriptAlertOpen, setFatalScriptAlertOpen] = createSignal(false);
  const [fatalScriptAlertCopied, setFatalScriptAlertCopied] =
    createSignal(false);

  const [customName, setCustomName] = createSignal("");
  const [customGuild, setCustomGuild] = createSignal("");
  const [walkSpeed, setWalkSpeed] = createSignal("8");
  const [frameRate, setFrameRate] = createSignal("24");
  const [deathAdsVisible, setDeathAdsVisible] = createSignal(false);
  const [collisionsEnabled, setCollisionsEnabled] = createSignal(true);
  const [effectsEnabled, setEffectsEnabled] = createSignal(true);
  const [otherPlayersVisible, setOtherPlayersVisible] = createSignal(true);
  const [lagKillerEnabled, setLagKillerEnabled] = createSignal(false);
  const [enemyMagnetEnabled, setEnemyMagnetEnabled] = createSignal(false);
  const [infiniteRangeEnabled, setInfiniteRangeEnabled] = createSignal(false);
  const [provokeCellEnabled, setProvokeCellEnabled] = createSignal(false);
  const [skipCutscenesEnabled, setSkipCutscenesEnabled] = createSignal(false);
  const [antiCounterEnabled, setAntiCounterEnabled] = createSignal(false);
  const [autoZoneEnabled, setAutoZoneEnabled] = createSignal(false);
  const [autoZoneMap, setAutoZoneMap] = createSignal<
    AutoZoneSupportedMap | undefined
  >(undefined);

  const [autoReloginEnabled, setAutoReloginEnabled] = createSignal(false);
  const [autoReloginCaptured, setAutoReloginCaptured] = createSignal(false);
  const [autoReloginAttempting, setAutoReloginAttempting] = createSignal(false);
  const [autoReloginWaitingDelay, setAutoReloginWaitingDelay] =
    createSignal(false);
  const [autoReloginToggling, setAutoReloginToggling] = createSignal(false);
  const [autoReloginDelaySeconds, setAutoReloginDelaySeconds] = createSignal(
    formatDelaySeconds(AUTO_RELOGIN_DEFAULT_DELAY_MS),
  );
  const [autoReloginServer, setAutoReloginServer] = createSignal("");
  const [autoReloginServers, setAutoReloginServers] = createSignal<string[]>(
    [],
  );
  const [autoReloginLastError, setAutoReloginLastError] = createSignal("");
  const [autoReloginAttemptsRemaining, setAutoReloginAttemptsRemaining] =
    createSignal<number | null>(null);
  const [openTopNavMenu, setOpenTopNavMenu] =
    createSignal<GameTopNavMenu | null>(null);
  const [topBarVisible, setTopBarVisible] = createSignal(true);
  const [cells, setCells] = createSignal<readonly string[]>([DEFAULT_CELL]);
  const [pads] = createSignal<readonly string[]>(DEFAULT_PADS);
  const [validPads, setValidPads] = createSignal<readonly string[]>([]);
  const [selectedCell, setSelectedCell] = createSignal(DEFAULT_CELL);
  const [selectedPad, setSelectedPad] = createSignal(DEFAULT_PAD);
  const [travelBusy, setTravelBusy] = createSignal(false);
  const hotkeyToasts = createToastController({
    defaultDuration: 1200,
    limit: 1,
  });

  let settingsStateDisposer: (() => void) | undefined;
  let autoAttackStateDisposer: (() => void) | undefined;
  let autoZoneStateDisposer: (() => void) | undefined;
  let autoReloginStateDisposer: (() => void) | undefined;
  let packetsBridgeController:
    | ReturnType<typeof installPacketsBridge>
    | undefined;
  let autoAttackToggleInFlight = false;
  let fastTravelRequestChain = Promise.resolve();
  let cleanedUp = false;
  let activeAccountLaunchPayload: AccountGameLaunchPayload | null = null;
  let accountLaunchStatusPending = false;
  let lastShownFatalScriptAlertKey = "";
  let fatalScriptAlertCopiedTimer: number | undefined;
  let accountManagerStatusDisposer: (() => void) | undefined;
  let scriptInputsDialogResolver:
    | ((values: ScriptInputValues | null) => void)
    | undefined;
  const scriptInputFieldRefs = new Map<string, HTMLElement>();
  const scriptInputEditorRefs = new Map<string, HTMLElement>();
  const accountLaunchFibers = new Set<Fiber.Fiber<void, unknown>>();
  const assignDisposer =
    (slot: "settings" | "autoAttack" | "autoZone" | "autoRelogin") =>
    (dispose: () => void) => {
      if (cleanedUp) {
        dispose();
        return;
      }

      if (slot === "settings") {
        settingsStateDisposer = dispose;
      } else if (slot === "autoAttack") {
        autoAttackStateDisposer = dispose;
      } else if (slot === "autoZone") {
        autoZoneStateDisposer = dispose;
      } else {
        autoReloginStateDisposer = dispose;
      }
    };

  const openWindow = (id: WindowId) => {
    void window.desktop.windows.open(id).catch((error: unknown) => {
      console.error(`Failed to open window ${id}:`, error);
    });
  };

  const accountManagerStatusPublisher = createAccountManagerStatusPublisher({
    getLaunchPayload: () => activeAccountLaunchPayload,
    getCurrentUsername: () =>
      runtime.runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth;
          return yield* auth
            .getUsername()
            .pipe(Effect.catch(() => Effect.succeed("")));
        }),
      ),
    publish: (update) => window.desktop.accounts.updateScriptStatus(update),
  });

  const publishAccountManagerStatus = (
    status: ScriptRunnerStatus,
  ): Promise<void> =>
    accountManagerStatusPublisher.publishStatus(status).then(() => undefined);

  const publishAccountManagerStatusEffect = (status: ScriptRunnerStatus) =>
    Effect.promise(async () => {
      try {
        await publishAccountManagerStatus(status);
      } catch (error: unknown) {
        console.error("Failed to update account launch status:", error);
      }
    });

  const publishAccountManagerWindowStatusEffect = (
    status: ScriptRunnerStatus["status"],
    message: string,
    scriptName?: string,
  ) =>
    publishAccountManagerStatusEffect({
      status,
      message,
      ...(scriptName === undefined ? {} : { scriptName }),
      updatedAt: Date.now(),
    });

  const publishCurrentAccountManagerStatus = (): void => {
    if (activeAccountLaunchPayload === null || accountLaunchStatusPending) {
      return;
    }

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          return yield* runner.getStatus();
        }),
      )
      .then((status) => publishAccountManagerStatus(status))
      .catch((error: unknown) => {
        console.error(
          "Failed to publish current account script status:",
          error,
        );
      });
  };

  const showFatalScriptAlert = (alert: FatalScriptAlert): void => {
    lastShownFatalScriptAlertKey = alert.key;
    setFatalScriptAlert(alert);
    setFatalScriptAlertCopied(false);
    setFatalScriptAlertOpen(true);
  };

  const showFatalScriptError = (
    sourceName: string,
    error: unknown,
    sourcePath?: string,
  ): void => {
    const detailsText = diagnosticDetailsText(toDiagnosticDetails(error));
    showFatalScriptAlert(
      fatalScriptAlertFromError(
        sourceName,
        toErrorMessage(error),
        detailsText,
        sourcePath,
      ),
    );
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

  const showStoppedScriptFatalAlert = (
    wasRunning: boolean,
    isRunning: boolean,
    diagnostics: ReadonlyArray<ScriptDiagnostic>,
  ): void => {
    const currentScriptPath = scriptPath();
    const alert = stoppedScriptFatalAlertCandidate({
      wasRunning,
      isRunning,
      diagnostics,
      lastShownKey: lastShownFatalScriptAlertKey,
      ...(currentScriptPath === undefined
        ? null
        : { sourcePath: currentScriptPath }),
    });

    if (alert !== undefined) {
      showFatalScriptAlert(alert);
    }
  };

  const waitForLoadedGame = (): Promise<void> => {
    if (getGameLoadState().loaded) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const dispose = onGameLoaded(
        () => {
          dispose();
          resolve();
        },
        { emitCurrent: true },
      );
    });
  };

  const scriptInputsAvailable = createMemo(
    () => scriptInputsDefinition() !== undefined,
  );

  const scriptInputDisplayName = (field: ScriptInputField): string =>
    field.label ?? field.key;

  const scriptInputFieldError = (
    field: ScriptInputField,
    message: string,
  ): ScriptInputsDialogErrorField => ({
    key: field.key,
    label: scriptInputDisplayName(field),
    message,
  });

  const scriptInputFieldByKey = (
    definition: ScriptInputsDefinition,
    key: string,
  ): ScriptInputField =>
    definition.fields.find((field) => field.key === key) ?? {
      key,
      type: "string",
    };

  const scriptInputFieldHasError = (key: string): boolean =>
    scriptInputsDialogError()?.fields.some((field) => field.key === key) ??
    false;

  const scriptInputFieldErrorMsg = (key: string): string | undefined =>
    scriptInputsDialogError()?.fields.find((field) => field.key === key)
      ?.message;

  const resetScriptInputRefs = (): void => {
    scriptInputFieldRefs.clear();
    scriptInputEditorRefs.clear();
  };

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

  const setScriptInputFieldRef = (key: string, element: HTMLElement): void => {
    scriptInputFieldRefs.set(key, element);
  };

  const setScriptInputEditorRef = (key: string, element: HTMLElement): void => {
    scriptInputEditorRefs.set(key, element);
  };

  const updateScriptInputDraft = (
    key: string,
    value: ScriptInputDraftValue,
  ): void => {
    setScriptInputsDialogDraft((draft) => ({ ...draft, [key]: value }));
    setScriptInputsDialogError(undefined);
  };

  const scriptInputDraftFromValues = (
    definition: ScriptInputsDefinition,
    savedValues: ScriptInputValues,
  ): ScriptInputDraftValues => {
    const resolved = resolveScriptInputValues(definition, savedValues).values;
    const draft: Record<string, ScriptInputDraftValue> = {};

    for (const field of definition.fields) {
      const value = resolved[field.key];
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
    | { readonly ok: false; readonly error: ScriptInputsDialogError } => {
    const values: Record<string, ScriptInputValue> = {};
    const invalidFields: ScriptInputsDialogErrorField[] = [];

    for (const field of definition.fields) {
      const draftValue = draft[field.key];
      let value: ScriptInputValue | undefined;

      if (field.type === "boolean") {
        value = draftValue === true;
      } else {
        const text = typeof draftValue === "string" ? draftValue.trim() : "";
        if (text === "") {
          continue;
        }

        value = field.type === "number" ? Number(text) : text;
      }

      const normalized = normalizeScriptInputValueForField(field, value);
      if (normalized === undefined) {
        invalidFields.push(
          scriptInputFieldError(field, `must match ${field.type}`),
        );
        continue;
      }

      values[field.key] = normalized;
    }

    const resolved = resolveScriptInputValues(definition, values);
    const invalidKeys = new Set(invalidFields.map((field) => field.key));
    const missingRequiredFields = resolved.missingRequiredKeys
      .filter((key) => !invalidKeys.has(key))
      .map((key) =>
        scriptInputFieldError(scriptInputFieldByKey(definition, key), ""),
      );
    const fields = [...invalidFields, ...missingRequiredFields];

    if (fields.length > 0) {
      const message =
        invalidFields.length > 0 && missingRequiredFields.length > 0
          ? "Please correct the invalid script inputs."
          : invalidFields.length > 0
            ? "Some script inputs are invalid."
            : "Please fill in all required script inputs.";
      return {
        ok: false,
        error: {
          message,
          fields,
        },
      };
    }

    return { ok: true, values };
  };

  const closeScriptInputsDialog = (values: ScriptInputValues | null): void => {
    const resolve = scriptInputsDialogResolver;
    scriptInputsDialogResolver = undefined;
    setScriptInputsDialogOpen(false);
    setScriptInputsDialogSaving(false);
    setScriptInputsDialogError(undefined);
    resetScriptInputRefs();
    resolve?.(values);
  };

  const cancelScriptInputsDialog = (): void => {
    if (scriptInputsDialogSaving()) {
      return;
    }

    closeScriptInputsDialog(null);
  };

  const openScriptInputsDialog = async (
    mode: ScriptInputsDialogMode,
    definition: ScriptInputsDefinition,
  ): Promise<ScriptInputValues | null> => {
    const savedValues =
      await window.desktop.scripting.getInputValues(definition);

    if (scriptInputsDialogResolver !== undefined) {
      scriptInputsDialogResolver(null);
    }

    setScriptInputsDialogMode(mode);
    setScriptInputsDialogDefinition(definition);
    resetScriptInputRefs();
    setScriptInputsDialogDraft(
      scriptInputDraftFromValues(definition, savedValues),
    );
    setScriptInputsDialogError(undefined);
    setScriptInputsDialogSaving(false);

    return await new Promise<ScriptInputValues | null>((resolve) => {
      scriptInputsDialogResolver = resolve;
      setScriptInputsDialogOpen(true);
    });
  };

  const saveScriptInputsDialog = async (): Promise<void> => {
    const definition = scriptInputsDialogDefinition();
    if (definition === undefined || scriptInputsDialogSaving()) {
      return;
    }

    const result = scriptInputValuesFromDraft(
      definition,
      scriptInputsDialogDraft(),
    );
    if (!result.ok) {
      setScriptInputsDialogError(result.error);
      return;
    }

    setScriptInputsDialogSaving(true);
    try {
      const saved = await window.desktop.scripting.saveInputValues(
        definition,
        result.values,
      );
      closeScriptInputsDialog(saved);
    } catch (error) {
      console.error("Failed to save script inputs:", error);
      setScriptInputsDialogError({
        message: "Failed to save inputs",
        fields: [],
      });
      setScriptInputsDialogSaving(false);
    }
  };

  const prepareScriptInputValuesForStart = async (
    definition: ScriptInputsDefinition | undefined,
  ): Promise<ScriptInputValues | null> => {
    if (definition === undefined) {
      return {};
    }

    const savedValues =
      await window.desktop.scripting.getInputValues(definition);
    const resolved = resolveScriptInputValues(definition, savedValues);
    if (resolved.missingRequiredKeys.length === 0) {
      return resolved.values;
    }

    const updatedValues = await openScriptInputsDialog("required", definition);
    if (updatedValues === null) {
      return null;
    }

    const updatedResolved = resolveScriptInputValues(definition, updatedValues);
    return updatedResolved.missingRequiredKeys.length === 0
      ? updatedResolved.values
      : null;
  };

  const openLoadedScriptInputs = (): void => {
    const definition = scriptInputsDefinition();
    if (
      definition === undefined ||
      !scriptLoaded() ||
      scriptRunning() ||
      scriptInputsDialogOpen()
    ) {
      return;
    }

    void openScriptInputsDialog("manual", definition)
      .then((values) => {
        if (values !== null) {
          setScriptStatus(`Updated inputs for ${scriptName() || "script"}`);
        }
      })
      .catch((error) => {
        console.error("Failed to open script inputs:", error);
        setScriptStatus("Failed to open script inputs");
      });
  };

  const renderScriptInputField = (field: ScriptInputField): JSX.Element => {
    const value = () => scriptInputsDialogDraft()[field.key];
    const label = () => field.label ?? "";
    const hasError = () => scriptInputFieldHasError(field.key);

    if (field.type === "boolean") {
      return (
        <div
          class="game-script-inputs-dialog__field"
          data-invalid={hasError() ? "" : undefined}
          data-script-input-key={field.key}
          ref={(element) => {
            setScriptInputFieldRef(field.key, element);
          }}
        >
          <Checkbox
            aria-label={label() || field.key}
            checked={value() === true}
            disabled={scriptInputsDialogSaving()}
            invalid={hasError()}
            ref={(element) => {
              setScriptInputEditorRef(field.key, element);
            }}
            onChange={(event) =>
              updateScriptInputDraft(field.key, event.currentTarget.checked)
            }
          >
            <span class="game-script-inputs-dialog__checkbox-label-content">
              <span class="game-script-inputs-dialog__checkbox-label-text">
                {label() || field.key}
                <Show when={field.required}>
                  <span
                    aria-hidden="true"
                    class="game-script-inputs-dialog__field-required game-script-inputs-dialog__field-required--inline"
                  >
                    {"\u00a0"}*
                  </span>
                </Show>
                <Show when={!field.required}>
                  <span class="game-script-inputs-dialog__field-optional game-script-inputs-dialog__field-optional--inline">
                    {"\u00a0"}(optional)
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
          <Show when={scriptInputFieldErrorMsg(field.key)}>
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
        ref={(element) => {
          setScriptInputFieldRef(field.key, element);
        }}
      >
        <Show when={label() || field.key}>
          <Label class="game-script-inputs-dialog__label">
            <span class="game-script-inputs-dialog__label-text">
              {label() || field.key}
              <Show when={field.required}>
                <span
                  aria-hidden="true"
                  class="game-script-inputs-dialog__field-required game-script-inputs-dialog__field-required--inline"
                >
                  {"\u00a0"}*
                </span>
              </Show>
              <Show when={!field.required}>
                <span class="game-script-inputs-dialog__field-optional game-script-inputs-dialog__field-optional--inline">
                  {"\u00a0"}(optional)
                </span>
              </Show>
            </span>
          </Label>
        </Show>
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
              aria-label={label() || field.key}
              disabled={scriptInputsDialogSaving()}
              fullWidth
              invalid={hasError()}
              inputMode={field.type === "number" ? "decimal" : undefined}
              ref={(element) => {
                setScriptInputEditorRef(field.key, element);
              }}
              type={field.type === "number" ? "number" : "text"}
              value={String(value() ?? "")}
              onInput={(event) =>
                updateScriptInputDraft(field.key, event.currentTarget.value)
              }
            />
          }
        >
          <Combobox
            value={value() ? [String(value())] : []}
            class={
              hasError()
                ? "game-script-inputs-dialog__combobox--invalid"
                : undefined
            }
            disabled={scriptInputsDialogSaving()}
            inputBehavior="autohighlight"
            openOnClick
            onValueChange={(details) => {
              updateScriptInputDraft(field.key, details.value[0] ?? "");
            }}
          >
            <ComboboxInput
              aria-label={label() || field.key}
              aria-invalid={hasError() ? "true" : undefined}
              disabled={scriptInputsDialogSaving()}
              placeholder={field.required ? "Select a value" : "No value"}
              ref={(element) => {
                setScriptInputEditorRef(field.key, element);
              }}
              showClear={!field.required}
            />
            <ComboboxContent>
              <ComboboxEmpty>No matching options</ComboboxEmpty>
              <ComboboxList>
                <For each={field.options ?? []}>
                  {(option) => (
                    <ComboboxItem value={option}>{option}</ComboboxItem>
                  )}
                </For>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Show>
        <Show when={scriptInputFieldErrorMsg(field.key)}>
          {(message) => (
            <span class="game-script-inputs-dialog__field-error-msg">
              {message()}
            </span>
          )}
        </Show>
      </div>
    );
  };

  const runAccountLaunch = (payload: AccountGameLaunchPayload) =>
    Effect.gen(function* () {
      yield* publishAccountManagerWindowStatusEffect("starting", "Waiting...");
      yield* Effect.promise(() => waitForLoadedGame());

      const autoRelogin = yield* AutoRelogin;
      const outcome = yield* autoRelogin.login({
        username: payload.account.username,
        password: payload.account.password,
        ...(payload.server === undefined ? {} : { server: payload.server }),
      });

      if (outcome.stage === "server-select") {
        yield* Effect.sync(() => {
          accountLaunchStatusPending = false;
        });
        yield* publishAccountManagerWindowStatusEffect(
          "stopped",
          payload.script
            ? "Select a server to run the script"
            : "Waiting for server selection",
        );
        void refreshScriptMeta();
        return;
      }

      if (!payload.script) {
        setScriptRunning(false);
        setScriptStatus("No script loaded");
        yield* Effect.sync(() => {
          accountLaunchStatusPending = false;
        });
        yield* publishAccountManagerWindowStatusEffect(
          "idle",
          "No script loaded",
        );
        void refreshScriptMeta();
        return;
      }

      const script = payload.script;
      const name = script.name ?? script.path ?? "script";
      const runner = yield* ScriptRunner;
      yield* Effect.sync(() => {
        applyLoadedScript(script.source, name, script.path, script.inputs);
        accountLaunchStatusPending = false;
      });
      const inputValues = yield* Effect.promise(() =>
        prepareScriptInputValuesForStart(script.inputs),
      );
      if (inputValues === null) {
        return yield* accountLaunchError("Script inputs required", {
          code: "inputs_required",
        });
      }
      yield* runner
        .run(script.source, {
          name,
          inputs: inputValues,
        })
        .pipe(
          Effect.mapError((error) =>
            accountLaunchError(
              error instanceof Error ? error.message : "Failed to run script",
              { cause: error },
            ),
          ),
        );
      setScriptRunning(true);
      setScriptStatus(`Running ${name}`);
      void refreshScriptMeta();
    }).pipe(
      Effect.catch((error: unknown) =>
        Effect.gen(function* () {
          console.error("Failed to run account launch:", error);
          if (
            payload.script !== undefined &&
            !isAccountLaunchInputsRequired(error)
          ) {
            const name = payload.script.name ?? payload.script.path ?? "script";
            yield* Effect.sync(() => {
              showFatalScriptError(name, error, payload.script?.path);
            });
          }
          yield* Effect.sync(() => {
            accountLaunchStatusPending = false;
          });
          yield* publishAccountManagerWindowStatusEffect(
            "failed",
            formatAccountLaunchError(error),
            payload.script?.name ?? payload.script?.path,
          );
          void refreshScriptMeta();
        }),
      ),
    );

  const handleAccountLaunch = (payload: AccountGameLaunchPayload) => {
    activeAccountLaunchPayload = payload;
    accountLaunchStatusPending = true;
    accountManagerStatusPublisher.reset();
    const fiber = runtime.runFork(runAccountLaunch(payload));
    accountLaunchFibers.add(fiber);
    let removeObserver: (() => void) | undefined;
    let observerCompleted = false;
    removeObserver = fiber.addObserver(() => {
      observerCompleted = true;
      removeObserver?.();
      accountLaunchFibers.delete(fiber);
    });
    if (observerCompleted) {
      removeObserver();
    }
  };

  const applyLoadedScript = (
    source: string,
    name: string,
    path?: string,
    inputs?: ScriptInputsDefinition,
  ) => {
    setScriptName(name);
    setScriptPath(path);
    setScriptSource(source);
    setScriptInputsDefinition(inputs);
    setScriptLoaded(true);
  };

  const applyAppSettings = (settings: AppSettings) => {
    setSettings(settings);
  };

  const applyScriptPayload = async (
    payload: ScriptExecutePayload,
  ): Promise<string> => {
    const name = payload.name ?? payload.path ?? "script";
    applyLoadedScript(payload.source, name, payload.path, payload.inputs);
    return name;
  };

  const runScriptPayloadFromIpc = async (
    payload: ScriptExecutePayload,
  ): Promise<void> => {
    const name = await applyScriptPayload(payload);
    const inputValues = await prepareScriptInputValuesForStart(payload.inputs);
    if (inputValues === null) {
      setScriptStatus("Script inputs required");
      return;
    }

    await runtime.runPromise(
      Effect.gen(function* () {
        const runner = yield* ScriptRunner;
        yield* runner.run(payload.source, { name, inputs: inputValues });
      }),
    );
    setScriptRunning(true);
    setScriptStatus(`Running ${name}`);
  };

  const refreshScriptMeta = async () => {
    try {
      const wasRunning = scriptRunning();
      const { isRunning, diagnostics, options } = await runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          const [isRunning, diagnostics, options] = yield* Effect.all([
            runner.isRunning(),
            runner.diagnostics(),
            runner.getOptions(),
          ]);
          return { isRunning, diagnostics, options };
        }),
      );

      setScriptRunning(isRunning);
      setScriptDiagnosticsCount(diagnostics.length);
      setScriptUsePrivateRooms(options.usePrivateRooms);
      setScriptSafeStartStop(options.safeStartStop);
      setScriptStatus(formatScriptStatus(scriptLoaded(), isRunning));
      showStoppedScriptFatalAlert(wasRunning, isRunning, diagnostics);
      publishCurrentAccountManagerStatus();
    } catch (error) {
      console.error("Failed to refresh script metadata", error);
      setScriptStatus("Failed to refresh script state");
      publishCurrentAccountManagerStatus();
    }
  };

  const loadScript = async () => {
    try {
      const payload = await window.desktop.scripting.openFile();
      if (!payload) {
        setScriptStatus("Open script cancelled");
        return;
      }

      const name = await applyScriptPayload(payload);
      setScriptStatus(`Loaded ${name}`);
      void refreshScriptMeta();
    } catch (error) {
      console.error("Failed to load script", error);
      setScriptLoaded(false);
      setScriptInputsDefinition(undefined);
      setScriptStatus("Failed to load script");
    }
  };

  const startScript = (): void => {
    const source = scriptSource().trim();
    if (!source) {
      setScriptStatus("No script loaded");
      return;
    }

    const name = scriptName() || "script";
    setScriptStatus(`Starting ${name}`);
    void prepareScriptInputValuesForStart(scriptInputsDefinition())
      .then((inputValues) => {
        if (inputValues === null) {
          setScriptStatus("Script inputs required");
          return Promise.resolve(false);
        }

        return runtime
          .runPromise(
            Effect.gen(function* () {
              const runner = yield* ScriptRunner;
              yield* runner.run(source, { name, inputs: inputValues });
            }),
          )
          .then(() => true);
      })
      .then((started) => {
        if (!started) {
          return;
        }

        setScriptRunning(true);
        setScriptStatus(`Running ${name}`);
      })
      .catch((error) => {
        console.error("Failed to start script", error);
        showFatalScriptError(name, error, scriptPath());
        setScriptStatus(`Failed to start ${name}`);
      })
      .finally(() => {
        void refreshScriptMeta();
      });
  };

  const stopScript = () => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          yield* runner.stop("ui request");
        }),
      )
      .catch((error) => {
        console.error("Failed to stop script", error);
      })
      .finally(() => {
        void refreshScriptMeta();
      });
    setScriptStatus("Stop requested");
  };

  const handleToggleScriptPrivateRooms = () => {
    const nextEnabled = !scriptUsePrivateRooms();
    setScriptUsePrivateRooms(nextEnabled);
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          yield* runner.setUsePrivateRooms(nextEnabled);
        }),
      )
      .catch((error) => {
        console.error("Failed to update script private room option", error);
        setScriptUsePrivateRooms(!nextEnabled);
      })
      .finally(() => {
        void refreshScriptMeta();
      });
  };

  const handleToggleScriptSafeStartStop = () => {
    const nextEnabled = !scriptSafeStartStop();
    setScriptSafeStartStop(nextEnabled);
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          yield* runner.setSafeStartStop(nextEnabled);
        }),
      )
      .catch((error) => {
        console.error("Failed to update script safe start/stop option", error);
        setScriptSafeStartStop(!nextEnabled);
      })
      .finally(() => {
        void refreshScriptMeta();
      });
  };

  const handleAccountGameWindowShutdownRequest = async (
    _request: AccountGameWindowShutdownRequest,
  ): Promise<void> => {
    setScriptStatus("Close requested");
    await runtime.runPromise(
      Effect.gen(function* () {
        const runner = yield* ScriptRunner;
        const auth = yield* Auth;

        yield* runner.stop("account manager close request").pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              console.error("Failed to stop script during client close", cause);
            }),
          ),
        );

        const loggedIn = yield* auth.isLoggedIn().pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              console.error(
                "Failed to inspect login state during client close",
                cause,
              );
              return false;
            }),
          ),
        );

        if (loggedIn) {
          yield* auth.logout().pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                console.error("Failed to logout during client close", cause);
              }),
            ),
          );
        }
      }),
    );

    setScriptRunning(false);
    setScriptStatus("Closing game client");
    void refreshScriptMeta();
  };

  const canApplyGameSettings = () => gameLoaded() && playerReady();

  const runSettingsEffect = (
    label: string,
    effect: (settings: SettingsShape) => Effect.Effect<void, unknown>,
  ) => {
    if (!canApplyGameSettings()) {
      return;
    }

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;
          yield* effect(settings);
        }),
      )
      .catch((error) => {
        console.error(`${label} error:`, error);
      });
  };

  const refreshPlayerReadyState = () => {
    if (!getGameLoadState().loaded) {
      setPlayerReady(false);
      publishCurrentAccountManagerStatus();
      packetsBridgeController?.stopActive("Game is not loaded");
      return;
    }

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const player = yield* Player;
          return yield* player.isReady();
        }),
      )
      .then((isReady) => {
        const wasReady = playerReady();
        setPlayerReady(isReady);
        publishCurrentAccountManagerStatus();
        if (isReady && !wasReady) {
          refreshTravelOptions();
        } else if (!isReady && wasReady) {
          packetsBridgeController?.stopActive("Player disconnected");
        }
      })
      .catch((error) => {
        setPlayerReady(false);
        publishCurrentAccountManagerStatus();
        packetsBridgeController?.stopActive("Player readiness check failed");
        console.error("Refresh player ready state error:", error);
      });
  };

  const refreshTravelOptions = () => {
    if (!getGameLoadState().loaded || !playerReady()) {
      return;
    }

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const player = yield* Player;
          const isReady = yield* player.isReady();
          if (!isReady) {
            return null;
          }

          const world = yield* World;
          const [mapCells, mapPads, currentCell, currentPad] =
            yield* Effect.all([
              world.map.getCells(),
              world.map.getCellPads(),
              player.getCell(),
              player.getPad(),
            ]);

          return { currentCell, currentPad, mapCells, mapPads };
        }),
      )
      .then((result) => {
        if (result === null) {
          return;
        }

        const { currentCell, currentPad, mapCells, mapPads } = result;
        const nextCells = uniqueNonEmpty([...mapCells, currentCell]);
        const nextValidPads = uniqueNonEmpty([currentPad, ...mapPads]);

        setCells(nextCells.length > 0 ? nextCells : [DEFAULT_CELL]);
        setValidPads(nextValidPads);
        setSelectedCell(currentCell || nextCells[0] || DEFAULT_CELL);
        setSelectedPad(currentPad || DEFAULT_PAD);
      })
      .catch((error) => {
        console.error("Refresh travel options error:", error);
      });
  };

  const jumpToCellPad = (cell: string, pad: string) => {
    const targetCell = cell.trim() || DEFAULT_CELL;
    const targetPad = pad.trim();

    setTravelBusy(true);
    setSelectedCell(targetCell);
    if (targetPad) {
      setSelectedPad(targetPad);
    }
    setOpenTopNavMenu(null);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const player = yield* Player;
          yield* player.jumpToCell(
            targetCell,
            targetPad.length > 0 ? targetPad : undefined,
          );
          const [currentCell, currentPad] = yield* Effect.all([
            player.getCell(),
            player.getPad(),
          ]);
          return { currentCell, currentPad };
        }),
      )
      .then(({ currentCell, currentPad }) => {
        setSelectedCell(currentCell || targetCell);
        setSelectedPad(currentPad || targetPad || DEFAULT_PAD);
        refreshTravelOptions();
      })
      .catch((error) => {
        console.error("Jump to cell/pad error:", error);
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

  const handleOpenBank = () => {
    setOpenTopNavMenu(null);
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const bank = yield* Bank;
          yield* bank.open();
        }),
      )
      .catch((error) => {
        console.error("Open bank error:", error);
      });
  };

  const handleToggleEnemyMagnet = () => {
    const nextEnabled = !enemyMagnetEnabled();
    setEnemyMagnetEnabled(nextEnabled);
    runSettingsEffect("Toggle enemy magnet", (settings) =>
      settings.setEnemyMagnetEnabled(nextEnabled),
    );
  };

  const handleToggleInfiniteRange = () => {
    const nextEnabled = !infiniteRangeEnabled();
    setInfiniteRangeEnabled(nextEnabled);
    runSettingsEffect("Toggle infinite range", (settings) =>
      settings.setInfiniteRangeEnabled(nextEnabled),
    );
  };

  const handleToggleProvokeCell = () => {
    const nextEnabled = !provokeCellEnabled();
    setProvokeCellEnabled(nextEnabled);
    runSettingsEffect("Toggle provoke cell", (settings) =>
      settings.setProvokeCellEnabled(nextEnabled),
    );
  };

  const handleToggleSkipCutscenes = () => {
    const nextEnabled = !skipCutscenesEnabled();
    setSkipCutscenesEnabled(nextEnabled);
    runSettingsEffect("Toggle skip cutscenes", (settings) =>
      settings.setSkipCutscenesEnabled(nextEnabled),
    );
  };

  const handleToggleAntiCounter = () => {
    const nextEnabled = !antiCounterEnabled();
    setAntiCounterEnabled(nextEnabled);
    runSettingsEffect("Toggle anti-counter", (settings) =>
      settings.setAntiCounterEnabled(nextEnabled),
    );
  };

  const handleToggleDeathAds = () => {
    const nextVisible = !deathAdsVisible();
    setDeathAdsVisible(nextVisible);
    runSettingsEffect("Toggle death ads", (settings) =>
      settings.setDeathAdsVisible(nextVisible),
    );
  };

  const handleToggleCollisions = () => {
    const nextEnabled = !collisionsEnabled();
    setCollisionsEnabled(nextEnabled);
    runSettingsEffect("Toggle collisions", (settings) =>
      settings.setCollisionsEnabled(nextEnabled),
    );
  };

  const handleToggleEffects = () => {
    const nextEnabled = !effectsEnabled();
    setEffectsEnabled(nextEnabled);
    runSettingsEffect("Toggle effects", (settings) =>
      settings.setEffectsEnabled(nextEnabled),
    );
  };

  const handleTogglePlayersVisible = () => {
    const nextVisible = !otherPlayersVisible();
    setOtherPlayersVisible(nextVisible);
    runSettingsEffect("Toggle players visible", (settings) =>
      settings.setOtherPlayersVisible(nextVisible),
    );
  };

  const handleToggleLagKiller = () => {
    const nextEnabled = !lagKillerEnabled();
    setLagKillerEnabled(nextEnabled);
    runSettingsEffect("Toggle lag killer", (settings) =>
      settings.setLagKillerEnabled(nextEnabled),
    );
  };

  const handleSetCustomName = () => {
    const name = customName().trim();
    if (name === "") {
      return;
    }

    setCustomName(name);
    runSettingsEffect("Set custom name", (settings) =>
      settings.setCustomName(name),
    );
  };

  const handleSetCustomGuild = () => {
    const guild = customGuild().trim();
    if (guild === "") {
      return;
    }

    setCustomGuild(guild);
    runSettingsEffect("Set custom guild", (settings) =>
      settings.setCustomGuild(guild),
    );
  };

  const handleSetWalkSpeed = () => {
    const speed = Number.parseFloat(walkSpeed());
    if (!Number.isFinite(speed) || speed <= 0) {
      setWalkSpeed("8");
      return;
    }

    runSettingsEffect("Set walk speed", (settings) =>
      settings.setWalkSpeed(speed),
    );
  };

  const handleSetFrameRate = () => {
    const fps = Number.parseInt(frameRate(), 10);
    if (!Number.isFinite(fps) || fps <= 0) {
      setFrameRate("24");
      return;
    }

    runSettingsEffect("Set frame rate", (settings) =>
      settings.setFrameRate(fps),
    );
  };

  const autoAttackConfiguredProfileLabel = createMemo(() => {
    const library = combatProfileLibrary();
    const state = library.autoAttack;

    if (state.mode === "generic") {
      return "Generic";
    }

    if (state.mode === "selected" && state.selectedProfileId) {
      const profile = findCombatProfileByRef(library, {
        mode: "selected",
        profileId: state.selectedProfileId,
      });
      return `Profile: ${profile.label}`;
    }

    return "Match class";
  });

  const applyAutoAttackState = (state: AutoAttackState) => {
    setAutoAttackEnabled(state.enabled);
    setAutoAttackProfileLabel(
      state.profileLabel ?? autoAttackConfiguredProfileLabel(),
    );
    setAutoAttackLastError(state.lastError ?? "");
  };

  const refreshAutoAttackState = () => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const autoAttack = yield* AutoAttack;
          return yield* autoAttack.getState();
        }),
      )
      .then(applyAutoAttackState)
      .catch((error) => {
        console.error("Refresh auto attack state error:", error);
      });
  };

  const syncEnabledAutoAttackProfile = (library: CombatProfileLibrary) => {
    if (!autoAttackEnabled()) {
      setAutoAttackProfileLabel(autoAttackConfiguredProfileLabel());
      return;
    }

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const autoAttack = yield* AutoAttack;
          return yield* autoAttack.enable({
            library,
            profileRef: autoAttackStateToProfileRef(library.autoAttack),
          });
        }),
      )
      .then(applyAutoAttackState)
      .catch((error) => {
        console.error("Sync auto attack profile error:", error);
        refreshAutoAttackState();
      });
  };

  const applyCombatProfileLibrary = (library: CombatProfileLibrary) => {
    setCombatProfileLibrary(library);
    syncEnabledAutoAttackProfile(library);
  };

  const handleToggleAutoAttack = () => {
    if (autoAttackToggleInFlight) {
      return;
    }

    autoAttackToggleInFlight = true;
    const nextEnabled = !autoAttackEnabled();
    setAutoAttackEnabled(nextEnabled);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const autoAttack = yield* AutoAttack;
          return nextEnabled
            ? yield* autoAttack.enable({
                library: combatProfileLibrary(),
                profileRef: autoAttackStateToProfileRef(
                  combatProfileLibrary().autoAttack,
                ),
              })
            : yield* autoAttack.disable();
        }),
      )
      .then(applyAutoAttackState)
      .catch((error) => {
        console.error("Toggle auto attack error:", error);
        refreshAutoAttackState();
      })
      .finally(() => {
        autoAttackToggleInFlight = false;
      });
  };

  const handleToggleFollower = () => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const follower = yield* Follower;
          return yield* follower.toggle(combatProfileLibrary());
        }),
      )
      .then((state) => {
        setFollowerEnabled(state.enabled || state.running);
        void window.desktop.follower.publishState(state).catch((error) => {
          console.error("Follower state publish error:", error);
        });
      })
      .catch((error) => {
        console.error("Toggle follower error:", error);
      });
  };

  const handleSelectAutoAttackProfile = (
    mode: CombatProfileAutoAttackMode,
    selectedProfileId?: string,
  ) => {
    void window.desktop.combatProfiles
      .setAutoAttack(
        mode === "selected" && selectedProfileId
          ? { mode, selectedProfileId }
          : { mode },
      )
      .then(applyCombatProfileLibrary)
      .catch((error: unknown) => {
        console.error("Set auto attack profile error:", error);
      });
  };

  const applyAutoZoneState = (state: AutoZoneState) => {
    setAutoZoneEnabled(state.enabled);
    setAutoZoneMap(state.map);
  };

  const refreshAutoZoneState = () => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const autoZone = yield* AutoZone;
          return yield* autoZone.getState();
        }),
      )
      .then(applyAutoZoneState)
      .catch((error) => {
        console.error("Refresh autozone state error:", error);
      });
  };

  const handleToggleAutoZone = () => {
    const nextEnabled = !autoZoneEnabled();
    setAutoZoneEnabled(nextEnabled);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const autoZone = yield* AutoZone;
          yield* autoZone.setEnabled(nextEnabled);
          return yield* autoZone.getState();
        }),
      )
      .then(applyAutoZoneState)
      .catch((error) => {
        console.error("Toggle autozone error:", error);
        refreshAutoZoneState();
      });
  };

  const handleSelectAutoZoneMap = (map: AutoZoneSupportedMap | undefined) => {
    setAutoZoneMap(map);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const autoZone = yield* AutoZone;
          yield* autoZone.setMap(map);
          return yield* autoZone.getState();
        }),
      )
      .then(applyAutoZoneState)
      .catch((error) => {
        console.error("Set autozone map error:", error);
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

  const isSwfBridgeNotReadyError = (error: unknown): boolean =>
    error instanceof SwfUnavailableError ||
    error instanceof SwfMethodNotFoundError;

  const refreshAutoReloginState = () => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;
          return yield* autoRelogin.getState();
        }),
      )
      .then(applyAutoReloginState)
      .catch((error) => {
        console.error("Refresh autorelogin state error:", error);
      });
  };

  const handleToggleAutoRelogin = () => {
    if (autoReloginToggling()) {
      return;
    }

    const nextEnabled = !autoReloginEnabled();
    setAutoReloginToggling(true);
    setAutoReloginEnabled(nextEnabled);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;
          return yield* nextEnabled
            ? autoRelogin.enable()
            : autoRelogin.disable();
        }),
      )
      .then(applyAutoReloginState)
      .catch((error) => {
        console.error("Toggle autorelogin error:", error);
        refreshAutoReloginState();
      })
      .finally(() => {
        setAutoReloginToggling(false);
      });
  };

  const refreshAutoReloginServers = () => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth;
          return yield* auth.getServers();
        }),
      )
      .then((servers) => {
        setAutoReloginServers(
          servers
            .map((server) => server.name)
            .filter((serverName) => serverName.trim() !== ""),
        );
      })
      .catch((error) => {
        if (isSwfBridgeNotReadyError(error)) {
          setAutoReloginServers([]);
          return;
        }

        console.error("Refresh autorelogin servers error:", error);
      });
  };

  const handleSelectAutoReloginServer = (serverName: string) => {
    setAutoReloginServer(serverName);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;
          return yield* autoRelogin.setServer(serverName);
        }),
      )
      .then(applyAutoReloginState)
      .catch((error) => {
        console.error("Set autorelogin server error:", error);
        refreshAutoReloginState();
      });
  };

  const handleSetAutoReloginDelay = () => {
    const delayMs = parseDelaySecondsToMs(autoReloginDelaySeconds());
    if (!Number.isFinite(delayMs)) {
      refreshAutoReloginState();
      return;
    }

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;
          return yield* autoRelogin.setDelay(delayMs);
        }),
      )
      .then(applyAutoReloginState)
      .catch((error) => {
        console.error("Set autorelogin delay error:", error);
        refreshAutoReloginState();
      });
  };

  const optionItems = createMemo<readonly TopNavOptionItem[]>(() => {
    const disabled = !canApplyGameSettings();

    return [
      {
        id: "infinite-range",
        label: "Infinite Range",
        checked: infiniteRangeEnabled(),
        disabled,
        onSelect: handleToggleInfiniteRange,
      },
      {
        id: "provoke-cell",
        label: "Provoke Cell",
        checked: provokeCellEnabled(),
        disabled,
        onSelect: handleToggleProvokeCell,
      },
      {
        id: "enemy-magnet",
        label: "Enemy Magnet",
        checked: enemyMagnetEnabled(),
        disabled,
        onSelect: handleToggleEnemyMagnet,
      },
      {
        id: "lag-killer",
        label: "Lag Killer",
        checked: lagKillerEnabled(),
        disabled,
        onSelect: handleToggleLagKiller,
      },
      {
        id: "hide-players",
        label: "Hide Players",
        checked: !otherPlayersVisible(),
        disabled,
        onSelect: handleTogglePlayersVisible,
      },
      {
        id: "skip-cutscenes",
        label: "Skip Cutscenes",
        checked: skipCutscenesEnabled(),
        disabled,
        onSelect: handleToggleSkipCutscenes,
      },
      {
        id: "anti-counter",
        label: "Anti-Counter",
        checked: antiCounterEnabled(),
        disabled,
        onSelect: handleToggleAntiCounter,
      },
      {
        id: "disable-fx",
        label: "Disable FX",
        checked: !effectsEnabled(),
        disabled,
        onSelect: handleToggleEffects,
      },
      {
        id: "collisions",
        label: "Collisions",
        checked: collisionsEnabled(),
        disabled,
        onSelect: handleToggleCollisions,
      },
      {
        id: "death-ads",
        label: "Death Ads",
        checked: deathAdsVisible(),
        disabled,
        onSelect: handleToggleDeathAds,
      },
    ];
  });

  const gameCommands = createGameCommands({
    bindings: () => settings().hotkeys.bindings,
    loadScript,
    startScript,
    stopScript,
    scriptLoaded,
    scriptRunning,
    autoAttackEnabled,
    followerEnabled,
    toggleAutoAttack: handleToggleAutoAttack,
    toggleFollower: handleToggleFollower,
    toggleBank: () => {
      if (canApplyGameSettings()) {
        handleOpenBank();
      }
    },
    optionItems,
    openWindow,
    toggleTopNavMenu: (menu) =>
      setOpenTopNavMenu((current) => (current === menu ? null : menu)),
    toggleTopBarVisible: () => {
      setOpenTopNavMenu(null);
      setTopBarVisible((visible) => !visible);
    },
  });

  const getHotkeyToastTitle = (command: GameCommand): string | null => {
    const option = findTopNavOption(optionItems(), command.id);
    if (option !== undefined) {
      return `${option.label} ${option.checked ? "On" : "Off"}`;
    }

    return null;
  };

  const handleHotkeyCommandRun = (command: GameCommand): void => {
    if (openTopNavMenu() === "options") return;

    const title = getHotkeyToastTitle(command);
    if (title === null) return;

    hotkeyToasts.info(title, {
      dismissible: false,
      id: "game-hotkey-feedback",
    });
  };

  createEffect(() => {
    document.documentElement.toggleAttribute(
      "data-top-bar-hidden",
      !topBarVisible(),
    );
  });

  createEffect(() => {
    if (openTopNavMenu() === "options") {
      hotkeyToasts.closeAll();
    }
  });

  onCleanup(() => {
    document.documentElement.removeAttribute("data-top-bar-hidden");
  });

  const publishFollowerState = () =>
    runtime
      .runPromise(
        Effect.gen(function* () {
          const follower = yield* Follower;
          return yield* follower.getState();
        }),
      )
      .then((state) => window.desktop.follower.publishState(state))
      .catch((error: unknown) => {
        console.error("Failed to publish follower state:", error);
      });

  const getFollowerState = () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const follower = yield* Follower;
        return yield* follower.getState();
      }),
    );

  const getFollowerMe = () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const auth = yield* Auth;
        return yield* auth
          .getUsername()
          .pipe(Effect.catch(() => Effect.succeed("")));
      }),
    );

  const startFollower = (payload: FollowerStartPayload) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const autoAttack = yield* AutoAttack;
        const follower = yield* Follower;
        const autoAttackState = yield* autoAttack.disable();
        applyAutoAttackState(autoAttackState);
        return yield* follower.start({
          config: payload,
          library: combatProfileLibrary(),
        });
      }),
    );

  const stopFollower = () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const follower = yield* Follower;
        return yield* follower.stop();
      }),
    );

  const respondFastTravel = (
    requestId: string,
    response:
      | { readonly ok: true }
      | { readonly ok: false; readonly error: string },
  ) =>
    window.desktop.fastTravels.respond({
      requestId,
      ...response,
    });

  const runFastTravelRequest = async (
    request: FastTravelsRequestMessage,
  ): Promise<void> => {
    if (cleanedUp) {
      await respondFastTravel(request.requestId, {
        ok: false,
        error: "Game window is shutting down",
      });
      return;
    }

    if (request.kind !== "warp") {
      await respondFastTravel(request.requestId, {
        ok: false,
        error: `Unsupported fast travel request: ${String(request.kind)}`,
      });
      return;
    }

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const player = yield* Player;
          const ready = yield* player.isReady();
          if (!ready) {
            throw new Error("Player is not ready");
          }

          const { location } = request.payload;
          yield* player.joinMap(
            fastTravelMapTarget(request.payload),
            location.cell,
            location.pad,
          );
        }),
      );
      await respondFastTravel(request.requestId, { ok: true });
    } catch (error: unknown) {
      console.error("Fast travel request failed:", error);
      const message =
        error instanceof Error && error.message !== ""
          ? error.message
          : "Fast travel failed";
      await respondFastTravel(request.requestId, {
        ok: false,
        error: message,
      });
    }
  };

  const handleFastTravelRequest = (
    request: FastTravelsRequestMessage,
  ): void => {
    fastTravelRequestChain = fastTravelRequestChain
      .catch((error: unknown) => {
        console.error("Fast travel request chain failed:", error);
      })
      .then(() => runFastTravelRequest(request));
    void fastTravelRequestChain.catch((error: unknown) => {
      console.error("Fast travel request handling failed:", error);
    });
  };

  onMount(() => {
    markGameStartup("app-mounted");
    writeGameStartupTiming("Game app mounted", {
      initialSettingsPresent:
        props.initialSettings !== undefined && props.initialSettings !== null,
    });

    const unsubscribeAppSettings =
      window.desktop.settings.onChanged(applyAppSettings);
    const unsubscribeAccountLaunch =
      window.desktop.accounts.onGameLaunch(handleAccountLaunch);
    const unsubscribeGameWindowShutdown =
      window.desktop.accounts.onGameWindowShutdownRequest(
        handleAccountGameWindowShutdownRequest,
      );
    const unsubscribeCombatProfiles = window.desktop.combatProfiles.onChanged(
      applyCombatProfileLibrary,
    );
    const unsubscribeScriptExecute = window.desktop.scripting.onExecute(
      (payload) => {
        void runScriptPayloadFromIpc(payload)
          .catch((error) => {
            const name = payload.name ?? payload.path ?? "script";
            console.error("Failed to run script payload", error);
            showFatalScriptError(name, error, payload.path);
            setScriptStatus("Failed to run script");
          })
          .finally(() => {
            void refreshScriptMeta();
          });
      },
    );
    const unsubscribeScriptStop = window.desktop.scripting.onStop(() => {
      setScriptRunning(false);
      setScriptStatus("Stop requested");
      void refreshScriptMeta();
    });
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          return yield* runner.onStatus(
            (status) => {
              void publishAccountManagerStatus(status).catch(
                (error: unknown) => {
                  console.error(
                    "Failed to publish account script status:",
                    error,
                  );
                },
              );
            },
            { emitCurrent: false },
          );
        }),
      )
      .then((disposeAccountManagerStatus) => {
        if (cleanedUp) {
          disposeAccountManagerStatus();
          return;
        }

        accountManagerStatusDisposer = disposeAccountManagerStatus;
      })
      .catch((error) => {
        console.error("Account script status subscription error:", error);
      });
    const unsubscribeFollowerGetState =
      window.desktop.follower.onGetStateRequest(getFollowerState);
    const unsubscribeFollowerMe =
      window.desktop.follower.onMeRequest(getFollowerMe);
    const unsubscribeFollowerStart =
      window.desktop.follower.onStartRequest(startFollower);
    const unsubscribeFollowerStop =
      window.desktop.follower.onStopRequest(stopFollower);
    const unsubscribeFastTravels = window.desktop.fastTravels.onRequest(
      handleFastTravelRequest,
    );
    const packetsBridge = installPacketsBridge(runtime);
    const loaderGrabberBridge = installLoaderGrabberBridge(runtime);
    packetsBridgeController = packetsBridge;
    let followerStateDisposer: (() => void) | undefined;

    if (props.initialSettings === undefined || props.initialSettings === null) {
      void window.desktop.settings
        .get()
        .then(applyAppSettings)
        .catch((error) => {
          console.error("Failed to load app settings:", error);
        });
    }

    void window.desktop.combatProfiles
      .getState()
      .then(applyCombatProfileLibrary)
      .catch((error) => {
        console.error("Failed to load combat profiles:", error);
      });

    const disposeGameLoadState = subscribeGameLoadState((state) => {
      setGameLoaded(state.loaded);
      if (state.loaded) {
        writeGameStartupTimingOnce(
          "game-load-state-loaded",
          "Game load state marked loaded",
        );
      }
      if (!state.loaded) {
        setPlayerReady(false);
        publishCurrentAccountManagerStatus();
        packetsBridge.stopActive("Game reloaded");
      }
    });

    refreshPlayerReadyState();
    const playerReadyStateInterval = setInterval(refreshPlayerReadyState, 1200);

    void refreshScriptMeta();
    const scriptMetaInterval = setInterval(() => {
      void refreshScriptMeta();
    }, 1200);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;
          return yield* settings.onState((state) => {
            setCustomName(state.customName ?? "");
            setCustomGuild(state.customGuild ?? "");
            setWalkSpeed(String(state.walkSpeed));
            setFrameRate(String(state.frameRate));
            setDeathAdsVisible(state.deathAdsVisible);
            setCollisionsEnabled(state.collisionsEnabled);
            setEffectsEnabled(state.effectsEnabled);
            setOtherPlayersVisible(state.otherPlayersVisible);
            setLagKillerEnabled(state.lagKillerEnabled);
            setEnemyMagnetEnabled(state.enemyMagnetEnabled);
            setInfiniteRangeEnabled(state.infiniteRangeEnabled);
            setProvokeCellEnabled(state.provokeCellEnabled);
            setSkipCutscenesEnabled(state.skipCutscenesEnabled);
            setAntiCounterEnabled(state.antiCounterEnabled);
          });
        }),
      )
      .then(assignDisposer("settings"))
      .catch((error) => {
        console.error("Settings state subscription error:", error);
      });

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const autoAttack = yield* AutoAttack;
          return yield* autoAttack.onState(applyAutoAttackState);
        }),
      )
      .then(assignDisposer("autoAttack"))
      .catch((error) => {
        console.error("AutoAttack state subscription error:", error);
      });

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;
          return yield* autoRelogin.onState(applyAutoReloginState);
        }),
      )
      .then(assignDisposer("autoRelogin"))
      .catch((error) => {
        console.error("AutoRelogin state subscription error:", error);
      });

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const autoZone = yield* AutoZone;
          return yield* autoZone.onState(applyAutoZoneState);
        }),
      )
      .then(assignDisposer("autoZone"))
      .catch((error) => {
        console.error("AutoZone state subscription error:", error);
      });

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const follower = yield* Follower;
          return yield* follower.onState((state) => {
            setFollowerEnabled(state.enabled || state.running);
            void window.desktop.follower.publishState(state).catch((error) => {
              console.error("Follower state publish error:", error);
            });
          });
        }),
      )
      .then((disposeFollowerState) => {
        if (cleanedUp) {
          disposeFollowerState();
          return;
        }

        followerStateDisposer = disposeFollowerState;
        void publishFollowerState();
      })
      .catch((error) => {
        console.error("Follower state subscription error:", error);
      });

    onCleanup(() => {
      unsubscribeAppSettings();
      unsubscribeAccountLaunch();
      unsubscribeGameWindowShutdown();
      unsubscribeCombatProfiles();
      unsubscribeScriptExecute();
      unsubscribeScriptStop();
      unsubscribeFollowerGetState();
      unsubscribeFollowerMe();
      unsubscribeFollowerStart();
      unsubscribeFollowerStop();
      unsubscribeFastTravels();
      packetsBridge.dispose();
      loaderGrabberBridge.dispose();
      packetsBridgeController = undefined;
      accountManagerStatusDisposer?.();
      accountManagerStatusDisposer = undefined;
      followerStateDisposer?.();
      disposeGameLoadState();
      clearInterval(scriptMetaInterval);
      clearInterval(playerReadyStateInterval);
    });
  });

  onCleanup(() => {
    cleanedUp = true;
    for (const fiber of accountLaunchFibers) {
      runtime.runFork(Fiber.interrupt(fiber));
    }
    accountLaunchFibers.clear();
    settingsStateDisposer?.();
    autoAttackStateDisposer?.();
    autoZoneStateDisposer?.();
    autoReloginStateDisposer?.();
    if (fatalScriptAlertCopiedTimer !== undefined) {
      window.clearTimeout(fatalScriptAlertCopiedTimer);
    }
    if (scriptInputsDialogResolver !== undefined) {
      scriptInputsDialogResolver(null);
      scriptInputsDialogResolver = undefined;
    }
    resetScriptInputRefs();
  });

  const topNavOptionsMenuProps: TopNavOptionsMenuContentProps = {
    hotkeyBindings: () => settings().hotkeys.bindings,
    hotkeyPlatform: window.desktop.platform.os,
    optionItems,
    gameLoaded,
    playerReady,
    walkSpeed,
    setWalkSpeed,
    handleSetWalkSpeed,
    frameRate,
    setFrameRate,
    handleSetFrameRate,
    customName,
    setCustomName,
    handleSetCustomName,
    customGuild,
    setCustomGuild,
    handleSetCustomGuild,
  };

  return (
    <main class="game-shell">
      <Toaster
        class="game-toast-banner"
        controller={hotkeyToasts}
        placement="top-center"
      />
      <GameHotkeys
        commands={() => gameCommands}
        onCommandRun={handleHotkeyCommandRun}
      />
      <Dialog
        open={scriptInputsDialogOpen()}
        onOpenChange={(details) => {
          if (details.open) {
            setScriptInputsDialogOpen(true);
            return;
          }

          cancelScriptInputsDialog();
        }}
      >
        <DialogContent class="game-script-inputs-dialog">
          <DialogHeader>
            <DialogTitle>
              {scriptInputsDialogMode() === "required"
                ? "Script inputs required"
                : "Script inputs"}
            </DialogTitle>
            <DialogDescription>{scriptName() || "script"}</DialogDescription>
          </DialogHeader>
          <Show when={scriptInputsDialogError()}>
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
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  focusScriptInputField(field.key);
                                }}
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
              <For each={scriptInputsDialogDefinition()?.fields ?? []}>
                {renderScriptInputField}
              </For>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={scriptInputsDialogSaving()}
              onClick={cancelScriptInputsDialog}
              size="sm"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={scriptInputsDialogSaving()}
              onClick={() => void saveScriptInputsDialog()}
              size="sm"
            >
              {scriptInputsDialogMode() === "required"
                ? "Save and Start"
                : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
                        void window.desktop.scripting
                          .openPath(path())
                          .catch((error) => {
                            console.error("Failed to open script file", error);
                          });
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
      <Show when={!topBarVisible()}>
        <TopNavHiddenOptionsMenu
          {...topNavOptionsMenuProps}
          open={() => openTopNavMenu() === "options"}
          setOpen={(open) => setOpenTopNavMenu(open ? "options" : null)}
        />
      </Show>
      <Show when={topBarVisible()}>
        <TopNav
          openMenu={openTopNavMenu}
          setOpenMenu={setOpenTopNavMenu}
          hotkeyBindings={topNavOptionsMenuProps.hotkeyBindings}
          hotkeyPlatform={topNavOptionsMenuProps.hotkeyPlatform}
          autoAttackEnabled={autoAttackEnabled}
          autoAttackProfileLabel={autoAttackProfileLabel}
          autoAttackConfiguredProfileLabel={autoAttackConfiguredProfileLabel}
          autoAttackLastError={autoAttackLastError}
          combatProfiles={() =>
            combatProfileLibrary().profiles.filter(
              (profile) => profile.id !== DEFAULT_COMBAT_PROFILE_ID,
            )
          }
          autoAttackMode={() => combatProfileLibrary().autoAttack.mode}
          selectedAutoAttackProfileId={() =>
            combatProfileLibrary().autoAttack.selectedProfileId
          }
          handleToggleAutoAttack={handleToggleAutoAttack}
          handleSelectAutoAttackProfile={handleSelectAutoAttackProfile}
          gameLoaded={gameLoaded}
          playerReady={playerReady}
          scriptLoaded={scriptLoaded}
          scriptRunning={scriptRunning}
          scriptStatus={scriptStatus}
          scriptDiagnosticsCount={scriptDiagnosticsCount}
          scriptUsePrivateRooms={scriptUsePrivateRooms}
          scriptSafeStartStop={scriptSafeStartStop}
          scriptInputsAvailable={scriptInputsAvailable}
          loadScript={loadScript}
          startScript={startScript}
          stopScript={stopScript}
          openScriptInputs={openLoadedScriptInputs}
          handleToggleScriptPrivateRooms={handleToggleScriptPrivateRooms}
          handleToggleScriptSafeStartStop={handleToggleScriptSafeStartStop}
          optionItems={topNavOptionsMenuProps.optionItems}
          walkSpeed={topNavOptionsMenuProps.walkSpeed}
          setWalkSpeed={topNavOptionsMenuProps.setWalkSpeed}
          handleSetWalkSpeed={topNavOptionsMenuProps.handleSetWalkSpeed}
          frameRate={topNavOptionsMenuProps.frameRate}
          setFrameRate={topNavOptionsMenuProps.setFrameRate}
          handleSetFrameRate={topNavOptionsMenuProps.handleSetFrameRate}
          customName={topNavOptionsMenuProps.customName}
          setCustomName={topNavOptionsMenuProps.setCustomName}
          handleSetCustomName={topNavOptionsMenuProps.handleSetCustomName}
          customGuild={topNavOptionsMenuProps.customGuild}
          setCustomGuild={topNavOptionsMenuProps.setCustomGuild}
          handleSetCustomGuild={topNavOptionsMenuProps.handleSetCustomGuild}
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
        />
      </Show>
      {process.env.NODE_ENV === "development" && DevDebugEvaluator ? (
        <DevDebugEvaluator
          applyLoadedScript={applyLoadedScript}
          refreshScriptMeta={refreshScriptMeta}
        />
      ) : null}

      <section
        id="loader-container"
        class="game-loader"
        classList={{ "game-loader--hidden": gameLoaded() }}
        aria-hidden={gameLoaded() ? "true" : undefined}
        aria-live="polite"
      >
        <div class="game-loader__content">
          <Spinner class="game-loader__spinner" size="xl" />
          <span id="progress-text" class="game-loader__text">
            Loading...
          </span>
        </div>
      </section>

      <section
        id="game-container"
        class="game-viewport"
        classList={{ "game-viewport--loaded": gameLoaded() }}
      >
        <div class="game-visual-cover" aria-hidden="true" />
      </section>
    </main>
  );
}

mountWindow(({ initialSettings }) => <App initialSettings={initialSettings} />);
