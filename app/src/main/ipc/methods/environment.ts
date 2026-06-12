import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { Effect, Scope } from "effect";
import {
  addEnvironmentBoost,
  addEnvironmentItem,
  addEnvironmentQuest,
  clearEnvironmentBoosts,
  clearEnvironmentItems,
  clearEnvironmentQuestReward,
  clearEnvironmentQuests,
  clearEnvironmentState,
  isEnvironmentItemRules,
  isEnvironmentQuestAutoRegisterOptions,
  removeEnvironmentBoost,
  removeEnvironmentItem,
  removeEnvironmentQuest,
  setEnvironmentItemRules,
  setEnvironmentQuestAutoRegisterOptions,
  setEnvironmentQuestReward,
  type EnvironmentState,
} from "../../../shared/environment";
import { EnvironmentIpcChannels } from "../../../shared/ipc";
import { WindowIds } from "../../../shared/windows";
import {
  WindowManagerError,
  WindowService,
  type WindowEffectRunner,
} from "../../window/WindowService";
import {
  makeGameWindowRequestBroker,
  type GameWindowRequestBroker,
} from "../GameWindowRequestBroker";
import { MainIpc } from "../MainIpc";
import {
  getSenderGameWindowIds,
  requireGameWindowSender,
} from "../SenderAuthorization";
import {
  EnvironmentRuntimeService,
  type EnvironmentRuntimeServiceShape,
} from "../runtime/EnvironmentRuntimeService";

type EnvironmentMutation = (state: EnvironmentState) => EnvironmentState;

const FETCH_BOOSTS_TIMEOUT_MS = 3_000;

const sendChanged = (
  window: BrowserWindow | null,
  senderWindowId: number | undefined,
  state: EnvironmentState,
): void => {
  if (
    !window ||
    window.id === senderWindowId ||
    window.isDestroyed() ||
    window.webContents.isDestroyed()
  ) {
    return;
  }

  window.webContents.send(EnvironmentIpcChannels.changed, state);
};

const notifyEnvironmentChanged = (
  gameWindowId: number,
  senderWindowId: number | undefined,
  state: EnvironmentState,
): Effect.Effect<void, never, WindowService> =>
  Effect.gen(function* () {
    const windows = yield* WindowService;
    const gameWindow = yield* windows.getGameWindow(gameWindowId);
    const environmentWindow = yield* windows.getGameChildWindow(
      gameWindowId,
      WindowIds.Environment,
    );

    sendChanged(gameWindow, senderWindowId, state);
    sendChanged(environmentWindow, senderWindowId, state);
  });

const applyEnvironmentMutation = (
  event: IpcMainInvokeEvent,
  runtime: EnvironmentRuntimeServiceShape,
  mutation: EnvironmentMutation,
): Effect.Effect<EnvironmentState, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const { gameWindowId, senderWindowId } = yield* getSenderGameWindowIds(
      event.sender,
    );
    const nextState = runtime.setWindowState(
      gameWindowId,
      mutation(runtime.getWindowState(gameWindowId)),
    );

    yield* notifyEnvironmentChanged(gameWindowId, senderWindowId, nextState);
    return nextState;
  });

const fetchBoostsFromGameWindow = (
  broker: GameWindowRequestBroker<readonly string[]>,
  gameWindow: BrowserWindow,
): Promise<readonly string[]> =>
  broker.request({
    target: gameWindow,
    requestChannel: EnvironmentIpcChannels.fetchBoostsRequest,
    timeoutMs: FETCH_BOOSTS_TIMEOUT_MS,
    timeoutError: "Environment boosts did not respond",
    sendError: "Failed to fetch environment boosts",
    makeMessage: (requestId) => requestId,
    onTimeout: () => [],
  });

export const registerEnvironmentIpcHandlers = (
  runWindowEffect: WindowEffectRunner,
): Effect.Effect<
  void,
  never,
  EnvironmentRuntimeService | MainIpc | Scope.Scope
> =>
  Effect.gen(function* () {
    const ipc = yield* MainIpc;
    const runtime: EnvironmentRuntimeServiceShape =
      yield* EnvironmentRuntimeService;
    const fetchBoostsBroker = makeGameWindowRequestBroker<readonly string[]>();
    const run = <A>(
      effect: Effect.Effect<A, WindowManagerError, WindowService>,
    ) => Effect.promise(() => runWindowEffect(effect));

    yield* ipc.on(
      EnvironmentIpcChannels.fetchBoostsResponse,
      (event, requestId, boosts) =>
        run(
          Effect.gen(function* () {
            yield* requireGameWindowSender(event.sender);
            if (typeof requestId !== "string") {
              return;
            }

            fetchBoostsBroker.resolve(
              requestId,
              Array.isArray(boosts) ? boosts.filter(isString) : [],
            );
          }),
        ),
    );

    yield* ipc.handle(EnvironmentIpcChannels.getState, (event) =>
      run(
        Effect.gen(function* () {
          const { gameWindowId } = yield* getSenderGameWindowIds(event.sender);
          return runtime.getWindowState(gameWindowId);
        }),
      ),
    );

    yield* ipc.handle(EnvironmentIpcChannels.clear, (event) =>
      run(applyEnvironmentMutation(event, runtime, clearEnvironmentState)),
    );

    yield* ipc.handle(
      EnvironmentIpcChannels.addQuest,
      (event, questId, rewardItemId) =>
        run(
          applyEnvironmentMutation(event, runtime, (state) =>
            addEnvironmentQuest(
              state,
              toQuestToken(questId),
              toOptionalQuestToken(rewardItemId),
            ),
          ),
        ),
    );

    yield* ipc.handle(EnvironmentIpcChannels.removeQuest, (event, questId) =>
      run(
        applyEnvironmentMutation(event, runtime, (state) =>
          removeEnvironmentQuest(state, toQuestToken(questId)),
        ),
      ),
    );

    yield* ipc.handle(
      EnvironmentIpcChannels.setQuestReward,
      (event, questId, rewardItemId) =>
        run(
          applyEnvironmentMutation(event, runtime, (state) =>
            setEnvironmentQuestReward(
              state,
              toQuestToken(questId),
              toQuestToken(rewardItemId),
            ),
          ),
        ),
    );

    yield* ipc.handle(
      EnvironmentIpcChannels.clearQuestReward,
      (event, questId) =>
        run(
          applyEnvironmentMutation(event, runtime, (state) =>
            clearEnvironmentQuestReward(state, toQuestToken(questId)),
          ),
        ),
    );

    yield* ipc.handle(EnvironmentIpcChannels.clearQuests, (event) =>
      run(applyEnvironmentMutation(event, runtime, clearEnvironmentQuests)),
    );

    yield* ipc.handle(
      EnvironmentIpcChannels.setQuestAutoRegister,
      (event, options) =>
        run(
          applyEnvironmentMutation(event, runtime, (state) =>
            setEnvironmentQuestAutoRegisterOptions(
              state,
              isEnvironmentQuestAutoRegisterOptions(options)
                ? options
                : state.questAutoRegister,
            ),
          ),
        ),
    );

    yield* ipc.handle(EnvironmentIpcChannels.addItem, (event, name) =>
      run(
        applyEnvironmentMutation(event, runtime, (state) =>
          addEnvironmentItem(state, String(name ?? "")),
        ),
      ),
    );

    yield* ipc.handle(EnvironmentIpcChannels.removeItem, (event, name) =>
      run(
        applyEnvironmentMutation(event, runtime, (state) =>
          removeEnvironmentItem(state, String(name ?? "")),
        ),
      ),
    );

    yield* ipc.handle(EnvironmentIpcChannels.setItemRules, (event, rules) =>
      run(
        applyEnvironmentMutation(event, runtime, (state) =>
          setEnvironmentItemRules(
            state,
            isEnvironmentItemRules(rules) ? rules : state.itemRules,
          ),
        ),
      ),
    );

    yield* ipc.handle(EnvironmentIpcChannels.clearItems, (event) =>
      run(applyEnvironmentMutation(event, runtime, clearEnvironmentItems)),
    );

    yield* ipc.handle(EnvironmentIpcChannels.addBoost, (event, name) =>
      run(
        applyEnvironmentMutation(event, runtime, (state) =>
          addEnvironmentBoost(state, String(name ?? "")),
        ),
      ),
    );

    yield* ipc.handle(EnvironmentIpcChannels.removeBoost, (event, name) =>
      run(
        applyEnvironmentMutation(event, runtime, (state) =>
          removeEnvironmentBoost(state, String(name ?? "")),
        ),
      ),
    );

    yield* ipc.handle(EnvironmentIpcChannels.clearBoosts, (event) =>
      run(applyEnvironmentMutation(event, runtime, clearEnvironmentBoosts)),
    );

    yield* ipc.handle(EnvironmentIpcChannels.fetchBoosts, (event) =>
      run(
        Effect.gen(function* () {
          const { gameWindowId } = yield* getSenderGameWindowIds(event.sender);
          const windows = yield* WindowService;
          const gameWindow = yield* windows.getGameWindow(gameWindowId);
          if (!gameWindow) {
            return [];
          }

          return yield* Effect.tryPromise({
            try: () => fetchBoostsFromGameWindow(fetchBoostsBroker, gameWindow),
            catch: (cause) =>
              new WindowManagerError({
                message: "Failed to fetch environment boosts",
                cause,
              }),
          });
        }),
      ),
    );

    yield* ipc.handle(EnvironmentIpcChannels.syncToAll, (event) =>
      run(
        Effect.gen(function* () {
          const { gameWindowId: sourceGameWindowId, senderWindowId } =
            yield* getSenderGameWindowIds(event.sender);
          const state = runtime.getWindowState(sourceGameWindowId);
          const windows = yield* WindowService;
          const gameWindowIds = yield* windows.getGameWindowIds();

          for (const gameWindowId of gameWindowIds) {
            runtime.setWindowState(gameWindowId, state);
            yield* notifyEnvironmentChanged(
              gameWindowId,
              senderWindowId,
              state,
            );
          }

          return state;
        }),
      ),
    );

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        fetchBoostsBroker.rejectAll(new Error("Environment IPC scope closed"));
      }),
    );
  });

const isString = (value: unknown): value is string => typeof value === "string";

const toQuestToken = (value: unknown): number | string =>
  typeof value === "number" || typeof value === "string" ? value : "";

const toOptionalQuestToken = (value: unknown): number | string | undefined =>
  typeof value === "number" || typeof value === "string" ? value : undefined;
