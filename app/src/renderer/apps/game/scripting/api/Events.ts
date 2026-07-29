import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import type { ApiService } from "../../flash/api/Api";
import type {
  Event,
  EventForType,
  EventSelector,
  EventSelectorForType,
  EventType,
} from "../../flash/contract/Event";
import type { ScriptAsyncScope } from "../scriptAsyncScope";
import {
  notifyScriptCallbackFailure,
  type ScriptCallbackResult,
} from "./Callbacks";

interface ScriptEventsOn {
  <const T extends EventType>(
    selector: EventSelectorForType<T>,
    handler: (event: EventForType<T>) => ScriptCallbackResult,
  ): Effect.Effect<() => void>;
  (
    selector: undefined,
    handler: (event: Event) => ScriptCallbackResult,
  ): Effect.Effect<() => void>;
  (
    selector: EventSelector | undefined,
    handler: (event: Event) => ScriptCallbackResult,
  ): Effect.Effect<() => void>;
}

export interface ScriptEventsApi {
  readonly on: ScriptEventsOn;
  readonly once: ApiService["events"]["once"];
  readonly stream: ApiService["events"]["stream"];
}

export const makeScriptEventsApi = (
  events: ApiService["events"],
  scope: ScriptAsyncScope,
  failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
): ScriptEventsApi => {
  const on = ((
    selector: EventSelector | undefined,
    handler: (event: Event) => ScriptCallbackResult,
  ) =>
    events
      .on(selector, notifyScriptCallbackFailure(handler, failCause))
      .pipe(
        Effect.tap((dispose) => scope.addCleanup(dispose)),
      )) as ScriptEventsOn;

  return {
    ...events,
    on,
  };
};
