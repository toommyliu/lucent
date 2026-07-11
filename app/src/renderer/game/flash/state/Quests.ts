import type { LiveQuest } from "@lucent/game";

export interface QuestsState {
  readonly accepted: Set<number>;
  readonly quests: Map<number, LiveQuest>;
}

export const makeQuestsState = (): QuestsState => ({
  accepted: new Set(),
  quests: new Map(),
});
