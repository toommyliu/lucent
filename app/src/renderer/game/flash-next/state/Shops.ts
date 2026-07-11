import type { LiveShop } from "@lucent/game";

export interface ShopsState {
  current: LiveShop | null;
}

export const makeShopsState = (): ShopsState => ({ current: null });
