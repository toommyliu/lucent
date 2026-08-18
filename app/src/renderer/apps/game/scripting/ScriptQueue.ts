import type {
  ScriptFile,
  ScriptFileReference,
  ScriptInputValues,
  ScriptInputsDefinition,
} from "@lucent/core/scriptInputs";
import type {
  ScriptQueueDefinition,
  ScriptQueueEntry,
} from "@lucent/core/scriptQueues";

import type {
  ScriptRunId,
  ScriptRunnerStatus,
  ScriptRunTerminalOutcome,
} from "./ScriptRunner";
import { validateScriptInputValues } from "@lucent/core/scriptInputs";
import { scriptQueueTerminalDecision } from "./scriptQueuePolicy";

export type ScriptQueuePhase =
  | "idle"
  | "paused"
  | "preparing"
  | "running"
  | "stopping";

export type ScriptQueueRunStatus =
  | "canceled"
  | "completed"
  | "exited"
  | "failed"
  | "paused"
  | "running"
  | "stopped";

export interface ScriptQueueRunItem {
  readonly entry: ScriptQueueEntry;
  readonly file: ScriptFile;
  readonly inputValues: ScriptInputValues;
  readonly result?: ScriptRunTerminalOutcome;
  readonly runId?: ScriptRunId;
  readonly startedAt?: string;
  readonly durationMs?: number;
  readonly state: "active" | "finished" | "pending";
}

export interface ScriptQueueRun {
  readonly finishedAt?: string;
  readonly id: string;
  readonly items: readonly ScriptQueueRunItem[];
  readonly startedAt: string;
  readonly status: ScriptQueueRunStatus;
}

export interface ScriptQueueState {
  readonly attentionEntryId?: string | undefined;
  readonly currentIndex: number | null;
  readonly definition: ScriptQueueDefinition;
  readonly error?: string | undefined;
  readonly latestRun: ScriptQueueRun | null;
  readonly phase: ScriptQueuePhase;
}

export type ScriptQueueInputReason = "add" | "edit" | "preflight";

export interface ScriptQueueInputRequest {
  readonly definition: ScriptInputsDefinition;
  readonly entryId?: string;
  readonly file: ScriptFile;
  readonly reason: ScriptQueueInputReason;
  readonly signal: AbortSignal;
  readonly values: ScriptInputValues;
}

export interface ScriptQueueSession {
  readonly id: ScriptRunId;
  readonly initialStatus: ScriptRunnerStatus;
  readonly terminal: Promise<ScriptRunTerminalOutcome>;
}

export interface ScriptQueueDependencies {
  readonly confirmStandaloneReplacement: (
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly createId: (prefix: string) => string;
  readonly isRunnerActive: () => Promise<boolean>;
  readonly now?: () => number;
  readonly onUnexpectedError: (cause: unknown) => void;
  readonly requestInputs: (
    request: ScriptQueueInputRequest,
  ) => Promise<ScriptInputValues | null>;
  readonly resolve: (reference: ScriptFileReference) => Promise<ScriptFile>;
  readonly startScript: (
    file: ScriptFile,
    inputValues: ScriptInputValues,
  ) => Promise<ScriptQueueSession>;
  readonly stopScript: (reason: string) => Promise<void>;
}

export interface ScriptQueue {
  readonly add: (
    file: ScriptFile,
    inputValues: ScriptInputValues,
  ) => Promise<string | null>;
  readonly cancel: (reason?: string) => Promise<void>;
  readonly dispose: () => void;
  readonly editInputs: (entryId: string) => Promise<boolean>;
  readonly getState: () => ScriptQueueState;
  readonly move: (entryId: string, offset: -1 | 1) => void;
  readonly onState: (listener: (state: ScriptQueueState) => void) => () => void;
  readonly remove: (entryId: string) => void;
  readonly runNext: () => void;
  readonly start: () => Promise<boolean>;
}

class ScriptQueuePreparationError extends Error {
  readonly entryId?: string | undefined;

  constructor(message: string, entryId?: string) {
    super(message);
    this.name = "ScriptQueuePreparationError";
    this.entryId = entryId;
  }
}

const errorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error && cause.message.trim() !== ""
    ? cause.message
    : fallback;

const snapshotEntry = (entry: ScriptQueueEntry): ScriptQueueEntry => ({
  file: {
    ...entry.file,
    ...(entry.file.reference === undefined
      ? {}
      : { reference: { ...entry.file.reference } }),
  },
  id: entry.id,
  inputDefinitionId: entry.inputDefinitionId,
  inputValues: { ...entry.inputValues },
  revision: entry.revision,
});

const fileReference = (file: ScriptFile): ScriptFileReference => ({
  name: file.name,
  path: file.path,
  ...(file.reference === undefined ? {} : { reference: { ...file.reference } }),
});

const deepFreeze = <Value>(value: Value): Value => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
};

const frozenFileSnapshot = (file: ScriptFile): ScriptFile =>
  deepFreeze(structuredClone(file));

const withRunId = (
  item: ScriptQueueRunItem,
  runId: ScriptRunId,
): ScriptQueueRunItem => ({ ...item, runId });

const queueEntryFor = (
  id: string,
  file: ScriptFile,
  inputValues: ScriptInputValues,
): ScriptQueueEntry => ({
  file: fileReference(file),
  id,
  inputDefinitionId: file.inputs?.id ?? null,
  inputValues: { ...inputValues },
  revision: file.revision,
});

const terminalRunStatus = (
  outcome: ScriptRunTerminalOutcome,
): Exclude<ScriptQueueRunStatus, "canceled" | "paused" | "running"> => {
  switch (outcome.kind) {
    case "completed":
    case "script-stopped":
      return "completed";
    case "failed":
      return "failed";
    case "externally-stopped":
      return "stopped";
    case "script-exited":
      return "exited";
  }
};

export const makeScriptQueue = (
  dependencies: ScriptQueueDependencies,
): ScriptQueue => {
  const now = dependencies.now ?? Date.now;
  const listeners = new Set<(state: ScriptQueueState) => void>();
  let state: ScriptQueueState = {
    currentIndex: null,
    definition: { entries: [] },
    latestRun: null,
    phase: "idle",
  };
  let draftController: AbortController | null = null;
  let preparationId = 0;
  let preparationController: AbortController | null = null;
  let runVersion = 0;
  let activeSettlement: Promise<void> | null = null;
  let disposed = false;

  const getState = (): ScriptQueueState => state;

  const emit = (next: ScriptQueueState): void => {
    state = next;
    if (disposed) return;
    for (const listener of listeners) listener(state);
  };

  const patchState = (patch: Partial<ScriptQueueState>): void => {
    emit({ ...state, ...patch });
  };

  const replaceEntry = (entry: ScriptQueueEntry): void => {
    patchState({
      definition: {
        entries: state.definition.entries.map((current) =>
          current.id === entry.id ? snapshotEntry(entry) : current,
        ),
      },
    });
  };

  const requestValidatedInputs = async (
    file: ScriptFile,
    values: ScriptInputValues,
    reason: ScriptQueueInputReason,
    signal: AbortSignal,
    entryId?: string,
  ): Promise<ScriptInputValues | null> => {
    const definition = file.inputs;
    if (definition === null) return {};

    const validation = validateScriptInputValues(definition, values);
    if (reason !== "edit" && validation.status === "ok") {
      return validation.values;
    }

    const edited = await dependencies.requestInputs({
      definition,
      ...(entryId === undefined ? {} : { entryId }),
      file,
      reason,
      signal,
      values: validation.values,
    });
    if (edited === null || signal.aborted) return null;

    const result = validateScriptInputValues(definition, edited);
    if (result.status === "missing-required") {
      throw new ScriptQueuePreparationError(
        "Required script inputs are still missing.",
        entryId,
      );
    }
    return result.values;
  };

  const add: ScriptQueue["add"] = async (file, inputValues) => {
    if (state.phase !== "idle" || draftController !== null) return null;
    const controller = new AbortController();
    draftController = controller;
    try {
      const values = await requestValidatedInputs(
        file,
        inputValues,
        "add",
        controller.signal,
      );
      if (
        values === null ||
        controller.signal.aborted ||
        draftController !== controller ||
        state.phase !== "idle"
      ) {
        return null;
      }

      const id = dependencies.createId("queue");
      const entry = queueEntryFor(id, file, values);
      patchState({
        attentionEntryId: undefined,
        definition: {
          entries: [...state.definition.entries, entry],
        },
        error: undefined,
      });
      return id;
    } finally {
      if (draftController === controller) draftController = null;
    }
  };

  const editInputs: ScriptQueue["editInputs"] = async (entryId) => {
    if (state.phase !== "idle" || draftController !== null) return false;
    const entry = state.definition.entries.find(
      (candidate) => candidate.id === entryId,
    );
    if (entry === undefined) return false;

    const controller = new AbortController();
    draftController = controller;
    try {
      const file = await dependencies.resolve(entry.file);
      if (
        controller.signal.aborted ||
        draftController !== controller ||
        state.phase !== "idle"
      ) {
        return false;
      }
      const values = await requestValidatedInputs(
        file,
        entry.inputValues,
        "edit",
        controller.signal,
        entry.id,
      );
      if (
        values === null ||
        controller.signal.aborted ||
        draftController !== controller ||
        state.phase !== "idle"
      ) {
        return false;
      }

      replaceEntry(queueEntryFor(entry.id, file, values));
      patchState({ attentionEntryId: undefined, error: undefined });
      return true;
    } catch (cause) {
      if (
        !controller.signal.aborted &&
        draftController === controller &&
        state.phase === "idle"
      ) {
        patchState({
          attentionEntryId: entry.id,
          error: errorMessage(cause, `Failed to configure ${entry.file.name}.`),
        });
      }
      return false;
    } finally {
      if (draftController === controller) draftController = null;
    }
  };

  const finishRun = (
    version: number,
    status: Exclude<ScriptQueueRunStatus, "paused" | "running">,
  ): void => {
    if (version !== runVersion || state.latestRun === null) return;
    patchState({
      currentIndex: null,
      latestRun: {
        ...state.latestRun,
        finishedAt: new Date(now()).toISOString(),
        status,
      },
      phase: "idle",
    });
  };

  const applyTerminalOutcome = (
    version: number,
    index: number,
    outcome: ScriptRunTerminalOutcome,
    startedAtMs: number,
  ): void => {
    const run = state.latestRun;
    if (version !== runVersion || run === null) return;
    const items = run.items.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            durationMs: Math.max(0, now() - startedAtMs),
            result: outcome,
            state: "finished" as const,
          }
        : item,
    );
    patchState({ latestRun: { ...run, items } });
  };

  const unexpectedFailure = (
    item: ScriptQueueRunItem,
    cause: unknown,
  ): ScriptRunTerminalOutcome => ({
    kind: "failed",
    status: {
      failedAt: new Date(now()).toISOString(),
      message: errorMessage(cause, "Unexpected queue failure"),
      name: item.file.name,
      path: item.file.path,
      state: "failed",
    },
  });

  const runItem = async (version: number, index: number): Promise<void> => {
    const run = state.latestRun;
    const item = run?.items[index];
    if (
      version !== runVersion ||
      run === null ||
      item === undefined ||
      state.phase !== "running"
    ) {
      return;
    }

    const startedAtMs = now();
    const activeItem: ScriptQueueRunItem = {
      ...item,
      startedAt: new Date(startedAtMs).toISOString(),
      state: "active",
    };
    patchState({
      currentIndex: index,
      latestRun: {
        ...run,
        items: run.items.map((current, itemIndex) =>
          itemIndex === index ? activeItem : current,
        ),
      },
    });

    let outcome: ScriptRunTerminalOutcome;
    try {
      const session = await dependencies.startScript(
        item.file,
        item.inputValues,
      );
      const currentRun = state.latestRun;
      if (version === runVersion && currentRun !== null) {
        patchState({
          latestRun: {
            ...currentRun,
            items: currentRun.items.map((current, itemIndex) =>
              itemIndex === index ? withRunId(current, session.id) : current,
            ),
          },
        });
      }
      outcome = await session.terminal;
    } catch (cause) {
      dependencies.onUnexpectedError(cause);
      outcome = unexpectedFailure(item, cause);
    }

    if (version !== runVersion || state.latestRun === null) return;
    applyTerminalOutcome(version, index, outcome, startedAtMs);
    const currentRun = state.latestRun;
    if (currentRun === null) return;

    if (
      (state as ScriptQueueState).phase === "stopping" ||
      currentRun.status === "canceled"
    ) {
      finishRun(version, "canceled");
      return;
    }

    const hasNext = index + 1 < currentRun.items.length;
    switch (scriptQueueTerminalDecision(outcome, hasNext)) {
      case "advance":
        launchItem(version, index + 1);
        return;
      case "pause":
        patchState({
          latestRun: { ...state.latestRun!, status: "paused" },
          phase: "paused",
        });
        return;
      case "finish":
        finishRun(version, terminalRunStatus(outcome));
    }
  };

  const launchItem = (version: number, index: number): void => {
    const settlement = runItem(version, index);
    activeSettlement = settlement;
    void settlement.finally(() => {
      if (activeSettlement === settlement) activeSettlement = null;
    });
  };

  const preparationIsCurrent = (
    id: number,
    controller: AbortController,
  ): boolean =>
    !disposed &&
    state.phase === "preparing" &&
    preparationId === id &&
    preparationController === controller &&
    !controller.signal.aborted;

  const abandonPreparation = (
    id: number,
    controller: AbortController,
    error?: string,
    attentionEntryId?: string,
  ): void => {
    if (!preparationIsCurrent(id, controller)) return;
    preparationController = null;
    patchState({
      ...(attentionEntryId === undefined ? {} : { attentionEntryId }),
      currentIndex: null,
      ...(error === undefined ? {} : { error }),
      phase: "idle",
    });
  };

  const start: ScriptQueue["start"] = async () => {
    if (state.phase !== "idle" || draftController !== null) return false;
    if (state.definition.entries.length === 0) {
      patchState({
        error: "Add at least one script before starting the queue.",
      });
      return false;
    }

    const id = ++preparationId;
    const controller = new AbortController();
    preparationController = controller;
    patchState({
      attentionEntryId: undefined,
      currentIndex: null,
      error: undefined,
      phase: "preparing",
    });
    const entries = state.definition.entries.map(snapshotEntry);

    try {
      const resolvedFiles = await Promise.all(
        entries.map(async (entry) => {
          try {
            return await dependencies.resolve(entry.file);
          } catch (cause) {
            throw new ScriptQueuePreparationError(
              errorMessage(cause, `Failed to resolve ${entry.file.name}.`),
              entry.id,
            );
          }
        }),
      );
      if (!preparationIsCurrent(id, controller)) return false;

      const items: ScriptQueueRunItem[] = [];
      for (const [index, entry] of entries.entries()) {
        const file = resolvedFiles[index];
        if (file === undefined) continue;
        const values = await requestValidatedInputs(
          file,
          entry.inputValues,
          "preflight",
          controller.signal,
          entry.id,
        );
        if (!preparationIsCurrent(id, controller)) return false;
        if (values === null) {
          abandonPreparation(id, controller, undefined, entry.id);
          return false;
        }

        const configuredEntry = queueEntryFor(entry.id, file, values);
        replaceEntry(configuredEntry);
        items.push({
          entry: snapshotEntry(configuredEntry),
          file: frozenFileSnapshot(file),
          inputValues: deepFreeze({ ...values }),
          state: "pending",
        });
      }

      if (await dependencies.isRunnerActive()) {
        if (!preparationIsCurrent(id, controller)) return false;
        const confirmed = await dependencies.confirmStandaloneReplacement(
          controller.signal,
        );
        if (!preparationIsCurrent(id, controller)) return false;
        if (!confirmed) {
          abandonPreparation(id, controller);
          return false;
        }
        if (await dependencies.isRunnerActive()) {
          await dependencies.stopScript("Replaced by script queue");
        }
      }
      if (!preparationIsCurrent(id, controller)) return false;

      preparationController = null;
      const startedAt = new Date(now()).toISOString();
      const version = ++runVersion;
      patchState({
        attentionEntryId: undefined,
        currentIndex: 0,
        error: undefined,
        latestRun: {
          id: dependencies.createId("queue-run"),
          items,
          startedAt,
          status: "running",
        },
        phase: "running",
      });
      launchItem(version, 0);
      return true;
    } catch (cause) {
      if (!preparationIsCurrent(id, controller)) return false;
      const preparationError =
        cause instanceof ScriptQueuePreparationError ? cause : undefined;
      abandonPreparation(
        id,
        controller,
        errorMessage(cause, "Failed to prepare the script queue."),
        preparationError?.entryId,
      );
      return false;
    }
  };

  const cancel: ScriptQueue["cancel"] = async (reason = "Queue canceled") => {
    if (state.phase === "idle") return;
    if (state.phase === "preparing") {
      preparationController?.abort();
      preparationController = null;
      preparationId += 1;
      patchState({ currentIndex: null, phase: "idle" });
      return;
    }

    if (state.phase === "paused") {
      const run = state.latestRun;
      if (run !== null) {
        patchState({
          currentIndex: null,
          latestRun: {
            ...run,
            finishedAt: new Date(now()).toISOString(),
            status: "canceled",
          },
          phase: "idle",
        });
      }
      return;
    }
    if (state.phase === "stopping") {
      if (activeSettlement !== null) await activeSettlement;
      return;
    }

    const run = state.latestRun;
    patchState({
      ...(run === null
        ? {}
        : { latestRun: { ...run, status: "canceled" as const } }),
      phase: "stopping",
    });
    await dependencies.stopScript(reason);
    if (activeSettlement !== null) await activeSettlement;
  };

  const runNext = (): void => {
    const run = state.latestRun;
    const currentIndex = state.currentIndex;
    if (
      state.phase !== "paused" ||
      run === null ||
      currentIndex === null ||
      currentIndex + 1 >= run.items.length
    ) {
      return;
    }
    patchState({
      currentIndex: currentIndex + 1,
      latestRun: { ...run, status: "running" },
      phase: "running",
    });
    launchItem(runVersion, currentIndex + 1);
  };

  return {
    add,
    cancel,
    dispose: () => {
      if (disposed) return;
      draftController?.abort();
      preparationController?.abort();
      listeners.clear();
      void cancel("Renderer closed");
      disposed = true;
    },
    editInputs,
    getState,
    move: (entryId, offset) => {
      if (state.phase !== "idle") return;
      const entries = [...state.definition.entries];
      const index = entries.findIndex((entry) => entry.id === entryId);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= entries.length) return;
      const [entry] = entries.splice(index, 1);
      if (entry === undefined) return;
      entries.splice(nextIndex, 0, entry);
      patchState({ definition: { entries } });
    },
    onState: (listener) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    remove: (entryId) => {
      if (state.phase !== "idle") return;
      const removesAttention = state.attentionEntryId === entryId;
      patchState({
        attentionEntryId: removesAttention ? undefined : state.attentionEntryId,
        definition: {
          entries: state.definition.entries.filter(
            (entry) => entry.id !== entryId,
          ),
        },
        ...(removesAttention ? { error: undefined } : {}),
      });
    },
    runNext,
    start,
  };
};
