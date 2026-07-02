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
import * as Api from "./flash";
import type { FlashSettingsPatch, FlashSettingsSnapshot } from "./flash";
import { flashRuntime as runtime } from "./flash";
import {
  AutoRelogin,
  type AutoReloginState,
} from "./flash/features/AutoRelogin";
import {
  AutoZone,
  type AutoZoneState,
  type AutoZoneSupportedMap,
} from "./flash/features/AutoZone";
import {
  TopNav,
  type CombatProfileAutoAttackMode,
  type GameTopNavMenu,
  type TopNavOptionItem,
} from "./TopNav";

declare const LUCENT_DEV: boolean;

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

const DEBUG_EVAL_OUTPUT_LIMIT = 2000;
const DEBUG_PANEL_MARGIN_PX = 12;
const DEBUG_PANEL_MIN_WIDTH_PX = 320;
const DEBUG_PANEL_MIN_HEIGHT_PX = 220;
const DEBUG_PANEL_DEFAULT_WIDTH_PX = 432;
const DEBUG_PANEL_DEFAULT_HEIGHT_PX = 360;

const DEFAULT_INTERNAL_DEBUG_SOURCE = `return yield* services.player.getCell;`;
const AUTO_RELOGIN_DEFAULT_DELAY_SECONDS = "3";
const PLAYER_READY_RETRY_INTERVAL_MS = 250;
const PLAYER_READY_RETRY_TIMEOUT_MS = 10_000;
const DEFAULT_FLASH_SETTINGS: FlashSettingsSnapshot = {
  animationsEnabled: true,
  antiCounterEnabled: true,
  collisionsEnabled: true,
  customGuild: "",
  customName: "",
  deathAdsVisible: true,
  enemyMagnetEnabled: false,
  frameRate: 30,
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

const writeDocumentLoaded = (loaded: boolean): void => {
  document.documentElement.dataset["loaded"] = loaded ? "true" : "false";
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
      const events = yield* Api.EventsApi.EventsApi;
      const house = yield* Api.HouseApi.HouseApi;
      const inventory = yield* Api.InventoryApi.InventoryApi;
      const map = yield* Api.MapApi.MapApi;
      const monsters = yield* Api.MonstersApi.MonstersApi;
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
        events,
        house,
        inventory,
        map,
        monsters,
        outfits: player.outfits,
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

const parseFiniteNumber = (value: string): number | null => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
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
  const [loadState, setLoadState] = createSignal<GameLoadState>({
    loaded: false,
    progress: 0,
  });
  const [openMenu, setOpenMenu] = createSignal<GameTopNavMenu | null>(null);
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
  const [scriptUsePrivateRooms, setScriptUsePrivateRooms] = createSignal(true);
  const [scriptSafeStartStop, setScriptSafeStartStop] = createSignal(true);
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
  let playerReadyRefreshVersion = 0;
  let playerReadyRetryTimer: number | undefined;
  let playerReadyRetryToken = 0;
  const scriptStatus = createMemo(() => "No script loaded");
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
  };

  const applyFlashSettingsState = (state: FlashSettingsSnapshot) => {
    setFlashSettings(state);
    setWalkSpeed(String(state.walkSpeed));
    setFrameRate(String(state.frameRate));
    setCustomName(state.customName);
    setCustomGuild(state.customGuild);
  };

  const patchFlashSettingsState = (patch: FlashSettingsPatch) => {
    setFlashSettings((state) => ({
      ...state,
      ...patch,
    }));
  };

  const refreshFlashSettings = () => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const settings = yield* Api.SettingsApi.SettingsApi;
          return yield* settings.get;
        }),
      )
      .then(applyFlashSettingsState)
      .catch((error: unknown) => {
        console.error("[game:settings]", "refresh failed", error);
      });
  };

  const runSettingsUpdate = (
    label: string,
    optimisticPatch: FlashSettingsPatch,
    update: (settings: Api.SettingsApi.SettingsApiShape) => Effect.Effect<void>,
  ) => {
    patchFlashSettingsState(optimisticPatch);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const settings = yield* Api.SettingsApi.SettingsApi;
          yield* update(settings);
          return yield* settings.get;
        }),
      )
      .then(applyFlashSettingsState)
      .catch((error: unknown) => {
        console.error("[game:settings]", `${label} failed`, error);
        refreshFlashSettings();
      });
  };

  const toggleFlashSetting = (
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
    update: (
      settings: Api.SettingsApi.SettingsApiShape,
      enabled: boolean,
    ) => Effect.Effect<void>,
  ) => {
    const enabled = !flashSettings()[key];
    runSettingsUpdate(
      label,
      { [key]: enabled } as FlashSettingsPatch,
      (settings) => update(settings, enabled),
    );
  };

  const handleToggleHidePlayers = () => {
    const visible = flashSettings().otherPlayersVisible;
    runSettingsUpdate(
      "hide players",
      { otherPlayersVisible: !visible },
      (settings) => settings.setOtherPlayersVisible(!visible),
    );
  };

  const handleSetWalkSpeed = () => {
    const speed = parseFiniteNumber(walkSpeed());
    if (speed === null) {
      refreshFlashSettings();
      return;
    }

    runSettingsUpdate("set walk speed", { walkSpeed: speed }, (settings) =>
      settings.setWalkSpeed(speed),
    );
  };

  const handleSetFrameRate = () => {
    const fps = parseFiniteNumber(frameRate());
    if (fps === null) {
      refreshFlashSettings();
      return;
    }

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

  const optionsDisabled = () => !gameLoaded() || !playerReady();

  const optionItems = createMemo<readonly TopNavOptionItem[]>(() => [
    {
      id: "infinite-range",
      label: "Infinite Range",
      checked: flashSettings().infiniteRangeEnabled,
      disabled: optionsDisabled(),
      onSelect: () =>
        toggleFlashSetting(
          "toggle infinite range",
          "infiniteRangeEnabled",
          (settings, enabled) => settings.setInfiniteRangeEnabled(enabled),
        ),
    },
    {
      id: "provoke-cell",
      label: "Provoke Cell",
      checked: flashSettings().provokeCellEnabled,
      disabled: optionsDisabled(),
      onSelect: () =>
        toggleFlashSetting(
          "toggle provoke cell",
          "provokeCellEnabled",
          (settings, enabled) => settings.setProvokeCellEnabled(enabled),
        ),
    },
    {
      id: "enemy-magnet",
      label: "Enemy Magnet",
      checked: flashSettings().enemyMagnetEnabled,
      disabled: optionsDisabled(),
      onSelect: () =>
        toggleFlashSetting(
          "toggle enemy magnet",
          "enemyMagnetEnabled",
          (settings, enabled) => settings.setEnemyMagnetEnabled(enabled),
        ),
    },
    {
      id: "lag-killer",
      label: "Lag Killer",
      checked: flashSettings().lagKillerEnabled,
      disabled: optionsDisabled(),
      onSelect: () =>
        toggleFlashSetting(
          "toggle lag killer",
          "lagKillerEnabled",
          (settings, enabled) => settings.setLagKillerEnabled(enabled),
        ),
    },
    {
      id: "hide-players",
      label: "Hide Players",
      checked: !flashSettings().otherPlayersVisible,
      disabled: optionsDisabled(),
      onSelect: handleToggleHidePlayers,
    },
    {
      id: "skip-cutscenes",
      label: "Skip Cutscenes",
      checked: flashSettings().skipCutscenesEnabled,
      disabled: optionsDisabled(),
      onSelect: () =>
        toggleFlashSetting(
          "toggle skip cutscenes",
          "skipCutscenesEnabled",
          (settings, enabled) => settings.setSkipCutscenesEnabled(enabled),
        ),
    },
    {
      id: "anti-counter",
      label: "Anti-Counter",
      checked: flashSettings().antiCounterEnabled,
      disabled: optionsDisabled(),
      onSelect: () =>
        toggleFlashSetting(
          "toggle anti-counter",
          "antiCounterEnabled",
          (settings, enabled) => settings.setAntiCounterEnabled(enabled),
        ),
    },
    {
      id: "animations",
      label: "Animations",
      checked: flashSettings().animationsEnabled,
      disabled: optionsDisabled(),
      onSelect: () =>
        toggleFlashSetting(
          "toggle animations",
          "animationsEnabled",
          (settings, enabled) => settings.setAnimationsEnabled(enabled),
        ),
    },
    {
      id: "collisions",
      label: "Collisions",
      checked: flashSettings().collisionsEnabled,
      disabled: optionsDisabled(),
      onSelect: () =>
        toggleFlashSetting(
          "toggle collisions",
          "collisionsEnabled",
          (settings, enabled) => settings.setCollisionsEnabled(enabled),
        ),
    },
    {
      id: "death-ads",
      label: "Death Ads",
      checked: flashSettings().deathAdsVisible,
      disabled: optionsDisabled(),
      onSelect: () =>
        toggleFlashSetting(
          "toggle death ads",
          "deathAdsVisible",
          (settings, enabled) => settings.setDeathAdsVisible(enabled),
        ),
    },
  ]);

  const handleSelectAutoAttackProfile = (
    mode: CombatProfileAutoAttackMode,
    profileId?: string,
  ) => {
    setAutoAttackMode(mode);
    setSelectedAutoAttackProfileId(profileId);
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

  const refreshPlayerReady = (): Promise<boolean> => {
    const version = ++playerReadyRefreshVersion;
    return readPlayerReady()
      .then((ready) => {
        if (version === playerReadyRefreshVersion) {
          setPlayerReady(ready);
        }
        return ready;
      })
      .catch((error: unknown) => {
        console.error("[game:player]", "readiness refresh failed", error);
        if (version === playerReadyRefreshVersion) {
          setPlayerReady(false);
        }
        return false;
      });
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

      void refreshPlayerReady().then(() => {
        if (token !== playerReadyRetryToken || !gameLoaded()) {
          return;
        }

        if (playerReady()) {
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
          const player = yield* Api.PlayerApi.PlayerApi;
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

  const handleOpenBank = () => {
    if (!playerReady()) {
      return;
    }

    setOpenMenu(null);

    void runtime
      .runPromise(
        Effect.gen(function* () {
          const bank = yield* Api.BankApi.BankApi;
          yield* bank.open();
        }),
      )
      .catch((error: unknown) => {
        console.error("[game:bank]", "open failed", error);
        schedulePlayerReadyRefresh({ retry: true });
      });
  };

  onMount(() => {
    let autoReloginDisposer: (() => void) | undefined;
    let autoZoneDisposer: (() => void) | undefined;
    let flashSettingsDisposer: (() => void) | undefined;
    let cleanedUp = false;

    const travelEventFiber = runtime.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const events = yield* Api.EventsApi.EventsApi;
          yield* events.on({ type: "progress" }, (event) =>
            Effect.sync(() => {
              if (event.type === "progress") {
                setLoadProgress(event.payload.percent);
              }
            }),
          );
          yield* events.on({ type: "loaded" }, () => Effect.sync(markLoaded));
          yield* events.on({ type: "joinMap" }, () =>
            Effect.sync(() =>
              schedulePlayerReadyRefresh({
                onReady: syncTravelOptionsFromState,
                retry: true,
              }),
            ),
          );
          yield* events.on({ type: "playerLocation" }, () =>
            Effect.sync(() =>
              schedulePlayerReadyRefresh({
                onReady: syncTravelOptionsFromState,
                retry: true,
              }),
            ),
          );
          yield* events.on({ type: "connection" }, (event) =>
            Effect.sync(() => {
              const status =
                event.type === "connection" ? event.payload.status : "";
              if (
                status === "OnConnectionLost" ||
                status === "OnConnectionFailed"
              ) {
                stopPlayerReadyRetry();
                setPlayerReady(false);
                resetTravelOptions();
              }

              if (status === "OnConnection") {
                schedulePlayerReadyRefresh({ retry: true });
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
          const settings = yield* Api.SettingsApi.SettingsApi;
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
      flashSettingsDisposer?.();
      stopPlayerReadyRetry();
      resetTravelOptions();
      runtime.runFork(Fiber.interrupt(travelEventFiber));
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
        handleSetWalkSpeed={handleSetWalkSpeed}
        frameRate={frameRate}
        setFrameRate={setFrameRate}
        handleSetFrameRate={handleSetFrameRate}
        customName={customName}
        setCustomName={setCustomName}
        handleSetCustomName={handleSetCustomName}
        customGuild={customGuild}
        setCustomGuild={setCustomGuild}
        handleSetCustomGuild={handleSetCustomGuild}
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
