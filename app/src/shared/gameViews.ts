import * as Schema from "effect/Schema";

import { ScriptFileSchema } from "@lucent/core/scriptInputs";

export const MAX_GAME_VIEWS_PER_WINDOW = 7;
export const GAME_VIEW_TAB_BAR_HEIGHT = 30;

/** Returns the transient label for an unnamed view at a tab position. */
export const gameViewFallbackName = (index: number): string =>
  `Tab ${index + 1}`;

export const GameViewLayoutSchema = Schema.Literals(["focused", "grid"]);
export const GameViewPhaseSchema = Schema.Literals([
  "preparing",
  "loading",
  "ready",
  "error",
]);

export type GameViewLayout = typeof GameViewLayoutSchema.Type;
export type GameViewPhase = typeof GameViewPhaseSchema.Type;

export const GameViewSessionSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  phase: GameViewPhaseSchema,
  error: Schema.optionalKey(Schema.String),
});

export type GameViewSession = typeof GameViewSessionSchema.Type;

export const GameViewHostStateSchema = Schema.Struct({
  capacity: Schema.Int,
  groupControlsOpen: Schema.Boolean,
  groupTargetIds: Schema.Array(Schema.String),
  layout: GameViewLayoutSchema,
  selectedId: Schema.String,
  sessions: Schema.Array(GameViewSessionSchema),
});

export type GameViewHostState = typeof GameViewHostStateSchema.Type;

/** Chooses which renderer retains native focus when a game view is selected. */
export const GameViewSelectionFocusSchema = Schema.Literals(["host", "view"]);

export type GameViewSelectionFocus = typeof GameViewSelectionFocusSchema.Type;

export const GameViewPresentationSchema = Schema.Struct({
  /** Whether this view is selected within its host window. */
  active: Schema.Boolean,
  layout: GameViewLayoutSchema,
  /** Whether the owning native window currently has focus. */
  windowActive: Schema.Boolean,
});

export type GameViewPresentation = typeof GameViewPresentationSchema.Type;

export const GameViewGroupOptionSchema = Schema.Literals([
  "animations",
  "anti-counter",
  "collisions",
  "death-ads",
  "enemy-magnet",
  "hide-players",
  "infinite-range",
  "provoke-cell",
  "skip-cutscenes",
]);

export type GameViewGroupOption = typeof GameViewGroupOptionSchema.Type;

export const GameViewGroupRenderingModeSchema = Schema.Literals([
  "full",
  "interface-only",
  "minimal",
]);

export type GameViewGroupRenderingMode =
  typeof GameViewGroupRenderingModeSchema.Type;

const StartScriptsCommandSchema = Schema.Struct({
  kind: Schema.Literal("start-scripts"),
});
const StopScriptsCommandSchema = Schema.Struct({
  kind: Schema.Literal("stop-scripts"),
});
const LoginCommandSchema = Schema.Struct({ kind: Schema.Literal("login") });
const LogoutCommandSchema = Schema.Struct({ kind: Schema.Literal("logout") });
const JoinLocationCommandSchema = Schema.Struct({
  kind: Schema.Literal("join-location"),
  map: Schema.String,
  cell: Schema.String,
  pad: Schema.String,
});
const GoToPlayerCommandSchema = Schema.Struct({
  kind: Schema.Literal("go-to-player"),
  player: Schema.String,
});
const SetOptionCommandSchema = Schema.Struct({
  kind: Schema.Literal("set-option"),
  option: GameViewGroupOptionSchema,
  enabled: Schema.Boolean,
});
const SetRenderingModeCommandSchema = Schema.Struct({
  kind: Schema.Literal("set-rendering-mode"),
  mode: GameViewGroupRenderingModeSchema,
});
const LoginCommandEnvelopeSchema = Schema.Struct({
  command: LoginCommandSchema,
  delayMs: Schema.Number,
});
const ImmediateCommandSchema = Schema.Union([
  StartScriptsCommandSchema,
  StopScriptsCommandSchema,
  Schema.Struct({
    kind: Schema.Literal("load-script"),
    file: ScriptFileSchema,
  }),
  LogoutCommandSchema,
  JoinLocationCommandSchema,
  GoToPlayerCommandSchema,
  SetRenderingModeCommandSchema,
  SetOptionCommandSchema,
]);
const ImmediateCommandEnvelopeSchema = Schema.Struct({
  command: ImmediateCommandSchema,
  delayMs: Schema.Literal(0),
});

/** Commands accepted from the grouped game host. */
export const GameViewGroupCommandRequestSchema = Schema.Union([
  StartScriptsCommandSchema,
  StopScriptsCommandSchema,
  Schema.Struct({ kind: Schema.Literal("load-script") }),
  LoginCommandSchema,
  LogoutCommandSchema,
  JoinLocationCommandSchema,
  GoToPlayerCommandSchema,
  SetRenderingModeCommandSchema,
  SetOptionCommandSchema,
]);

export type GameViewGroupCommandRequest =
  typeof GameViewGroupCommandRequestSchema.Type;

export const GameViewGroupCommandDispatchRequestSchema = Schema.Struct({
  command: GameViewGroupCommandRequestSchema,
  targetIds: Schema.Array(Schema.String),
});

export type GameViewGroupCommandDispatchRequest =
  typeof GameViewGroupCommandDispatchRequestSchema.Type;

/** Resolved command delivered to each ready game renderer. */
export const GameViewGroupCommandSchema = Schema.Union([
  ImmediateCommandSchema,
  LoginCommandSchema,
]);

export type GameViewGroupCommand = typeof GameViewGroupCommandSchema.Type;

export const GameViewGroupCommandEnvelopeSchema = Schema.Union([
  ImmediateCommandEnvelopeSchema,
  LoginCommandEnvelopeSchema,
]);

export type GameViewGroupCommandEnvelope =
  typeof GameViewGroupCommandEnvelopeSchema.Type;

export const GameViewGroupCommandDispatchResultSchema = Schema.Struct({
  recipientCount: Schema.Int,
  skippedCount: Schema.Int,
  status: Schema.Literals(["canceled", "sent"]),
});

export type GameViewGroupCommandDispatchResult =
  typeof GameViewGroupCommandDispatchResultSchema.Type;

export interface GameViewGroupTargets {
  readonly readySessions: readonly GameViewSession[];
  readonly skippedCount: number;
}

/** Returns whether a target snapshot contains unique tabs from this host. */
export const isValidGameViewGroupTargetSnapshot = (
  state: GameViewHostState,
  targetIds: readonly string[],
): boolean => {
  const uniqueIds = new Set(targetIds);
  const sessionIds = new Set(state.sessions.map((session) => session.id));
  return (
    uniqueIds.size === targetIds.length &&
    targetIds.every((id) => sessionIds.has(id))
  );
};

/** Resolves a captured group selection in host tab order. */
export const resolveGameViewGroupTargets = (
  state: GameViewHostState,
  targetIds: readonly string[],
): GameViewGroupTargets => {
  const targets = new Set(targetIds);
  const readySessions = state.sessions.filter(
    (session) => targets.has(session.id) && session.phase === "ready",
  );
  return {
    readySessions,
    skippedCount: targets.size - readySessions.length,
  };
};
