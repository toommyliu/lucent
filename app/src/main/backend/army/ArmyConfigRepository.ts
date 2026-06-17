import { Data, Effect, Layer, ServiceMap } from "effect";
import {
  assertValidArmyConfigName,
  normalizeArmyConfig,
  type ArmyConfigPayload,
} from "../../../shared/army";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import { DesktopStorage } from "../../storage/DesktopStorage";

export interface ArmyConfigRepositoryShape {
  readonly read: (
    configName: string,
  ) => Effect.Effect<ArmyConfigPayload, ArmyConfigRepositoryError>;
}

export class ArmyConfigRepository extends ServiceMap.Service<
  ArmyConfigRepository,
  ArmyConfigRepositoryShape
>()("main/backend/army/ArmyConfigRepository") {}

export class ArmyConfigRepositoryError extends Data.TaggedError(
  "ArmyConfigRepositoryError",
)<{
  readonly operation: "validate" | "read" | "parse";
  readonly configName: string;
  readonly path?: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `Could not ${this.operation} army config: ${this.configName}`;
  }
}

export const layer = Layer.effect(ArmyConfigRepository)(
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const storage = yield* DesktopStorage;

    return {
      read: (configNameInput) =>
        Effect.gen(function* () {
          const configName = yield* Effect.try({
            try: () => assertValidArmyConfigName(configNameInput),
            catch: (cause) =>
              new ArmyConfigRepositoryError({
                operation: "validate",
                configName: configNameInput,
                cause,
              }),
          });
          const path = env.armyConfigPath(configName);
          const raw = yield* storage.readYaml(path).pipe(
            Effect.mapError(
              (cause) =>
                new ArmyConfigRepositoryError({
                  operation: "read",
                  configName,
                  path,
                  cause,
                }),
            ),
            Effect.flatMap((result) => {
              if (result.status === "missing") {
                return Effect.fail(
                  new ArmyConfigRepositoryError({
                    operation: "read",
                    configName,
                    path,
                    cause: "missing",
                  }),
                );
              }
              if (result.status === "malformed") {
                return Effect.fail(
                  new ArmyConfigRepositoryError({
                    operation: "parse",
                    configName,
                    path,
                    cause: "malformed",
                  }),
                );
              }
              return Effect.succeed(result.value);
            }),
          );
          return yield* Effect.try({
            try: () => normalizeArmyConfig(configName, raw),
            catch: (cause) =>
              new ArmyConfigRepositoryError({
                operation: "parse",
                configName,
                path,
                cause,
              }),
          });
        }),
    };
  }),
);
