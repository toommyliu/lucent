import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { DesktopEnvironment } from "./DesktopEnvironment";
import {
  DesktopObservability,
  layer as desktopObservabilityLayer,
} from "./DesktopObservability";

describe("DesktopObservability", () => {
  it.effect("owns the desktop log file path", () =>
    Effect.gen(function* () {
      const appDataDir = "/internal/Lucent";
      const environment = DesktopEnvironment.of({
        appDataDir,
        assetsDir: "/assets",
        isDev: true,
        platform: "darwin",
        workspaceDir: "/workspace",
      });
      const observability = yield* DesktopObservability.pipe(
        Effect.provide(
          desktopObservabilityLayer.pipe(
            Layer.provide(Layer.succeed(DesktopEnvironment, environment)),
          ),
        ),
      );

      expect(observability.logFilePath).toBe(
        join(appDataDir, "logs", "lucent.log"),
      );
    }),
  );
});
