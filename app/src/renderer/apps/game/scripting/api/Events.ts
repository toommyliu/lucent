import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import type { ApiService } from "../../flash/api/Api";
import type { Event, EventSelector } from "../../flash/contract/Event";
import type { ScriptEventsApi, ScriptEventsOn } from "../ScriptApi";
import type { ScriptAsyncScope } from "../scriptAsyncScope";
import {
  notifyScriptCallbackFailure,
  type ScriptCallbackResult,
} from "./Callbacks";

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
    on,
    once: events.once,
  };
};
