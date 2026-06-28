import { Button, Icon, Spinner, Textarea } from "@lucent/ui";
import { Effect, Fiber } from "effect";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";

import type { AppPlatform } from "../../shared/desktopBridge";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../../shared/settings";
import * as Api from "./flash/api";
import {
  AutoRelogin,
  type AutoReloginState,
} from "./flash/features/AutoRelogin";
import {
  AutoZone,
  type AutoZoneState,
  type AutoZoneSupportedMap,
} from "./flash/features/AutoZone";
import { runtime } from "./flash/FlashRuntime";
import * as State from "./flash/state";
import {
  TopNav,
  type CombatProfileAutoAttackMode,
  type GameTopNavMenu,
  type TopNavOptionItem,
} from "./TopNav";

declare const LUCENT_DEV: boolean;

export interface GameLoadState {
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

const DEBUG_EVAL_OUTPUT_LIMIT = 2000;
const DEBUG_PANEL_MARGIN_PX = 12;
const DEBUG_PANEL_MIN_WIDTH_PX = 320;
const DEBUG_PANEL_MIN_HEIGHT_PX = 220;
const DEBUG_PANEL_DEFAULT_WIDTH_PX = 432;
const DEBUG_PANEL_DEFAULT_HEIGHT_PX = 360;
const PLAYER_READY_ACTION_TIMEOUT = "10 seconds";

const DEFAULT_INTERNAL_DEBUG_SOURCE = `return yield* services.player.getCell;`;
const AUTO_RELOGIN_DEFAULT_DELAY_SECONDS = "3";
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

interface TravelOptions {
  readonly currentCell: string;
  readonly currentPad: string;
  readonly mapCells: readonly string[];
  readonly mapPads: readonly string[];
}

const noop = (): void => {};
const loadScriptNoop = (): void => {
  console.debug("[game:script:no-op]", "load");
};
const toggleScriptNoop = (): void => {
  console.debug("[game:script:no-op]", "toggle");
};
const openScriptInputsNoop = (): void => {
  console.debug("[game:script:no-op]", "inputs");
};

let setCurrentLoadState:
  | ((updater: (state: GameLoadState) => GameLoadState) => void)
  | undefined;
let currentLoadState: GameLoadState = {
  loaded: false,
  progress: 0,
};

const writeDocumentLoaded = (loaded: boolean): void => {
  document.documentElement.dataset["loaded"] = loaded ? "true" : "false";
};

export const setGameLoadProgress = (percent: number): void => {
  const progress = Math.max(0, Math.min(100, Math.round(percent)));
  const next = {
    loaded: progress >= 100 ? currentLoadState.loaded : false,
    progress,
  };
  currentLoadState = next;
  setCurrentLoadState?.(() => next);
};

export const markGameLoaded = (): void => {
  const next = {
    loaded: true,
    progress: 100,
  };
  currentLoadState = next;
  setCurrentLoadState?.(() => next);
};

const EffectFunction = Function as unknown as new (
  ...args: string[]
) => (
  services: FlashRuntimeServices,
  effect: typeof Effect,
) => Effect.Effect<unknown, unknown, never>;

const collectFlashServices = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const auth = yield* Api.AuthApi.AuthApi;
      const bank = yield* Api.BankApi.BankApi;
      const combat = yield* Api.CombatApi.CombatApi;
      const drops = yield* Api.DropsApi.DropsApi;
      const event = yield* Api.EventApi.EventApi;
      const flash = yield* Api.FlashApi.FlashApi;
      const house = yield* Api.HouseApi.HouseApi;
      const inventory = yield* Api.InventoryApi.InventoryApi;
      const map = yield* Api.MapApi.MapApi;
      const monsters = yield* Api.MonstersApi.MonstersApi;
      const outfits = yield* Api.OutfitsApi.OutfitsApi;
      const packet = yield* Api.PacketApi.PacketApi;
      const player = yield* Api.PlayerApi.PlayerApi;
      const players = yield* Api.PlayersApi.PlayersApi;
      const quests = yield* Api.QuestsApi.QuestsApi;
      const settings = yield* Api.SettingsApi.SettingsApi;
      const shops = yield* Api.ShopsApi.ShopsApi;
      const tempInventory = yield* Api.TempInventoryApi.TempInventoryApi;
      const wait = yield* Api.WaitApi.WaitApi;

      return {
        auth,
        bank,
        combat,
        drops,
        event,
        flash,
        house,
        inventory,
        map,
        monsters,
        outfits,
        packet,
        player,
        players,
        quests,
        settings,
        shops,
        tempInventory,
        wait,
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

const runInternalEval = (source: string): Promise<unknown> =>
  collectFlashServices().then((services) => {
    const compileInternalEval = new EffectFunction(
      "services",
      "Effect",
      `"use strict";
return Effect.gen(function* debugInternalEval() {
${source}
});`,
    );

    return runtime.runPromise(compileInternalEval(services, Effect));
  });

const readCachedTravelOptions = (): Promise<TravelOptions> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const map = yield* State.MapState.MapState;
      const players = yield* State.PlayersState.PlayersState;
      const [mapCells, mapPads, currentCell, currentPad, self] =
        yield* Effect.all([
          map.getCells,
          map.getCellPads,
          map.getCurrentCell,
          map.getCurrentPad,
          players.getSelf,
        ]);

      return {
        currentCell: self?.cell || currentCell,
        currentPad: self?.pad || currentPad,
        mapCells,
        mapPads,
      };
    }),
  );

const readBridgeTravelOptions = (): Promise<TravelOptions> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const map = yield* Api.MapApi.MapApi;
      const player = yield* Api.PlayerApi.PlayerApi;
      const [mapCells, mapPads, currentCell, currentPad] = yield* Effect.all([
        map.getCells,
        map.getCellPads,
        player.getCell,
        player.getPad,
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
      const player = yield* Api.PlayerApi.PlayerApi;
      return yield* player.isReady;
    }),
  );

function DevDebugEvaluator(): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [internalSource, setInternalSource] = createSignal(
    DEFAULT_INTERNAL_DEBUG_SOURCE,
  );
  const [status, setStatus] = createSignal("Idle");
  const [output, setOutput] = createSignal("");
  const [copyableOutput, setCopyableOutput] = createSignal("");
  const [outputCopied, setOutputCopied] = createSignal(false);
  const [running, setRunning] = createSignal(false);
  const [panelFrame, setPanelFrame] = createSignal<DebugPanelFrame>(
    createInitialPanelFrame(),
  );
  let panelElement: HTMLDivElement | undefined;
  let panelResizeObserver: ResizeObserver | undefined;
  let cleanupPanelPointer: (() => void) | undefined;
  let outputCopiedTimer: number | undefined;

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

    const source = internalSource().trim();
    if (source === "") {
      setStatus("No code to evaluate");
      setOutput("");
      setCopyableOutput("");
      return;
    }

    setRunning(true);
    setStatus("Running internal eval");
    setOutput("");
    setCopyableOutput("");
    setOutputCopied(false);

    void runInternalEval(source)
      .then((value) => {
        const formattedValue = formatEvalValue(value);
        setStatus("Eval complete");
        setOutput(truncateOutput(formattedValue));
        setCopyableOutput(formattedValue);
      })
      .catch((error: unknown) => {
        const formattedError = formatEvalError(error);
        setStatus("Eval failed");
        setOutput(truncateOutput(formattedError));
        setCopyableOutput(formattedError);
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
            value={internalSource()}
            onInput={(event) => setInternalSource(event.currentTarget.value)}
          />
          <div class="game-debug-eval__footer-actions">
            <Button disabled={running()} onClick={runEval} size="sm">
              {running() ? "Running" : "Eval"}
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
              <pre class="game-debug-eval__pre">{output()}</pre>
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
  const settings = () => props.initialSettings ?? DEFAULT_APP_SETTINGS;
  const [loadState, setLoadState] =
    createSignal<GameLoadState>(currentLoadState);
  const [openMenu, setOpenMenu] = createSignal<GameTopNavMenu | null>(null);
  const [walkSpeed, setWalkSpeed] = createSignal("8");
  const [frameRate, setFrameRate] = createSignal("24");
  const [customName, setCustomName] = createSignal("");
  const [customGuild, setCustomGuild] = createSignal("");
  const [scriptUsePrivateRooms, setScriptUsePrivateRooms] = createSignal(true);
  const [scriptSafeStartStop, setScriptSafeStartStop] = createSignal(true);
  const [antiCounterEnabled, setAntiCounterEnabled] = createSignal(false);
  const [autoAttackMode, setAutoAttackMode] =
    createSignal<CombatProfileAutoAttackMode>("equipped-class");
  const [selectedAutoAttackProfileId, setSelectedAutoAttackProfileId] =
    createSignal<string | undefined>();
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
  const scriptStatus = createMemo(() => "No script loaded");
  const optionItems = createMemo<readonly TopNavOptionItem[]>(() => [
    {
      id: "infinite-range",
      label: "Infinite Range",
      checked: false,
      disabled: !gameLoaded(),
      onSelect: noop,
    },
    {
      id: "provoke-cell",
      label: "Provoke Cell",
      checked: false,
      disabled: !gameLoaded(),
      onSelect: noop,
    },
    {
      id: "enemy-magnet",
      label: "Enemy Magnet",
      checked: false,
      disabled: !gameLoaded(),
      onSelect: noop,
    },
    {
      id: "lag-killer",
      label: "Lag Killer",
      checked: false,
      disabled: !gameLoaded(),
      onSelect: noop,
    },
    {
      id: "hide-players",
      label: "Hide Players",
      checked: false,
      disabled: !gameLoaded(),
      onSelect: noop,
    },
    {
      id: "skip-cutscenes",
      label: "Skip Cutscenes",
      checked: false,
      disabled: !gameLoaded(),
      onSelect: noop,
    },
    {
      id: "anti-counter",
      label: "Anti-Counter",
      checked: antiCounterEnabled(),
      disabled: !gameLoaded(),
      onSelect: () => {
        handleToggleAntiCounter();
      },
    },
    {
      id: "animations",
      label: "Animations",
      checked: false,
      disabled: !gameLoaded(),
      onSelect: noop,
    },
    {
      id: "collisions",
      label: "Collisions",
      checked: true,
      disabled: !gameLoaded(),
      onSelect: noop,
    },
    {
      id: "death-ads",
      label: "Death Ads",
      checked: true,
      disabled: !gameLoaded(),
      onSelect: noop,
    },
  ]);

  const handleSelectAutoAttackProfile = (
    mode: CombatProfileAutoAttackMode,
    profileId?: string,
  ) => {
    setAutoAttackMode(mode);
    setSelectedAutoAttackProfileId(profileId);
  };

  const refreshAntiCounterEnabled = () => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const settings = yield* Api.SettingsApi.SettingsApi;
          return yield* settings.isAntiCounterEnabled;
        }),
      )
      .then(setAntiCounterEnabled)
      .catch((error: unknown) => {
        console.error("[game:anti-counter]", "refresh failed", error);
      });
  };

  const handleToggleAntiCounter = () => {
    const nextEnabled = !antiCounterEnabled();
    setAntiCounterEnabled(nextEnabled);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const settings = yield* Api.SettingsApi.SettingsApi;
          yield* settings.setAntiCounterEnabled(nextEnabled);
          return yield* settings.isAntiCounterEnabled;
        }),
      )
      .then(setAntiCounterEnabled)
      .catch((error: unknown) => {
        console.error("[game:anti-counter]", "toggle failed", error);
        refreshAntiCounterEnabled();
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
          return yield* autoZone.getState;
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
          const autoZone = yield* AutoZone;
          yield* autoZone.setEnabled(nextEnabled);
          return yield* autoZone.getState;
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
          const autoZone = yield* AutoZone;
          yield* autoZone.setMap(map);
          return yield* autoZone.getState;
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
          const autoRelogin = yield* AutoRelogin;
          return yield* autoRelogin.getState;
        }),
      )
      .then(applyAutoReloginState)
      .catch((error: unknown) => {
        console.error("[game:autorelogin]", "refresh failed", error);
      });
  };

  const refreshAutoReloginServers = () => {
    if (!gameLoaded()) {
      setAutoReloginServers([]);
      return;
    }

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const auth = yield* Api.AuthApi.AuthApi;
          return yield* auth.getServers;
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
          const autoRelogin = yield* AutoRelogin;
          yield* autoRelogin.setEnabled(nextEnabled);
          return yield* autoRelogin.getState;
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
          const autoRelogin = yield* AutoRelogin;
          yield* autoRelogin.setServer(server);
          return yield* autoRelogin.getState;
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
          const autoRelogin = yield* AutoRelogin;
          yield* autoRelogin.setDelay(delayMs);
          return yield* autoRelogin.getState;
        }),
      )
      .then(applyAutoReloginState)
      .catch((error: unknown) => {
        console.error("[game:autorelogin]", "set delay failed", error);
        refreshAutoReloginState();
      });
  };

  const refreshPlayerReady = () => {
    void readPlayerReady()
      .then(setPlayerReady)
      .catch((error: unknown) => {
        console.error("[game:player]", "readiness refresh failed", error);
        setPlayerReady(false);
      });
  };

  const waitForPlayerReady = (): Promise<boolean> => {
    return runtime
      .runPromise(
        Effect.gen(function* () {
          const player = yield* Api.PlayerApi.PlayerApi;
          const wait = yield* Api.WaitApi.WaitApi;
          return yield* wait.until(player.isReady, {
            timeout: PLAYER_READY_ACTION_TIMEOUT,
          });
        }),
      )
      .then((ready) => {
        setPlayerReady(ready);
        return ready;
      })
      .catch((error: unknown) => {
        console.error("[game:player]", "readiness wait failed", error);
        setPlayerReady(false);
        return false;
      });
  };

  const applyTravelOptions = ({
    currentCell,
    currentPad,
    mapCells,
    mapPads,
  }: TravelOptions) => {
    setPlayerReady(true);
    setCells(mapCells.length > 0 ? mapCells : DEFAULT_CELLS);
    setValidPads(mapPads);
    setSelectedCell(currentCell || mapCells[0] || DEFAULT_CELL);
    setSelectedPad(currentPad || DEFAULT_PAD);
  };

  const syncTravelOptionsFromState = () => {
    void waitForPlayerReady()
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
    void waitForPlayerReady()
      .then((ready) => (ready ? readCachedTravelOptions() : null))
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
    void waitForPlayerReady()
      .then((ready) => (ready ? readBridgeTravelOptions() : null))
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
          const player = yield* Api.PlayerApi.PlayerApi;
          const wait = yield* Api.WaitApi.WaitApi;
          const ready = yield* wait.until(player.isReady, {
            timeout: PLAYER_READY_ACTION_TIMEOUT,
          });
          if (!ready) {
            return null;
          }

          yield* player.jumpToCell(
            targetCell,
            targetPad === "" ? undefined : targetPad,
            true,
          );
          const [currentCell, currentPad] = yield* Effect.all([
            player.getCell,
            player.getPad,
          ]);

          return {
            currentCell,
            currentPad,
          };
        }),
      )
      .then((result) => {
        setPlayerReady(result !== null);
        if (result === null) {
          return;
        }

        const { currentCell, currentPad } = result;
        setSelectedCell(currentCell.trim() || targetCell);
        setSelectedPad(currentPad.trim() || targetPad || DEFAULT_PAD);
        refreshTravelOptionsAfterJump();
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
    setOpenMenu(null);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const player = yield* Api.PlayerApi.PlayerApi;
          const wait = yield* Api.WaitApi.WaitApi;
          const ready = yield* wait.until(player.isReady, {
            timeout: PLAYER_READY_ACTION_TIMEOUT,
          });
          if (!ready) {
            return false;
          }

          const bank = yield* Api.BankApi.BankApi;
          const isOpen = yield* bank.isOpen;
          if (!isOpen) {
            yield* bank.open();
          }

          return true;
        }),
      )
      .then(setPlayerReady)
      .catch((error: unknown) => {
        console.error("[game:bank]", "open failed", error);
        setPlayerReady(false);
      });
  };

  onMount(() => {
    let autoReloginDisposer: (() => void) | undefined;
    let autoZoneDisposer: (() => void) | undefined;
    let cleanedUp = false;

    setCurrentLoadState = (updater) => {
      currentLoadState = updater(currentLoadState);
      setLoadState(currentLoadState);
    };
    writeDocumentLoaded(loadState().loaded);
    refreshAntiCounterEnabled();

    const travelEventFiber = runtime.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const event = yield* Api.EventApi.EventApi;
          yield* event.on("mapJoined", () =>
            Effect.sync(syncTravelOptionsFromState),
          );
          yield* event.on("playerLocation", () =>
            Effect.sync(syncTravelOptionsFromState),
          );
          yield* event.on("connectionLost", () =>
            Effect.sync(() => {
              setPlayerReady(false);
              resetTravelOptions();
            }),
          );
          yield* event.on("connectionStatus", () =>
            Effect.sync(() => {
              if (currentLoadState.loaded) {
                refreshPlayerReady();
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
          const autoZone = yield* AutoZone;
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
          const autoRelogin = yield* AutoRelogin;
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

    onCleanup(() => {
      cleanedUp = true;
      autoReloginDisposer?.();
      autoZoneDisposer?.();
      if (setCurrentLoadState !== undefined) {
        setCurrentLoadState = undefined;
      }
      resetTravelOptions();
      runtime.runFork(Fiber.interrupt(travelEventFiber));
    });
  });

  createEffect(() => {
    const loaded = gameLoaded();
    writeDocumentLoaded(loaded);
    if (loaded) {
      refreshPlayerReady();
    }
  });

  return (
    <main class="game-app" data-platform={platformLabel()}>
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
        handleSetWalkSpeed={noop}
        frameRate={frameRate}
        setFrameRate={setFrameRate}
        handleSetFrameRate={noop}
        customName={customName}
        setCustomName={setCustomName}
        handleSetCustomName={noop}
        customGuild={customGuild}
        setCustomGuild={setCustomGuild}
        handleSetCustomGuild={noop}
        autoAttackEnabled={() => false}
        autoAttackProfileLabel={() => "Equipped Class"}
        autoAttackConfiguredProfileLabel={() => "Equipped Class"}
        autoAttackLastError={() => ""}
        combatProfiles={() => []}
        autoAttackMode={autoAttackMode}
        selectedAutoAttackProfileId={selectedAutoAttackProfileId}
        handleToggleAutoAttack={noop}
        handleSelectAutoAttackProfile={handleSelectAutoAttackProfile}
        scriptLoaded={() => false}
        scriptRunning={() => false}
        scriptStatus={scriptStatus}
        scriptUsePrivateRooms={scriptUsePrivateRooms}
        scriptSafeStartStop={scriptSafeStartStop}
        scriptInputsAvailable={() => false}
        loadScript={loadScriptNoop}
        toggleScript={toggleScriptNoop}
        openScriptInputs={openScriptInputsNoop}
        handleToggleScriptPrivateRooms={() =>
          setScriptUsePrivateRooms((value) => !value)
        }
        handleToggleScriptSafeStartStop={() =>
          setScriptSafeStartStop((value) => !value)
        }
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

      <Show when={LUCENT_DEV}>
        <DevDebugEvaluator />
      </Show>
    </main>
  );
}
