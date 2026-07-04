import { Effect, Random } from "effect";

export const minPrivateRoomNumber = 10_000;
export const maxRoomNumber = 99_999;

export interface MapTarget {
  readonly map: string;
  readonly name: string;
  readonly requireExactRoom: boolean;
  readonly roomNumber?: number;
  readonly roomToken?: string;
}

interface SplitMapRoomSuffix {
  readonly map: string;
  readonly name: string;
  readonly roomToken?: string;
}

const splitMapRoomSuffix = (map: string): SplitMapRoomSuffix => {
  const trimmed = map.trim();
  const separatorIndex = trimmed.indexOf("-");
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return { map: trimmed, name: trimmed };
  }

  return {
    map: trimmed,
    name: trimmed.slice(0, separatorIndex),
    roomToken: trimmed.slice(separatorIndex + 1),
  };
};

const parseRoomNumber = (roomToken: string): number | undefined => {
  if (!/^\d+$/.test(roomToken)) {
    return undefined;
  }

  const roomNumber = Number(roomToken);
  return Number.isSafeInteger(roomNumber) &&
    roomNumber >= 1 &&
    roomNumber <= maxRoomNumber
    ? roomNumber
    : undefined;
};

export const hasFixedRoomSuffix = (map: string): boolean => {
  const roomToken = splitMapRoomSuffix(map).roomToken;
  return roomToken !== undefined && parseRoomNumber(roomToken) !== undefined;
};

export const randomPrivateRoomNumber = () =>
  Random.nextIntBetween(minPrivateRoomNumber, maxRoomNumber);

export const withPrivateRoom = (map: string, roomNumber: number): string => {
  const target = splitMapRoomSuffix(map);
  return target.roomToken !== undefined &&
    parseRoomNumber(target.roomToken) !== undefined
    ? target.map
    : `${target.name}-${roomNumber}`;
};

export const parseMapTarget = (map: string): Effect.Effect<MapTarget> =>
  Effect.gen(function* () {
    const target = splitMapRoomSuffix(map);
    if (target.roomToken === undefined) {
      return {
        map: target.map,
        name: target.name,
        requireExactRoom: false,
      };
    }

    const parsedRoomNumber = parseRoomNumber(target.roomToken);
    const roomNumber = parsedRoomNumber ?? (yield* randomPrivateRoomNumber());
    return {
      map:
        parsedRoomNumber === undefined
          ? `${target.name}-${roomNumber}`
          : target.map,
      name: target.name,
      requireExactRoom: true,
      roomNumber,
      roomToken: String(roomNumber),
    };
  });
