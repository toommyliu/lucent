import { Random } from "effect";

export const privateRoom = (map: string, room: number): string => {
  const base = map.trim().replace(/-\d+$/, "");
  return `${base}-${Math.max(1, Math.trunc(room))}`;
};

export const randomPrivateRoom = Random.nextIntBetween(1_000, 100_000);
