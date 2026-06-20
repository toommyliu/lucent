import { EntityState, type AvatarData, type MonsterData } from "@lucent/game";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { Auth, type AuthShape } from "../Services/Auth";
import { Bridge, type BridgeShape } from "../Services/Bridge";
import {
  GameEvents,
  type GameUpdateMessageEvent,
} from "../Services/GameEvents";
import { Packet, type PacketListenerDisposer } from "../Services/Packet";
import type {
  ClientPacket,
  ExtensionPacket,
  ServerPacket,
} from "../PacketTypes";
import type { PacketShape } from "../Services/Packet";
import { Wait, type WaitShape } from "../Services/Wait";
import { World } from "../Services/World";
import { GameEventsLive } from "./GameEvents";
import { GameEventProjectorLive } from "./GameEventProjector";
import { WorldLive } from "./World";

type HandlerMap<A> = Map<string, Set<(packet: A) => Effect.Effect<void>>>;

interface PacketHarness {
  readonly emitClient: (params: readonly string[]) => Effect.Effect<void>;
  readonly emitServer: (data: Record<string, unknown>) => Effect.Effect<void>;
}

const register = <A>(
  handlers: HandlerMap<A>,
  cmd: string,
  handler: (packet: A) => Effect.Effect<void>,
): Effect.Effect<PacketListenerDisposer> =>
  Effect.sync(() => {
    const registered = handlers.get(cmd) ?? new Set();
    registered.add(handler);
    handlers.set(cmd, registered);
    return () => {
      registered.delete(handler);
      if (registered.size === 0) {
        handlers.delete(cmd);
      }
    };
  });

const runHandlers = <A>(
  handlers: HandlerMap<A>,
  cmd: string,
  packet: A,
): Effect.Effect<void> =>
  Effect.forEach(
    Array.from(handlers.get(cmd) ?? []),
    (handler) => handler(packet),
    {
      discard: true,
    },
  );

const makePacketHarness = (): {
  readonly harness: PacketHarness;
  readonly layer: Layer.Layer<Packet>;
} => {
  const clientHandlers: HandlerMap<ClientPacket> = new Map();
  const serverHandlers: HandlerMap<ServerPacket> = new Map();
  const extensionHandlers: HandlerMap<ExtensionPacket> = new Map();

  const packetShape: PacketShape = {
    sendClient: () => Effect.void,
    sendServer: () => Effect.void,
    onExtensionResponse: () => Effect.succeed(() => undefined),
    packetFromClient: () => Effect.succeed(() => undefined),
    packetFromServer: () => Effect.succeed(() => undefined),
    client: (cmd, handler) => register(clientHandlers, cmd, handler),
    server: (cmd, handler) => register(serverHandlers, cmd, handler),
    extension: (cmd, handler) => register(extensionHandlers, cmd, handler),
    extensionType: (_packetType, cmd, handler) =>
      register(extensionHandlers, cmd, handler),
    json: (cmd, handler) => register(extensionHandlers, cmd, handler),
    str: (cmd, handler) => register(extensionHandlers, cmd, handler),
    scoped: (registration) =>
      Effect.acquireRelease(registration, (dispose) =>
        Effect.sync(dispose),
      ).pipe(Effect.asVoid),
    clientScoped: (cmd, handler) =>
      packetShape.scoped(packetShape.client(cmd, handler)),
    serverScoped: (cmd, handler) =>
      packetShape.scoped(packetShape.server(cmd, handler)),
    extensionScoped: (cmd, handler) =>
      packetShape.scoped(packetShape.extension(cmd, handler)),
    extensionTypeScoped: (packetType, cmd, handler) =>
      packetShape.scoped(packetShape.extensionType(packetType, cmd, handler)),
    jsonScoped: (cmd, handler) =>
      packetShape.scoped(packetShape.json(cmd, handler)),
    strScoped: (cmd, handler) =>
      packetShape.scoped(packetShape.str(cmd, handler)),
  };

  return {
    harness: {
      emitClient: (params) =>
        runHandlers(clientHandlers, "gar", {
          type: "client",
          raw: params.join("%"),
          cmd: "gar",
          params: [...params],
        }),
      emitServer: (data) =>
        runHandlers(serverHandlers, "ct", {
          type: "server",
          raw: "ct",
          cmd: "ct",
          data,
        }),
    },
    layer: Layer.succeed(Packet)(packetShape),
  };
};

const bridgeLayer = Layer.succeed(Bridge)({
  call: () => Effect.void as never,
  callGameFunction: () => Effect.void,
  onConnection: () => Effect.succeed(() => undefined),
} satisfies BridgeShape);

const waitLayer = Layer.succeed(Wait)({
  until: (condition) => condition,
  untilSome: (condition) => condition,
  isGameActionAvailable: () => Effect.succeed(true),
  forGameAction: () => Effect.succeed(true),
} satisfies WaitShape);

const authLayer = Layer.succeed(Auth)({
  connectTo: () =>
    Effect.succeed({
      status: "connected",
      message: "connected",
      retryable: false,
    }),
  getServers: () => Effect.succeed([]),
  getUsername: () => Effect.succeed("Hero"),
  getPassword: () => Effect.succeed("password"),
  getLoginSession: () =>
    Effect.succeed({
      username: "Hero",
      password: "password",
      server: "Test",
    } as never),
  isLoggedIn: () => Effect.succeed(true),
  isTemporarilyKicked: () => Effect.succeed(false),
  login: () => Effect.void,
  logout: () => Effect.void,
} satisfies AuthShape);

const avatar = (
  entID: number,
  strUsername: string,
  strFrame = "Enter",
): AvatarData => ({
  afk: false,
  entID,
  entType: "player",
  intHP: 100,
  intHPMax: 100,
  intLevel: 1,
  intMP: 100,
  intMPMax: 100,
  intState: EntityState.Idle,
  strFrame,
  strPad: "Spawn",
  strUsername,
  tx: 0,
  ty: 0,
  uoName: strUsername.toLowerCase(),
});

const monster = (
  monMapId: number,
  strMonName: string,
  strFrame = "Enter",
): MonsterData => ({
  iLvl: 1,
  intHP: 100,
  intHPMax: 100,
  intMP: 100,
  intMPMax: 100,
  intState: EntityState.Idle,
  monId: monMapId,
  monMapId,
  sRace: "None",
  strFrame,
  strMonName,
});

const withProjector = <A>(
  effect: (
    harness: PacketHarness,
  ) => Effect.Effect<A, unknown, GameEvents | World>,
) => {
  const { harness, layer: packetLayer } = makePacketHarness();
  const worldLayer = WorldLive.pipe(
    Layer.provideMerge(Layer.mergeAll(bridgeLayer, waitLayer)),
  );
  const servicesLayer = GameEventProjectorLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(authLayer, packetLayer, GameEventsLive, worldLayer),
    ),
  );
  return Effect.scoped(effect(harness)).pipe(Effect.provide(servicesLayer));
};

const seedWorld = Effect.gen(function* () {
  const world = yield* World;
  yield* world.players.add(avatar(1, "Hero"));
  yield* world.players.setSelf("Hero");
});

const collectUpdateMessages = Effect.gen(function* () {
  const events: GameUpdateMessageEvent[] = [];
  const gameEvents = yield* GameEvents;
  yield* gameEvents.on("updateMessage", (event) =>
    Effect.sync(() => {
      events.push(event);
    }),
  );
  return events;
});

describe("GameEventProjector update messages", () => {
  it.effect("emits animation update messages", () =>
    withProjector((harness) =>
      Effect.gen(function* () {
        yield* seedWorld;
        const events = yield* collectUpdateMessages;

        yield* harness.emitServer({
          anims: [{ cInf: "p:1", tInf: "m:7", msg: "Counter attack" }],
        });

        expect(events).toMatchObject([
          {
            message: "Counter attack",
            source: "animation",
            monMapId: 7,
            targetMonMapId: 7,
          },
        ]);
      }),
    ),
  );

  it.effect("substitutes source monster names in animation messages", () =>
    withProjector((harness) =>
      Effect.gen(function* () {
        yield* seedWorld;
        const world = yield* World;
        yield* world.monsters.add(monster(7, "Ultra Warden"));
        const events = yield* collectUpdateMessages;

        yield* harness.emitServer({
          anims: [{ cInf: "m:7", tInf: "p:1", msg: "<mon> prepares doom" }],
        });

        expect(events.map((event) => event.message)).toEqual([
          "Ultra Warden prepares doom",
        ]);
      }),
    ),
  );

  it.effect("skips empty update messages", () =>
    withProjector((harness) =>
      Effect.gen(function* () {
        yield* seedWorld;
        const events = yield* collectUpdateMessages;

        yield* harness.emitServer({
          anims: [{ cInf: "p:1", tInf: "m:7", msg: [" ", ""] }],
        });

        expect(events).toEqual([]);
      }),
    ),
  );

  it.effect("emits aura msgOn and msgOff update messages", () =>
    withProjector((harness) =>
      Effect.gen(function* () {
        yield* seedWorld;
        const world = yield* World;
        yield* world.monsters.add(monster(7, "Ultra Warden"));
        const events = yield* collectUpdateMessages;

        yield* harness.emitServer({
          a: [
            {
              cmd: "aura++",
              tInf: "m:7",
              auras: [{ nam: "Focus", msgOn: "Focus begins" }],
            },
            {
              cmd: "aura--",
              tInf: "m:7",
              aura: { nam: "Focus", msgOff: "Focus fades" },
            },
          ],
        });

        expect(events.map((event) => [event.message, event.auraPhase])).toEqual(
          [
            ["Focus begins", "on"],
            ["Focus fades", "off"],
          ],
        );
      }),
    ),
  );

  it.effect("supports aura removal payloads with auras arrays", () =>
    withProjector((harness) =>
      Effect.gen(function* () {
        yield* seedWorld;
        const world = yield* World;
        yield* world.monsters.add(monster(7, "Ultra Warden"));
        const events = yield* collectUpdateMessages;

        yield* harness.emitServer({
          a: [
            {
              cmd: "aura--",
              tInf: "m:7",
              auras: [
                { nam: "One", msgOff: "One fades" },
                { nam: "Two", msgOff: "Two fades" },
              ],
            },
          ],
        });

        expect(events.map((event) => event.message)).toEqual([
          "One fades",
          "Two fades",
        ]);
      }),
    ),
  );

  it.effect("emits @ aura messages only for self-target player auras", () =>
    withProjector((harness) =>
      Effect.gen(function* () {
        yield* seedWorld;
        const world = yield* World;
        yield* world.players.add(avatar(2, "Ally"));
        const events = yield* collectUpdateMessages;

        yield* harness.emitServer({
          a: [
            {
              cmd: "aura+",
              tInf: "p:1",
              auras: [{ nam: "Self", msgOn: "@Only you" }],
            },
            {
              cmd: "aura+",
              tInf: "p:2",
              auras: [{ nam: "Ally", msgOn: "@Only ally" }],
            },
          ],
        });

        expect(events.map((event) => event.message)).toEqual(["Only you"]);
      }),
    ),
  );
});

describe("GameEventProjector aura relevance", () => {
  it.effect("emits forced monster aura messages", () =>
    withProjector((harness) =>
      Effect.gen(function* () {
        yield* seedWorld;
        const world = yield* World;
        yield* world.monsters.add(monster(7, "Ultra Warden", "Other"));
        const events = yield* collectUpdateMessages;

        yield* harness.emitServer({
          a: [
            {
              cmd: "aura++",
              cInf: "p:99",
              tInf: "m:7",
              auras: [{ nam: "Forced", msgOn: "Forced shows" }],
            },
          ],
        });

        expect(events.map((event) => event.message)).toEqual(["Forced shows"]);
      }),
    ),
  );

  it.effect("emits missing-source monster aura messages", () =>
    withProjector((harness) =>
      Effect.gen(function* () {
        yield* seedWorld;
        const world = yield* World;
        yield* world.monsters.add(monster(7, "Ultra Warden", "Other"));
        const events = yield* collectUpdateMessages;

        yield* harness.emitServer({
          a: [
            {
              cmd: "aura+",
              tInf: "m:7",
              auras: [{ nam: "No Source", msgOn: "No source shows" }],
            },
          ],
        });

        expect(events.map((event) => event.message)).toEqual([
          "No source shows",
        ]);
      }),
    ),
  );

  it.effect("skips unrelated monster aura messages", () =>
    withProjector((harness) =>
      Effect.gen(function* () {
        yield* seedWorld;
        const world = yield* World;
        yield* world.monsters.add(monster(7, "Ultra Warden"));
        const events = yield* collectUpdateMessages;

        yield* harness.emitServer({
          a: [
            {
              cmd: "aura+",
              cInf: "p:99",
              tInf: "m:7",
              auras: [{ nam: "Hidden", msgOn: "Should not show" }],
            },
          ],
        });

        expect(events).toEqual([]);
      }),
    ),
  );

  it.effect(
    "emits related monster aura messages from server action results",
    () =>
      withProjector((harness) =>
        Effect.gen(function* () {
          yield* seedWorld;
          const world = yield* World;
          yield* world.monsters.add(monster(7, "Ultra Warden"));
          const events = yield* collectUpdateMessages;

          yield* harness.emitServer({
            sara: [
              {
                iRes: 1,
                actionResult: {
                  cInf: "p:1",
                  tInf: "m:7",
                  hp: 10,
                },
              },
            ],
            a: [
              {
                cmd: "aura+",
                cInf: "p:1",
                tInf: "m:7",
                auras: [{ nam: "Related", msgOn: "Related shows" }],
              },
            ],
          });

          expect(events.map((event) => event.message)).toEqual([
            "Related shows",
          ]);
        }),
      ),
  );

  it.effect(
    "skips monster aura messages from copied player damage relations",
    () =>
      withProjector((harness) =>
        Effect.gen(function* () {
          yield* seedWorld;
          const world = yield* World;
          yield* world.players.add(avatar(2, "Ally"));
          yield* world.monsters.add(monster(7, "Ultra Warden"));
          const events = yield* collectUpdateMessages;

          yield* harness.emitServer({
            sara: [
              {
                iRes: 1,
                actionResult: {
                  cInf: "p:2",
                  tInf: "m:7",
                  hp: 10,
                },
              },
              {
                iRes: 1,
                actionResult: {
                  cInf: "p:1",
                  tInf: "p:2",
                  hp: 10,
                },
              },
            ],
            a: [
              {
                cmd: "aura+",
                cInf: "p:1",
                tInf: "m:7",
                auras: [{ nam: "Copied", msgOn: "Should not show" }],
              },
            ],
          });

          expect(events).toEqual([]);
        }),
      ),
  );

  it.effect(
    "emits related monster aura messages from outgoing gar packets",
    () =>
      withProjector((harness) =>
        Effect.gen(function* () {
          yield* seedWorld;
          const world = yield* World;
          yield* world.monsters.add(monster(7, "Ultra Warden"));
          const events = yield* collectUpdateMessages;

          yield* harness.emitClient(["xt", "zm", "gar", "1", "a1>m:7", "wvz"]);
          yield* harness.emitServer({
            a: [
              {
                cmd: "aura+",
                cInf: "p:1",
                tInf: "m:7",
                auras: [{ nam: "Related", msgOn: "Related shows" }],
              },
            ],
          });

          expect(events.map((event) => event.message)).toEqual([
            "Related shows",
          ]);
        }),
      ),
  );

  it.effect("emits same-cell player aura messages", () =>
    withProjector((harness) =>
      Effect.gen(function* () {
        yield* seedWorld;
        const world = yield* World;
        yield* world.players.add(avatar(2, "Ally", "Enter"));
        const events = yield* collectUpdateMessages;

        yield* harness.emitServer({
          a: [
            {
              cmd: "aura+",
              tInf: "p:2",
              auras: [{ nam: "Ally", msgOn: "Ally shows" }],
            },
          ],
        });

        expect(events.map((event) => event.message)).toEqual(["Ally shows"]);
      }),
    ),
  );

  it.effect("skips out-of-cell player aura messages", () =>
    withProjector((harness) =>
      Effect.gen(function* () {
        yield* seedWorld;
        const world = yield* World;
        yield* world.players.add(avatar(2, "Ally", "Other"));
        const events = yield* collectUpdateMessages;

        yield* harness.emitServer({
          a: [
            {
              cmd: "aura+",
              tInf: "p:2",
              auras: [{ nam: "Ally", msgOn: "Should not show" }],
            },
          ],
        });

        expect(events).toEqual([]);
      }),
    ),
  );
});
