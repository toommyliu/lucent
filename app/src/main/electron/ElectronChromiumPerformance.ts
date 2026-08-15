import {
  contentTracing,
  webContents,
  type TraceConfig,
  type WebContents,
} from "electron";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export interface ElectronChromiumRendererTarget {
  readonly rendererId: number;
  readonly osProcessId: number;
}

export interface ElectronMainHeapUsage {
  readonly externalBytes: number;
  readonly heapTotalBytes: number;
  readonly heapUsedBytes: number;
  readonly rssBytes: number;
}

export interface ElectronRendererHeapUsage {
  readonly totalSizeBytes: number;
  readonly usedSizeBytes: number;
}

export class ElectronChromiumPerformanceError extends Schema.TaggedErrorClass<ElectronChromiumPerformanceError>()(
  "ElectronChromiumPerformanceError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Electron Chromium performance operation failed: ${this.operation}.`;
  }
}

export interface ElectronChromiumPerformanceShape {
  readonly getCategories: Effect.Effect<
    readonly string[],
    ElectronChromiumPerformanceError
  >;
  readonly getMainHeapUsage: Effect.Effect<ElectronMainHeapUsage>;
  readonly getRendererHeapUsage: (
    rendererId: number,
  ) => Effect.Effect<
    ElectronRendererHeapUsage,
    ElectronChromiumPerformanceError
  >;
  readonly getRendererTargets: Effect.Effect<
    readonly ElectronChromiumRendererTarget[]
  >;
  readonly releaseRendererDebuggers: Effect.Effect<void>;
  readonly startRecording: (
    config: TraceConfig,
  ) => Effect.Effect<void, ElectronChromiumPerformanceError>;
  readonly stopRecording: (
    filePath: string,
  ) => Effect.Effect<string, ElectronChromiumPerformanceError>;
  readonly takeMainHeapSnapshot: (
    filePath: string,
  ) => Effect.Effect<void, ElectronChromiumPerformanceError>;
  readonly takeRendererHeapSnapshot: (
    rendererId: number,
    filePath: string,
  ) => Effect.Effect<void, ElectronChromiumPerformanceError>;
}

export class ElectronChromiumPerformance extends Context.Service<
  ElectronChromiumPerformance,
  ElectronChromiumPerformanceShape
>()("lucent/desktop/electron/ElectronChromiumPerformance") {}

const rendererWebContents = (rendererId: number): WebContents => {
  const renderer = webContents.fromId(rendererId);
  if (renderer === undefined || renderer.isDestroyed()) {
    throw new Error(`Electron renderer is not available: ${rendererId}`);
  }
  return renderer;
};

const finiteNumberProperty = (
  value: unknown,
  property: string,
): number | null => {
  if (typeof value !== "object" || value === null || !(property in value)) {
    return null;
  }

  const propertyValue = Reflect.get(value, property);
  return typeof propertyValue === "number" && Number.isFinite(propertyValue)
    ? propertyValue
    : null;
};

/** Validates the untyped Chrome DevTools Protocol heap-usage response. */
export const decodeElectronRendererHeapUsage = (
  value: unknown,
): ElectronRendererHeapUsage | null => {
  const usedSizeBytes = finiteNumberProperty(value, "usedSize");
  const totalSizeBytes = finiteNumberProperty(value, "totalSize");
  return usedSizeBytes === null || totalSizeBytes === null
    ? null
    : { totalSizeBytes, usedSizeBytes };
};

const makeElectronChromiumPerformance = Effect.gen(function* () {
  const attachedRendererDebuggers = new Set<number>();
  const rendererHeapUsageRequests = new Map<
    number,
    Promise<ElectronRendererHeapUsage>
  >();
  const requestRendererHeapUsage = (
    rendererId: number,
  ): Promise<ElectronRendererHeapUsage> => {
    const pendingRequest = rendererHeapUsageRequests.get(rendererId);
    if (pendingRequest !== undefined) {
      return pendingRequest;
    }

    const request = (async () => {
      const renderer = rendererWebContents(rendererId);
      const rendererDebugger = renderer.debugger;

      if (
        attachedRendererDebuggers.has(rendererId) &&
        !rendererDebugger.isAttached()
      ) {
        attachedRendererDebuggers.delete(rendererId);
      }

      if (!attachedRendererDebuggers.has(rendererId)) {
        if (renderer.isDevToolsOpened() || rendererDebugger.isAttached()) {
          throw new Error(
            `Electron renderer debugger is already in use: ${rendererId}`,
          );
        }
        rendererDebugger.attach("1.3");
        attachedRendererDebuggers.add(rendererId);
      }

      const response: unknown = await rendererDebugger.sendCommand(
        "Runtime.getHeapUsage",
      );
      const usage = decodeElectronRendererHeapUsage(response);
      if (usage === null) {
        throw new Error("Invalid Runtime.getHeapUsage response.");
      }
      return usage;
    })().finally(() => {
      if (rendererHeapUsageRequests.get(rendererId) === request) {
        rendererHeapUsageRequests.delete(rendererId);
      }
    });
    rendererHeapUsageRequests.set(rendererId, request);
    return request;
  };

  const releaseRendererDebuggers: Effect.Effect<void> = Effect.sync(() => {
    rendererHeapUsageRequests.clear();
    for (const rendererId of attachedRendererDebuggers) {
      const renderer = webContents.fromId(rendererId);
      if (
        renderer !== undefined &&
        !renderer.isDestroyed() &&
        renderer.debugger.isAttached()
      ) {
        try {
          renderer.debugger.detach();
        } catch {
          // The renderer may disappear between the lifecycle checks and detach.
        }
      }
    }
    attachedRendererDebuggers.clear();
  });

  const getRendererHeapUsage: ElectronChromiumPerformanceShape["getRendererHeapUsage"] =
    (rendererId) =>
      Effect.tryPromise({
        try: () => requestRendererHeapUsage(rendererId),
        catch: (cause) =>
          new ElectronChromiumPerformanceError({
            cause,
            operation: `get-renderer-heap-usage:${rendererId}`,
          }),
      });

  yield* Effect.addFinalizer(() => releaseRendererDebuggers);

  return ElectronChromiumPerformance.of({
    getCategories: Effect.tryPromise({
      try: () => contentTracing.getCategories(),
      catch: (cause) =>
        new ElectronChromiumPerformanceError({
          cause,
          operation: "get-categories",
        }),
    }),
    getMainHeapUsage: Effect.sync(() => {
      const usage = process.memoryUsage();
      return {
        externalBytes: usage.external,
        heapTotalBytes: usage.heapTotal,
        heapUsedBytes: usage.heapUsed,
        rssBytes: usage.rss,
      };
    }),
    getRendererHeapUsage,
    getRendererTargets: Effect.sync(() =>
      webContents.getAllWebContents().flatMap((renderer) => {
        if (renderer.isDestroyed()) {
          return [];
        }
        return [
          {
            rendererId: renderer.id,
            osProcessId: renderer.getOSProcessId(),
          },
        ];
      }),
    ),
    releaseRendererDebuggers,
    startRecording: (config) =>
      Effect.tryPromise({
        try: () => contentTracing.startRecording(config),
        catch: (cause) =>
          new ElectronChromiumPerformanceError({
            cause,
            operation: "start-recording",
          }),
      }),
    stopRecording: (filePath) =>
      Effect.tryPromise({
        try: () => contentTracing.stopRecording(filePath),
        catch: (cause) =>
          new ElectronChromiumPerformanceError({
            cause,
            operation: "stop-recording",
          }),
      }),
    takeMainHeapSnapshot: (filePath) =>
      Effect.try({
        try: () => {
          if (!process.takeHeapSnapshot(filePath)) {
            throw new Error("Electron did not create the main heap snapshot.");
          }
        },
        catch: (cause) =>
          new ElectronChromiumPerformanceError({
            cause,
            operation: "take-main-heap-snapshot",
          }),
      }),
    takeRendererHeapSnapshot: (rendererId, filePath) =>
      Effect.tryPromise({
        try: () => rendererWebContents(rendererId).takeHeapSnapshot(filePath),
        catch: (cause) =>
          new ElectronChromiumPerformanceError({
            cause,
            operation: `take-renderer-heap-snapshot:${rendererId}`,
          }),
      }),
  });
});

export const layer = Layer.effect(
  ElectronChromiumPerformance,
  makeElectronChromiumPerformance,
);
