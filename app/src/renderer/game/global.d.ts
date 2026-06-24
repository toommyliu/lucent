export interface LucentGameWindowCallbacks {
  onConnection?: (status: string) => void;
  onDebug?: (message: string) => void;
  onExtensionResponse?: (packet: string) => void;
  onLoaded?: () => void;
  onProgress?: (percent: number) => void;
  packetFromClient?: (packet: string) => void;
  packetFromServer?: (packet: string) => void;
}

declare global {
  interface Window extends LucentGameWindowCallbacks {}
}
