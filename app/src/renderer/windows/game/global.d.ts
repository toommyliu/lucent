import type { GameDesktopWindowBridge } from "../../../shared/ipc";

declare global {
  // Item id or name
  type ItemIdentifierToken = number | string;
  type ConnectionStatus =
    | "OnConnection"
    | "OnConnectionFailed"
    | "OnConnectionLost";

  type MonsterName =
    | string
    | `id'${number}`
    | `id.${number}`
    | `id:${number}`
    | `id-${number}`;
  type MonsterMapID = number;
  type MonsterIdentifierToken = MonsterName | MonsterMapID;
  type Skill = number | string;

  interface Window {
    readonly desktop: GameDesktopWindowBridge;
    __lucentLoaderState?: {
      loaded: boolean;
      progress?: number;
    };
  }
}

export {};
