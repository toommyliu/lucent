import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Bridge, makeBridge } from "../bridge/Bridge";
import { Gateway, makeGateway } from "../bridge/Gateway";
import { reapplySettingsPatch } from "../../automation/SettingsPolicy";
import { makeApi } from "./Api";

describe("Api", () => {
  it.effect(
    "constructs isolated namespaces and retains a last-good refresh",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let failRefresh = false;
          const target = {
            swf: {
              "bank.getItems": () => {
                if (failRefresh) throw new Error("refresh failed");
                return [{ ItemID: "42", iQty: "2", sName: "Indexed Item" }];
              },
            },
          } as unknown as Window;
          const bridge = yield* makeBridge(target);
          const gateway = yield* makeGateway(target).pipe(
            Effect.provideService(Bridge, bridge),
          );
          const api = yield* makeApi.pipe(
            Effect.provideService(Bridge, bridge),
            Effect.provideService(Gateway, gateway),
          );

          expect(Object.keys(api).toSorted()).toEqual([
            "auth",
            "bank",
            "combat",
            "drops",
            "events",
            "house",
            "inventory",
            "map",
            "monsters",
            "packet",
            "player",
            "players",
            "quests",
            "settings",
            "shops",
            "tempInventory",
            "wait",
          ]);
          expect(api.bank).not.toBe(api.inventory);
          expect((yield* api.bank.getAll())[0]?.quantity).toBe(2);

          failRefresh = true;
          const retained = yield* api.bank.getAll();
          expect(retained[0]?.itemId).toBe(42);
        }),
      ),
  );

  it.effect("distinguishes unset cosmetic settings from explicit blanks", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const customNames: string[] = [];
        const customGuilds: string[] = [];
        const target = {
          swf: {
            "settings.setCustomGuild": (value: string) => {
              customGuilds.push(value);
            },
            "settings.setCustomName": (value: string) => {
              customNames.push(value);
            },
          },
        } as unknown as Window;
        const bridge = yield* makeBridge(target);
        const gateway = yield* makeGateway(target).pipe(
          Effect.provideService(Bridge, bridge),
        );
        const api = yield* makeApi.pipe(
          Effect.provideService(Bridge, bridge),
          Effect.provideService(Gateway, gateway),
        );

        yield* api.settings.apply(
          reapplySettingsPatch(yield* api.settings.get()),
        );
        expect(customNames).toEqual([]);
        expect(customGuilds).toEqual([]);

        yield* api.settings.setCustomName("");
        yield* api.settings.setCustomGuild("");
        const configured = reapplySettingsPatch(yield* api.settings.get());
        expect(configured.customName).toBe("");
        expect(configured.customGuild).toBe("");
        expect(customNames).toEqual([""]);
        expect(customGuilds).toEqual([""]);
      }),
    ),
  );
});
