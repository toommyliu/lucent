import type { LiveServer } from "@lucent/game";

export interface AuthState {
  loggedIn: boolean;
  password: string;
  readonly servers: Map<string, LiveServer>;
  username: string;
}

export const makeAuthState = (): AuthState => ({
  loggedIn: false,
  password: "",
  servers: new Map(),
  username: "",
});
