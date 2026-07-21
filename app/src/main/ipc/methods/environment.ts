import {
  addEnvironmentBoost,
  addEnvironmentBoosts,
  addEnvironmentItem,
  addEnvironmentItems,
  addEnvironmentQuest,
  addEnvironmentQuests,
  clearEnvironmentBoosts,
  clearEnvironmentItems,
  clearEnvironmentQuestReward,
  clearEnvironmentQuests,
  clearEnvironmentState,
  removeEnvironmentBoost,
  removeEnvironmentItem,
  removeEnvironmentQuest,
  setEnvironmentAutomationEnabled,
  setEnvironmentItemNotification,
  setEnvironmentItemRules,
  setEnvironmentQuestAutoRegisterOptions,
  setEnvironmentQuestReward,
  type EnvironmentState,
} from "@lucent/core/environment";
import { Effect, Schema } from "effect";

import { EnvironmentIpc } from "../../../shared/ipc";
import { GameEnvironments } from "../../internal/environment/GameEnvironments";
import { DesktopWindows } from "../../window/DesktopWindows";
import { DesktopIpc, makeDesktopIpcMethod } from "../DesktopIpc";
import type { DesktopIpcSender } from "../DesktopIpcSenders";

export class EnvironmentOwnerError extends Schema.TaggedErrorClass<EnvironmentOwnerError>()(
  "EnvironmentOwnerError",
  {
    browserWindowId: Schema.Int,
  },
) {
  override get message(): string {
    return `Environment IPC sender has no owning game: ${this.browserWindowId}`;
  }
}

const allowedSenders = ["game", "environment"] as const;

const resolveGameBrowserWindowId = Effect.fn(
  "desktop.ipc.environment.resolveGame",
)(function* (sender: DesktopIpcSender) {
  if (sender.kind === "game") {
    return sender.browserWindowId;
  }

  const windows = yield* DesktopWindows;
  const ownerBrowserWindowId = yield* windows.getOwnerBrowserWindowId(
    sender.browserWindowId,
  );
  if (ownerBrowserWindowId === null) {
    return yield* new EnvironmentOwnerError({
      browserWindowId: sender.browserWindowId,
    });
  }

  const ownerKind = yield* windows.getBrowserWindowKind(ownerBrowserWindowId);
  if (ownerKind !== "game") {
    return yield* new EnvironmentOwnerError({
      browserWindowId: sender.browserWindowId,
    });
  }

  return ownerBrowserWindowId;
});

const notifyChanged = Effect.fn("desktop.ipc.environment.notifyChanged")(
  function* (
    gameBrowserWindowId: number,
    state: EnvironmentState,
    excludedBrowserWindowId: number,
  ) {
    const ipc = yield* DesktopIpc;
    const windows = yield* DesktopWindows;
    const environmentWindowIds = yield* windows.getOwnedBrowserWindowIds(
      gameBrowserWindowId,
      "environment",
    );
    const targets = [gameBrowserWindowId, ...environmentWindowIds].filter(
      (browserWindowId) => browserWindowId !== excludedBrowserWindowId,
    );
    yield* ipc.sendToBrowserWindowIds(targets, EnvironmentIpc.changed, state);
  },
);

const mutate = (
  sender: DesktopIpcSender,
  reducer: (state: EnvironmentState) => EnvironmentState,
) =>
  Effect.gen(function* () {
    const environments = yield* GameEnvironments;
    const gameBrowserWindowId = yield* resolveGameBrowserWindowId(sender);
    const state = yield* environments.update(gameBrowserWindowId, reducer);
    yield* notifyChanged(gameBrowserWindowId, state, sender.browserWindowId);
    return state;
  });

export const getState = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.getState,
  allowedSenders,
  handler: Effect.fn("desktop.ipc.environment.getState")(
    function* (_payload, sender) {
      const environments = yield* GameEnvironments;
      const gameBrowserWindowId = yield* resolveGameBrowserWindowId(sender);
      return yield* environments.get(gameBrowserWindowId);
    },
  ),
});

export const clear = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.clear,
  allowedSenders,
  handler: (_payload, sender) => mutate(sender, clearEnvironmentState),
});

export const addQuest = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.addQuest,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) =>
      addEnvironmentQuest(state, payload.questId, payload.rewardItemId),
    ),
});

export const addQuests = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.addQuests,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) => addEnvironmentQuests(state, payload.quests)),
});

export const removeQuest = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.removeQuest,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) => removeEnvironmentQuest(state, payload.questId)),
});

export const setQuestReward = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.setQuestReward,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) =>
      setEnvironmentQuestReward(state, payload.questId, payload.rewardItemId),
    ),
});

export const clearQuestReward = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.clearQuestReward,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) =>
      clearEnvironmentQuestReward(state, payload.questId),
    ),
});

export const clearQuests = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.clearQuests,
  allowedSenders,
  handler: (_payload, sender) => mutate(sender, clearEnvironmentQuests),
});

export const setQuestAutoRegister = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.setQuestAutoRegister,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) =>
      setEnvironmentQuestAutoRegisterOptions(state, payload),
    ),
});

export const setAutomationEnabled = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.setAutomationEnabled,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) =>
      setEnvironmentAutomationEnabled(
        state,
        payload.capability,
        payload.enabled,
      ),
    ),
});

export const addItem = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.addItem,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) => addEnvironmentItem(state, payload.name)),
});

export const addItems = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.addItems,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) => addEnvironmentItems(state, payload.names)),
});

export const removeItem = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.removeItem,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) => removeEnvironmentItem(state, payload.name)),
});

export const setItemRules = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.setItemRules,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) => setEnvironmentItemRules(state, payload)),
});

export const setItemNotification = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.setItemNotification,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) =>
      setEnvironmentItemNotification(state, payload.name, payload.enabled),
    ),
});

export const clearItems = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.clearItems,
  allowedSenders,
  handler: (_payload, sender) => mutate(sender, clearEnvironmentItems),
});

export const addBoost = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.addBoost,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) => addEnvironmentBoost(state, payload.name)),
});

export const addBoosts = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.addBoosts,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) => addEnvironmentBoosts(state, payload.names)),
});

export const removeBoost = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.removeBoost,
  allowedSenders,
  handler: (payload, sender) =>
    mutate(sender, (state) => removeEnvironmentBoost(state, payload.name)),
});

export const clearBoosts = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.clearBoosts,
  allowedSenders,
  handler: (_payload, sender) => mutate(sender, clearEnvironmentBoosts),
});

export const fetchBoosts = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.fetchBoosts,
  allowedSenders,
  handler: Effect.fn("desktop.ipc.environment.fetchBoosts")(
    function* (_payload, sender) {
      const environments = yield* GameEnvironments;
      const gameBrowserWindowId = yield* resolveGameBrowserWindowId(sender);
      return yield* environments.fetchBoosts(gameBrowserWindowId);
    },
  ),
});

export const fetchBoostsResponse = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.fetchBoostsResponse,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.environment.fetchBoostsResponse")(
    function* (payload, sender) {
      const environments = yield* GameEnvironments;
      yield* environments.respondToBoostFetch(
        sender.browserWindowId,
        payload.requestId,
        payload.discovery,
      );
    },
  ),
});

export const withdrawBoosts = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.withdrawBoosts,
  allowedSenders,
  handler: Effect.fn("desktop.ipc.environment.withdrawBoosts")(
    function* (payload, sender) {
      const environments = yield* GameEnvironments;
      const gameBrowserWindowId = yield* resolveGameBrowserWindowId(sender);
      return yield* environments.withdrawBoosts(
        gameBrowserWindowId,
        payload.itemIds,
      );
    },
  ),
});

export const withdrawBoostsResponse = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.withdrawBoostsResponse,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.environment.withdrawBoostsResponse")(
    function* (payload, sender) {
      const environments = yield* GameEnvironments;
      yield* environments.respondToBoostWithdrawal(
        sender.browserWindowId,
        payload.requestId,
        payload.itemIds,
      );
    },
  ),
});

export const syncToAll = makeDesktopIpcMethod({
  descriptor: EnvironmentIpc.syncToAll,
  allowedSenders,
  handler: Effect.fn("desktop.ipc.environment.syncToAll")(
    function* (_payload, sender) {
      const environments = yield* GameEnvironments;
      const windows = yield* DesktopWindows;
      const sourceGameBrowserWindowId =
        yield* resolveGameBrowserWindowId(sender);
      const state = yield* environments.get(sourceGameBrowserWindowId);
      const gameBrowserWindowIds = yield* windows.getBrowserWindowIds("game");

      for (const gameBrowserWindowId of gameBrowserWindowIds) {
        const copiedState = yield* environments.set(gameBrowserWindowId, state);
        yield* notifyChanged(
          gameBrowserWindowId,
          copiedState,
          sender.browserWindowId,
        );
      }

      return state;
    },
  ),
});

export const methods = [
  getState,
  clear,
  addQuest,
  addQuests,
  removeQuest,
  setQuestReward,
  clearQuestReward,
  clearQuests,
  setQuestAutoRegister,
  setAutomationEnabled,
  addItem,
  addItems,
  removeItem,
  setItemRules,
  setItemNotification,
  clearItems,
  addBoost,
  addBoosts,
  removeBoost,
  clearBoosts,
  fetchBoosts,
  fetchBoostsResponse,
  withdrawBoosts,
  withdrawBoostsResponse,
  syncToAll,
] as const;
