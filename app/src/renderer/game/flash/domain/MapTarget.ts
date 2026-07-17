import { Effect, Random } from "effect";

export const minimumPrivateRoom = 10_000;
export const maximumRoom = 99_999;

const minimumExactRoom = 1_001;

export interface MapTarget {
  readonly map: string;
  readonly name: string;
  readonly requireExactRoom: boolean;
  readonly roomNumber?: number;
}

interface MapParts {
  readonly map: string;
  readonly name: string;
  readonly roomToken?: string;
}

const splitRoom = (map: string): MapParts => {
  const trimmed = map.trim();
  const separator = trimmed.indexOf("-");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return { map: trimmed, name: trimmed };
  }

  return {
    map: trimmed,
    name: trimmed.slice(0, separator),
    roomToken: trimmed.slice(separator + 1),
  };
};

const parseRoom = (value: string): number | undefined => {
  if (!/^\d+$/u.test(value)) return undefined;
  const room = Number(value);
  return Number.isSafeInteger(room) && room >= 1 ? room : undefined;
};

export const randomPrivateRoom = Random.nextIntBetween(
  minimumPrivateRoom,
  maximumRoom,
);

export const isPrivateRoom = (room: number): boolean =>
  Number.isSafeInteger(room) &&
  room >= minimumPrivateRoom &&
  room <= maximumRoom;

export const hasFixedRoom = (map: string): boolean => {
  const roomToken = splitRoom(map).roomToken;
  return roomToken !== undefined && parseRoom(roomToken) !== undefined;
};

export const privateRoom = (map: string, room: number): string => {
  const target = splitRoom(map);
  if (
    target.roomToken !== undefined &&
    parseRoom(target.roomToken) !== undefined
  ) {
    return target.map;
  }
  return `${target.name}-${Math.max(1, Math.trunc(room))}`;
};

export const applyPrivateRoom = Effect.fn("applyPrivateRoom")(function* (
  map: string,
  enabled: boolean,
) {
  const trimmed = map.trim();
  if (trimmed === "" || !enabled) return map;
  return privateRoom(trimmed, yield* randomPrivateRoom);
});

export const parseMapTarget = (map: string): Effect.Effect<MapTarget> =>
  Effect.gen(function* () {
    const target = splitRoom(map);
    if (target.roomToken === undefined) {
      return {
        map: target.map,
        name: target.name,
        requireExactRoom: false,
      };
    }

    const fixedRoom = parseRoom(target.roomToken);
    const roomNumber = fixedRoom ?? (yield* randomPrivateRoom);
    const requireExactRoom =
      fixedRoom === undefined ||
      (fixedRoom >= minimumExactRoom && fixedRoom <= maximumRoom);
    return {
      map:
        fixedRoom === undefined ? `${target.name}-${roomNumber}` : target.map,
      name: target.name,
      requireExactRoom,
      roomNumber,
    };
  });
