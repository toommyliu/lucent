import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { AccountLaunchWindowTarget } from "@lucent/core/accounts";
import type { DesktopWindowError } from "../../window/DesktopWindows";
import type { ElectronGamePartitionError } from "../session/GameSessions";

export interface AccountGameWindowEvent {
  readonly gameWindowGroupId?: number;
  readonly gameWindowId: number;
  readonly rendererGeneration: number;
}

export interface AccountGameWindowsShape {
  readonly close: (gameWindowId: number) => Effect.Effect<boolean>;
  readonly getGeneration: (
    gameWindowId: number,
  ) => Effect.Effect<number, DesktopWindowError>;
  readonly getGroupId: (
    gameWindowId: number,
  ) => Effect.Effect<number, DesktopWindowError>;
  readonly onClosed: (
    listener: (gameWindowId: number) => Effect.Effect<void>,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly onCreated: (
    listener: (event: AccountGameWindowEvent) => Effect.Effect<void>,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly onReloaded: (
    listener: (event: AccountGameWindowEvent) => Effect.Effect<void>,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly open: (options?: {
    readonly gameViewLayout?: "grid";
    readonly managedProfileKey?: string;
    readonly name?: string;
    readonly onCreated?: (
      event: AccountGameWindowEvent,
    ) => Effect.Effect<void>;
    readonly windowTarget?: AccountLaunchWindowTarget;
  }) => Effect.Effect<number, DesktopWindowError>;
  readonly reveal: (gameWindowId: number) => Effect.Effect<boolean>;
  readonly retireProfile: (
    key: string,
  ) => Effect.Effect<void, ElectronGamePartitionError>;
  readonly setName: (
    gameWindowId: number,
    name: string,
  ) => Effect.Effect<void, DesktopWindowError>;
}

export class AccountGameWindows extends Context.Service<
  AccountGameWindows,
  AccountGameWindowsShape
>()("lucent/desktop/game/accounts/AccountGameWindows") {}
