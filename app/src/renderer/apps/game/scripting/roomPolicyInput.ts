import {
  MAXIMUM_ROOM_NUMBER,
  MINIMUM_PRIVATE_ROOM,
  MINIMUM_ROOM_NUMBER,
  type RoomPolicy,
} from "@lucent/core/accountSettings";

export type RoomNumberInputResult =
  | { readonly status: "invalid" }
  | { readonly status: "valid"; readonly value: number };

export type RoomPolicyMode = RoomPolicy["kind"];
export type RoomNumberKind = "private" | "public";

export const parseRoomNumberInput = (input: string): RoomNumberInputResult => {
  const trimmed = input.trim();
  if (!/^\d+$/u.test(trimmed)) return { status: "invalid" };

  const value = Number(trimmed);
  return Number.isSafeInteger(value) &&
    value >= MINIMUM_ROOM_NUMBER &&
    value <= MAXIMUM_ROOM_NUMBER
    ? { status: "valid", value }
    : { status: "invalid" };
};

export const formatRoomNumberInput = (value: number | null): string =>
  value === null ? "" : String(value);

export const roomNumberKind = (value: number): RoomNumberKind =>
  value >= MINIMUM_PRIVATE_ROOM ? "private" : "public";
