import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";

import { LiveItem } from "@lucent/game";
import type { FlashPacket, Item, PacketSelector } from "../Types";
import type {
  FlashPacketHandler,
  FlashProtocolShape,
} from "../protocol/FlashProtocol";
import { matchesPacketSelector } from "../protocol/PacketSelectors";
import type { DropsStateShape } from "../state/Drops";
import type { ItemsStateShape } from "../state/Items";
import { makeDropsApi, type DropsApiPorts } from "./Drops";

type AcceptedContainer = "bank" | "house" | "inventory";
type OwnedContainer = AcceptedContainer | "temp";

const item = (quantity: number, context: Item["context"]): LiveItem =>
  new LiveItem({
    category: "Item",
    coins: false,
    context,
    cost: 0,
    description: "",
    equipped: false,
    equipmentSlot: "",
    file: "",
    houseItem: context === "house",
    itemId: 7,
    link: "",
    meta: "",
    name: "Drop",
    quantity,
    temporaryItem: context === "temporary",
  });

const responsePacket = (
  data: Record<string, unknown> = {},
  route: Partial<Pick<FlashPacket, "command" | "direction" | "wireType">> = {},
): FlashPacket =>
  ({
    command: "getDrop",
    data: { ItemID: 7, bSuccess: true, iQty: 1, ...data },
    direction: "extension",
    raw: "",
    wireType: "json",
    ...route,
  }) as FlashPacket;

interface AcceptScenarioOptions {
  readonly beforeResponse?: Effect.Effect<void>;
  readonly dispatch?: boolean;
  readonly initialQuantities?: Partial<Record<AcceptedContainer, number>>;
  readonly packet?: FlashPacket;
  readonly projected?: {
    readonly container: AcceptedContainer;
    readonly quantity: number;
  };
  readonly removeDropBeforePacket?: boolean;
  readonly timeout?: DropsApiPorts["acceptTimeout"];
}

const makeAcceptScenario = (options: AcceptScenarioOptions = {}) =>
  Effect.gen(function* () {
    const drop = item(1, "drop");
    let currentDrop: Item | null = drop;
    const initialQuantities = {
      inventory: 2,
      ...options.initialQuantities,
    };
    const owned = {
      bank:
        initialQuantities.bank === undefined
          ? null
          : item(initialQuantities.bank, "bank"),
      house:
        initialQuantities.house === undefined
          ? null
          : item(initialQuantities.house, "house"),
      inventory: item(initialQuantities.inventory, "inventory"),
      temp: null,
    } satisfies Record<OwnedContainer, Item | null>;
    let packetHandler: FlashPacketHandler | undefined;
    let packetSelector: PacketSelector | undefined;
    let listenerDisposeCount = 0;
    let projectedDropRemoveCount = 0;
    let dropRemoveCount = 0;
    const dispatchedItemIds: number[] = [];

    const onPacket: FlashProtocolShape["onPacket"] = (selector, handler) =>
      Effect.sync(() => {
        packetHandler = handler;
        packetSelector = selector;
        return () => {
          listenerDisposeCount += 1;
          if (packetHandler === handler) {
            packetHandler = undefined;
          }
        };
      });
    const drops: DropsApiPorts["drops"] = {
      contains: () => Effect.succeed(currentDrop !== null),
      get: () => Effect.succeed(currentDrop),
      getAll: () => Effect.succeed(currentDrop === null ? [] : [currentDrop]),
      remove: () =>
        Effect.sync(() => {
          dropRemoveCount += 1;
          currentDrop = null;
        }),
    } satisfies Pick<DropsStateShape, "contains" | "get" | "getAll" | "remove">;
    const items: DropsApiPorts["items"] = {
      get: (container) =>
        Effect.succeed(
          container === "inventory-or-house"
            ? (owned.inventory ?? owned.house)
            : owned[container],
        ),
      removeDrop: () =>
        Effect.sync(() => {
          projectedDropRemoveCount += 1;
        }),
    } satisfies Pick<ItemsStateShape, "get" | "removeDrop">;
    const api = yield* makeDropsApi({
      acceptTimeout: options.timeout ?? "1 second",
      auth: { isLoggedIn: () => Effect.succeed(true) },
      bridge: {
        acceptDrop: (itemId) =>
          Effect.gen(function* () {
            dispatchedItemIds.push(itemId);
            if (options.dispatch === false) {
              return false;
            }

            yield* options.beforeResponse ?? Effect.void;
            if (options.projected !== undefined) {
              owned[options.projected.container] = item(
                options.projected.quantity,
                options.projected.container,
              );
            }
            if (options.removeDropBeforePacket === true) {
              currentDrop = null;
            }
            if (
              options.packet !== undefined &&
              packetSelector !== undefined &&
              matchesPacketSelector(options.packet, packetSelector)
            ) {
              if (packetHandler === undefined) {
                return yield* Effect.die(
                  new Error("Drop response listener was not registered"),
                );
              }
              yield* packetHandler(options.packet);
            }
            return true;
          }),
        isCustomUiEnabled: () => Effect.succeed(true),
        rejectDrop: () => Effect.void,
        toggleUi: () => Effect.void,
      },
      drops,
      items,
      protocol: { onPacket },
    });

    return {
      api,
      snapshot: () => ({
        currentDrop,
        dispatchedItemIds: [...dispatchedItemIds],
        dropRemoveCount,
        listenerDisposeCount,
        packetSelector,
        projectedDropRemoveCount,
      }),
    };
  });

const runAcceptScenario = (options: AcceptScenarioOptions = {}) =>
  Effect.gen(function* () {
    const scenario = yield* makeAcceptScenario(options);
    const accepted = yield* scenario.api.accept(7);
    return { accepted, ...scenario.snapshot() };
  });

describe("Drops.accept", () => {
  it.effect(
    "validates inventory, bank, and house projections and serializes accepts",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const [inventory, bank, house] = yield* Effect.all([
            runAcceptScenario({
              initialQuantities: { bank: 4, inventory: 2 },
              packet: responsePacket(),
              projected: { container: "inventory", quantity: 3 },
            }),
            runAcceptScenario({
              initialQuantities: { bank: 2 },
              packet: responsePacket({ bBank: true }),
              projected: { container: "bank", quantity: 3 },
            }),
            runAcceptScenario({
              initialQuantities: { house: 2 },
              packet: responsePacket({ bHouse: true }),
              projected: { container: "house", quantity: 3 },
            }),
          ]);

          expect(
            [inventory, bank, house].map((result) => result.accepted),
          ).toEqual([true, true, true]);
          for (const result of [inventory, bank, house]) {
            expect(result).toMatchObject({
              currentDrop: null,
              dispatchedItemIds: [7],
              dropRemoveCount: 1,
              listenerDisposeCount: 1,
              projectedDropRemoveCount: 1,
            });
            expect(result.packetSelector).toEqual({
              command: "getDrop",
              direction: "extension",
              wireType: "json",
            });
          }

          const dispatchStarted = yield* Deferred.make<void>();
          const releaseDispatch = yield* Deferred.make<void>();
          const serialized = yield* makeAcceptScenario({
            beforeResponse: Deferred.succeed(dispatchStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseDispatch)),
            ),
            packet: responsePacket(),
            projected: { container: "inventory", quantity: 3 },
          });
          const first = yield* serialized.api.accept(7).pipe(Effect.forkScoped);
          yield* Deferred.await(dispatchStarted);
          const second = yield* serialized.api
            .accept(7)
            .pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          expect(serialized.snapshot().dispatchedItemIds).toEqual([7]);

          yield* Deferred.succeed(releaseDispatch, undefined);
          expect(yield* Fiber.join(first)).toBe(true);
          expect(yield* Fiber.join(second)).toBe(false);
          expect(serialized.snapshot().dispatchedItemIds).toEqual([7]);
        }),
      ),
  );

  it.effect(
    "returns false without resurrecting state for invalid outcomes",
    () =>
      Effect.gen(function* () {
        const [notDispatched, wrongItem, wrongRoute, rejected, notProjected] =
          yield* Effect.all([
            runAcceptScenario({ dispatch: false }),
            runAcceptScenario({
              packet: responsePacket({ ItemID: 8 }),
              timeout: 0,
            }),
            runAcceptScenario({
              packet: responsePacket({}, { direction: "server" }),
              removeDropBeforePacket: true,
              timeout: 0,
            }),
            runAcceptScenario({ packet: responsePacket({ bSuccess: false }) }),
            runAcceptScenario({
              packet: responsePacket(),
              projected: { container: "inventory", quantity: 2 },
            }),
          ]);

        expect(
          [notDispatched, wrongItem, wrongRoute, rejected, notProjected].map(
            (result) => result.accepted,
          ),
        ).toEqual([false, false, false, false, false]);
        for (const result of [notDispatched, wrongItem, rejected]) {
          expect(result.currentDrop).not.toBeNull();
          expect(result.dropRemoveCount).toBe(0);
          expect(result.projectedDropRemoveCount).toBe(0);
        }
        expect(wrongRoute).toMatchObject({
          currentDrop: null,
          dropRemoveCount: 0,
          listenerDisposeCount: 1,
          projectedDropRemoveCount: 0,
        });
        expect(notProjected).toMatchObject({
          currentDrop: null,
          dropRemoveCount: 1,
          projectedDropRemoveCount: 1,
        });
      }),
  );
});
