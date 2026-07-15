import { Cause, Effect } from "effect";

import type { ApiService } from "../../flash/api/Api";
import type { Event, EventSelector } from "../../flash/contract/Event";
import type { ScriptAsyncScope } from "../scriptAsyncScope";
import {
  notifyScriptCallbackFailure,
  type ScriptCallbackResult,
} from "./Callbacks";

export interface ScriptEventsApi {
  readonly on: (
    selector: EventSelector | undefined,
    handler: (event: Event) => ScriptCallbackResult,
  ) => Effect.Effect<() => void>;
  readonly once: ApiService["events"]["once"];
  readonly stream: ApiService["events"]["stream"];
}

export const makeScriptEventsApi = (
  events: ApiService["events"],
  scope: ScriptAsyncScope,
  failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
): ScriptEventsApi => ({
  ...events,
  on: (selector, handler) =>
    events
      .on(selector, notifyScriptCallbackFailure<Event>(handler, failCause))
      .pipe(Effect.tap((dispose) => scope.addCleanup(dispose))),
});
