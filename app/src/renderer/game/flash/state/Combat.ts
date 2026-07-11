export type CombatTarget =
  | { readonly id: number; readonly type: "monster" }
  | { readonly id: number; readonly type: "player" };

export interface CombatState {
  target: CombatTarget | null;
}

export const makeCombatState = (): CombatState => ({ target: null });
