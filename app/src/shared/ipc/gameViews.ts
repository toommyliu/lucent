import * as Schema from "effect/Schema";

import {
  GameViewGroupCommandDispatchResultSchema,
  GameViewGroupCommandDispatchRequestSchema,
  GameViewGroupCommandEnvelopeSchema,
  GameViewHostStateSchema,
  GameViewLayoutSchema,
  GameViewPresentationSchema,
  GameViewSelectionFocusSchema,
} from "../gameViews";
import { defineEvent, defineInvoke } from "./core";

const namespace = "desktop:game-views";
const SessionIdPayloadSchema = Schema.Struct({ id: Schema.String });

export const GameViewsIpc = {
  getState: defineInvoke({
    channel: `${namespace}:get-state`,
    name: "gameViews.getState",
    payload: Schema.Void,
    result: GameViewHostStateSchema,
  }),
  add: defineInvoke({
    channel: `${namespace}:add`,
    name: "gameViews.add",
    payload: Schema.Void,
    result: GameViewHostStateSchema,
  }),
  select: defineInvoke({
    channel: `${namespace}:select`,
    name: "gameViews.select",
    payload: Schema.Struct({
      id: Schema.String,
      focus: GameViewSelectionFocusSchema,
    }),
    result: GameViewHostStateSchema,
  }),
  close: defineInvoke({
    channel: `${namespace}:close`,
    name: "gameViews.close",
    payload: SessionIdPayloadSchema,
    result: Schema.Void,
  }),
  reorder: defineInvoke({
    channel: `${namespace}:reorder`,
    name: "gameViews.reorder",
    payload: Schema.Struct({ ids: Schema.Array(Schema.String) }),
    result: GameViewHostStateSchema,
  }),
  setLayout: defineInvoke({
    channel: `${namespace}:set-layout`,
    name: "gameViews.setLayout",
    payload: Schema.Struct({ layout: GameViewLayoutSchema }),
    result: GameViewHostStateSchema,
  }),
  setGroupTargets: defineInvoke({
    channel: `${namespace}:set-group-targets`,
    name: "gameViews.setGroupTargets",
    payload: Schema.Struct({ ids: Schema.Array(Schema.String) }),
    result: GameViewHostStateSchema,
  }),
  setGroupControlsOpen: defineInvoke({
    channel: `${namespace}:set-group-controls-open`,
    name: "gameViews.setGroupControlsOpen",
    payload: Schema.Struct({ open: Schema.Boolean }),
    result: GameViewHostStateSchema,
  }),
  setTabMenuOpen: defineInvoke({
    channel: `${namespace}:set-tab-menu-open`,
    name: "gameViews.setTabMenuOpen",
    payload: Schema.Struct({ open: Schema.Boolean }),
    result: Schema.Boolean,
  }),
  dispatchGroupCommand: defineInvoke({
    channel: `${namespace}:dispatch-group-command`,
    name: "gameViews.dispatchGroupCommand",
    payload: GameViewGroupCommandDispatchRequestSchema,
    result: GameViewGroupCommandDispatchResultSchema,
  }),
  getPresentation: defineInvoke({
    channel: `${namespace}:get-presentation`,
    name: "gameViews.getPresentation",
    payload: Schema.Void,
    result: GameViewPresentationSchema,
  }),
  activate: defineInvoke({
    channel: `${namespace}:activate`,
    name: "gameViews.activate",
    payload: Schema.Void,
    result: GameViewPresentationSchema,
  }),
  changed: defineEvent({
    channel: `${namespace}:changed`,
    name: "gameViews.changed",
    payload: GameViewHostStateSchema,
  }),
  presentationChanged: defineEvent({
    channel: `${namespace}:presentation-changed`,
    name: "gameViews.presentationChanged",
    payload: GameViewPresentationSchema,
  }),
  shortcutModifierChanged: defineEvent({
    channel: `${namespace}:shortcut-modifier-changed`,
    name: "gameViews.shortcutModifierChanged",
    payload: Schema.Boolean,
  }),
  tabMenuOpenChanged: defineEvent({
    channel: `${namespace}:tab-menu-open-changed`,
    name: "gameViews.tabMenuOpenChanged",
    payload: Schema.Boolean,
  }),
  groupCommand: defineEvent({
    channel: `${namespace}:group-command`,
    name: "gameViews.groupCommand",
    payload: GameViewGroupCommandEnvelopeSchema,
  }),
} as const;
