import type {
  EventSelector,
  FlashEvent,
  FlashPacket,
  PacketSelector,
} from "../Types";
import { packetMatchesSelector } from "../selectors";

export const matchesPacketSelector = (
  packet: FlashPacket,
  selector?: PacketSelector,
): boolean => packetMatchesSelector(packet, selector);

export const matchesEventSelector = (
  event: FlashEvent,
  selector?: EventSelector,
): boolean => {
  if (selector?.type !== undefined && event.type !== selector.type) {
    return false;
  }

  return true;
};
