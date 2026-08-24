import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as ExitRuntime from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

import type { DesktopTraceSpan } from "../../shared/ipc";
import { DesktopObservability } from "./DesktopObservability";

type TraceEvent = readonly [
  name: string,
  startTime: bigint,
  attributes: Record<string, unknown>,
];

const traceExit = (
  exit: Exit.Exit<unknown, unknown>,
): DesktopTraceSpan["exit"] => {
  if (ExitRuntime.isSuccess(exit)) {
    return { _tag: "Success" };
  }
  const cause = Cause.pretty(exit.cause);
  return Cause.hasInterruptsOnly(exit.cause)
    ? { _tag: "Interrupted", cause }
    : { _tag: "Failure", cause };
};

class DesktopEffectSpan implements Tracer.Span {
  readonly _tag = "Span";
  readonly name: string;
  readonly spanId: string;
  readonly traceId: string;
  readonly parent: Option.Option<Tracer.AnySpan>;
  readonly annotations: Tracer.Span["annotations"];
  readonly links: Array<Tracer.SpanLink>;
  readonly sampled: boolean;
  readonly kind: Tracer.SpanKind;

  status: Tracer.SpanStatus;
  attributes = new Map<string, unknown>();
  events: TraceEvent[] = [];

  constructor(
    options: Parameters<Tracer.Tracer["span"]>[0],
    private readonly delegate: Tracer.Span,
    private readonly record: (span: DesktopTraceSpan) => void,
  ) {
    this.name = delegate.name;
    this.spanId = delegate.spanId;
    this.traceId = delegate.traceId;
    this.parent = options.parent;
    this.annotations = options.annotations;
    this.links = [...options.links];
    this.sampled = delegate.sampled;
    this.kind = delegate.kind;
    this.status = { _tag: "Started", startTime: options.startTime };
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    const startTime = this.status.startTime;
    this.status = { _tag: "Ended", endTime, exit, startTime };
    this.delegate.end(endTime, exit);

    if (!this.sampled) {
      return;
    }
    try {
      this.record({
        attributes: Object.fromEntries(this.attributes),
        durationMs: Number(endTime - startTime) / 1_000_000,
        endTimeUnixNano: endTime.toString(),
        events: this.events.map(([name, time, attributes]) => ({
          attributes,
          name,
          timeUnixNano: time.toString(),
        })),
        exit: traceExit(exit),
        kind: this.kind,
        links: this.links.map((link) => ({
          attributes: link.attributes,
          spanId: link.span.spanId,
          traceId: link.span.traceId,
        })),
        name: this.name,
        ...(Option.isNone(this.parent)
          ? {}
          : { parentSpanId: this.parent.value.spanId }),
        sampled: this.sampled,
        source: "effect",
        spanId: this.spanId,
        startTimeUnixNano: startTime.toString(),
        traceId: this.traceId,
      });
    } catch {}
  }

  attribute(key: string, value: unknown): void {
    this.attributes.set(key, value);
    this.delegate.attribute(key, value);
  }

  event(
    name: string,
    startTime: bigint,
    attributes: Record<string, unknown> = {},
  ): void {
    this.events.push([name, startTime, attributes]);
    this.delegate.event(name, startTime, attributes);
  }

  addLinks(links: ReadonlyArray<Tracer.SpanLink>): void {
    this.links.push(...links);
    this.delegate.addLinks(links);
  }
}

const makeDesktopEffectTracer = Effect.gen(function* () {
  const observability = yield* DesktopObservability;
  const delegate = Tracer.make({
    span: (options) => new Tracer.NativeSpan(options),
  });

  return Tracer.make({
    span: (options) =>
      new DesktopEffectSpan(options, delegate.span(options), (span) =>
        observability.recordUnsafe({
          component: "trace",
          event: "span.completed",
          data: span,
        }),
      ),
  });
});

export const layer = Layer.effect(Tracer.Tracer, makeDesktopEffectTracer);
