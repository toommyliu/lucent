import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import type { AccountWindowTilingAlgorithm } from "@lucent/core/accounts";

export interface AccountWindowTilePlacement {
  readonly algorithm: AccountWindowTilingAlgorithm;
  readonly count: number;
  readonly index: number;
}

export interface AccountGameWindowsShape {
  readonly close: (gameWindowId: number) => Effect.Effect<boolean, unknown>;
  readonly getGroupId: (gameWindowId: number) => Effect.Effect<number, unknown>;
  readonly onClosed: (
    listener: (gameWindowId: number) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<() => void>;
  readonly open: (options?: {
    readonly managedProfileKey?: string;
    readonly name?: string;
    readonly onCreated?: (gameWindowId: number) => Effect.Effect<void, unknown>;
    readonly tile?: AccountWindowTilePlacement;
  }) => Effect.Effect<number, unknown>;
  readonly reveal: (gameWindowId: number) => Effect.Effect<boolean, unknown>;
  readonly retireProfile: (key: string) => Effect.Effect<void, unknown>;
  readonly setName: (
    gameWindowId: number,
    name: string,
  ) => Effect.Effect<void, unknown>;
}

export class AccountGameWindows extends Context.Service<
  AccountGameWindows,
  AccountGameWindowsShape
>()("lucent/internal/accounts/AccountGameWindows") {}
