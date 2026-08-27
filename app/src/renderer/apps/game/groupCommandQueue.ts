import type {
  GameViewGroupCommand,
  GameViewGroupCommandEnvelope,
} from "../../../shared/gameViews";

type GroupCommandLaneName = "account" | "scripts" | "settings" | "travel";

interface GroupCommandQueueEntry {
  readonly coalesceKey?: string;
  readonly envelope: GameViewGroupCommandEnvelope;
}

interface GroupCommandLane {
  readonly dispose: () => void;
  readonly enqueue: (entry: GroupCommandQueueEntry) => void;
  readonly latest: () => GroupCommandQueueEntry | undefined;
  readonly replaceLastPending: (
    coalesceKey: string,
    entry: GroupCommandQueueEntry,
  ) => boolean;
  readonly whenIdle: () => Promise<void>;
}

export interface GameViewGroupCommandQueueOptions {
  readonly execute: (command: GameViewGroupCommand) => Promise<void>;
  readonly onError?: (command: GameViewGroupCommand, cause: unknown) => void;
  readonly wait?: (delayMs: number) => Promise<void>;
}

export interface GameViewGroupCommandQueue {
  /** Accepts a command without waiting for the selected action to finish. */
  readonly enqueue: (envelope: GameViewGroupCommandEnvelope) => void;
  readonly dispose: () => void;
  /** Resolves after every command accepted so far has finished. */
  readonly whenIdle: () => Promise<void>;
}

const defaultWait = (delayMs: number): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));

const commandLaneName = (
  command: GameViewGroupCommand,
): GroupCommandLaneName => {
  switch (command.kind) {
    case "load-script":
    case "start-scripts":
    case "stop-scripts":
      return "scripts";
    case "run-option-hotkey":
      return "settings";
    case "login":
    case "logout":
      return "account";
    case "go-to-player":
    case "join-location":
      return "travel";
    case "set-option":
    case "set-rendering-mode":
      return "settings";
  }
};

const commandCoalesceKey = (
  command: GameViewGroupCommand,
): string | undefined => {
  switch (command.kind) {
    case "set-option":
      return `option:${command.option}`;
    case "set-rendering-mode":
      return "rendering-mode";
    default:
      return undefined;
  }
};

const makeGroupCommandLane = (
  options: GameViewGroupCommandQueueOptions,
): GroupCommandLane => {
  const pending: GroupCommandQueueEntry[] = [];
  const idleResolvers: Array<() => void> = [];
  const wait = options.wait ?? defaultWait;
  let active: GroupCommandQueueEntry | undefined;
  let disposed = false;
  let running = false;

  const resolveIdle = (): void => {
    if (running || pending.length > 0) return;
    for (const resolve of idleResolvers.splice(0)) resolve();
  };

  const drain = async (): Promise<void> => {
    if (running || disposed) return;
    running = true;
    try {
      while (pending.length > 0) {
        const entry = pending.shift();
        if (entry === undefined) break;
        active = entry;
        try {
          if (entry.envelope.delayMs > 0) {
            await wait(entry.envelope.delayMs);
          }
          if (!disposed) await options.execute(entry.envelope.command);
        } catch (cause) {
          try {
            options.onError?.(entry.envelope.command, cause);
          } catch {}
        } finally {
          active = undefined;
        }
      }
    } finally {
      running = false;
      resolveIdle();
    }
  };

  return {
    dispose: () => {
      disposed = true;
      pending.splice(0);
      resolveIdle();
    },
    enqueue: (entry) => {
      if (disposed) return;
      pending.push(entry);
      void drain();
    },
    latest: () => pending.at(-1) ?? active,
    replaceLastPending: (coalesceKey, entry) => {
      const lastIndex = pending.length - 1;
      if (lastIndex < 0 || pending[lastIndex]?.coalesceKey !== coalesceKey) {
        return false;
      }
      pending[lastIndex] = entry;
      return true;
    },
    whenIdle: () =>
      !running && pending.length === 0
        ? Promise.resolve()
        : new Promise((resolve) => idleResolvers.push(resolve)),
  };
};

/** Serializes dependent group commands while leaving unrelated lanes independent. */
export const makeGameViewGroupCommandQueue = (
  options: GameViewGroupCommandQueueOptions,
): GameViewGroupCommandQueue => {
  const lanes: Readonly<Record<GroupCommandLaneName, GroupCommandLane>> = {
    account: makeGroupCommandLane(options),
    scripts: makeGroupCommandLane(options),
    settings: makeGroupCommandLane(options),
    travel: makeGroupCommandLane(options),
  };
  let disposed = false;

  return {
    dispose: () => {
      disposed = true;
      for (const lane of Object.values(lanes)) lane.dispose();
    },
    enqueue: (envelope) => {
      if (disposed) return;
      const lane = lanes[commandLaneName(envelope.command)];
      const coalesceKey = commandCoalesceKey(envelope.command);
      const entry: GroupCommandQueueEntry = {
        ...(coalesceKey === undefined ? {} : { coalesceKey }),
        envelope,
      };

      if (
        (envelope.command.kind === "login" ||
          envelope.command.kind === "logout") &&
        lane.latest()?.envelope.command.kind === envelope.command.kind
      ) {
        return;
      }
      if (
        coalesceKey !== undefined &&
        lane.replaceLastPending(coalesceKey, entry)
      ) {
        return;
      }
      lane.enqueue(entry);
    },
    whenIdle: () =>
      Promise.all(Object.values(lanes).map((lane) => lane.whenIdle())).then(
        () => undefined,
      ),
  };
};
