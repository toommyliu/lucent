export const projectionKeys = [
  "houseInventory",
  "inventory",
  "map",
  "player",
] as const;

export type ProjectionKey = (typeof projectionKeys)[number];

export interface ProjectionState {
  readonly completed: Record<ProjectionKey, boolean>;
  readonly failures: Partial<Record<ProjectionKey, string>>;
  epoch: number;
}

const emptyCompletion = (): Record<ProjectionKey, boolean> => ({
  houseInventory: false,
  inventory: false,
  map: false,
  player: false,
});

export const makeProjectionState = (): ProjectionState => ({
  completed: emptyCompletion(),
  epoch: 0,
  failures: {},
});

export const completeProjection = (
  state: ProjectionState,
  key: ProjectionKey,
): void => {
  state.completed[key] = true;
  delete state.failures[key];
};

export const failProjection = (
  state: ProjectionState,
  key: ProjectionKey,
  reason: string,
): void => {
  state.completed[key] = false;
  state.failures[key] = reason;
};

export const resetProjections = (state: ProjectionState): void => {
  state.epoch += 1;
  Object.assign(state.completed, emptyCompletion());
  for (const key of projectionKeys) delete state.failures[key];
};
