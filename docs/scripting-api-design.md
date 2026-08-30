# User scripting API design

Status: working design

This document records the decisions from the user scripting API audit. The
focus is the API available to user-authored scripts. Internal flash API details
matter only when they leak into that API.

Auth username and password functions and recipes are outside this review.

Decided contract changes are hard migrations: migrate TypeScript, UI, and IPC
callers to the canonical shape and delete legacy aliases and compatibility
adapters. Conversions remain only at real representation boundaries, such as
serializing a duration to milliseconds for IPC or mapping packet encoding to an
AS3 bridge value.

## Decided

| Before | After | Why | Decision note |
| --- | --- | --- | --- |
| `makeScriptBuiltinModules()` spreads internal services into `lucent/api` and freezes only the outer registry | Build each public namespace explicitly from an allowlist and freeze each namespace object. | The current runtime exposes undocumented combat functions and lets JavaScript replace methods on shared service objects. | Do not spread internal service objects into the user scripting API. |
| `api.shops` | `api.shop` | The namespace represents the shop domain, matching singular namespaces such as `api.map` and `api.inventory`. | Hard migration; do not add a `shops` alias. |
| `api.shop.load(shopId)` | `api.shop.open(shopId)` | The operation opens the shop UI and waits until the requested shop is open. | Keep the flash api and bridge operation named `load`. |
| `LiveModel.update()`, `replaceFrom()`, and `snapshot()`; `LiveEntity.addAura()`, `clearAuras()`, and `removeAura()`; `LiveMonster.replaceDrops()` | Keep the allocation-free live objects. Continue marking these methods `@internal` and excluding them from generated reference pages. | A script-facing wrapper would allocate another object for every live model. Commit `a5732126dab1d59cc2f8ed09bfe285e7f71b160a` already hides these methods from the generated reference pages. | Do not add readonly wrapper objects or defensive copies for this purpose. |
| `combat.castConsumableOnMonster()` and `combat.getConsumableSkillItem()` | Remove them from `lucent/api`; keep them in the flash API for combat profiles and Army. | They expose consumable-slot coordination and acknowledgement details used by Lucent internals. | |
| `shops.loadArmorCustomize()` and `shops.loadHairShop()` | Keep them as `shop.openArmorCustomize()` and `shop.openHairShop(shopId)`. | These functions open game UI rather than loading shop data. | Keep the capabilities and change the verbs. |
| `map.loadSwf()` | Keep `map.loadSwf()`. | Raw SWF loading is an intentional scripting capability. | This reverses the audit recommendation to hide it. |
| `drops.isCustomUiEnabled()` and `drops.toggleUi()` | Remove both functions. | Drop actions and Lucent UI state should remain separate. | Do not add a replacement setting. |
| `events.on()` and `events.once()` accept `{ type: "packet" }` | Remove `ProtocolEvent` from generic events; use `packet.on()` and `packet.once()`. | The packet API already has direction, command, predicate, and encoding selectors. | |
| `combat.attackMonster(query)` | Rename it to `combat.attack(target)`. | `MonsterQuery` already states the target kind, and the shorter name reads naturally inside `combat`. | |
| `combat.exit()` | Keep `combat.exit()`. | Within the `combat` namespace, `exit` clearly means leaving combat. `script.exit()` remains distinct in the script namespace. | Do not rename it to `disengage()`. |
| `Skill = number`; `combat.canUseSkill()` and `combat.useSkill()` accept any number | Add `SkillSlot = 0 \| 1 \| 2 \| 3 \| 4 \| 5` and use it in both functions. | The runtime accepts only those slots. | |
| `combat.getSkillCooldownRemaining(index): number` | Use `combat.getSkillCooldownRemainingMs(skill: SkillSlot): number \| null`. | `Remaining` states what the value represents, `Ms` makes the unit explicit, and `null` replaces the bridge-failure sentinel. | Keep `Remaining` in the function name. |
| `SkillUseOptions.wait` | Rename it to `waitUntilReady`. | The new name states what the function waits for. | |
| `HuntOptions.findMost` | Rename it to `preferMostMatches`. | The option selects the cell with the most matching monsters. | |
| `army.executeWithArmy(action)` | Remove it; use `army.runStep("execute", action)`. | It is an exact wrapper around `runStep`. | |
| `CombatKillOptions.killPriority`, `skillSet`, and `skillDelay` | Rename them to `targetPriority`, `skills`, and `skillInterval`. Make `skillInterval` accept `Duration.Input`. | The new names match what the fields control. | |
| `army.getPlayerNumber()` returns `-1` without an active session | Return `number \| null`. | `-1` is not a player number and hides the missing session. | |
| `wait.forEvent()` and `wait.forPacket()` | Remove them; keep `events.once()` and `packet.once()`. | The domain functions are exact aliases and sit beside their subscription counterparts. | |
| `map.getMapItem(itemId): Effect<void>` | Keep the current name and return type. | `getMapItem` is established AQW terminology. | This reverses the proposed `collectItem(): Effect<boolean>` change. |
| `map.reload(): Effect<void>` | Keep the current return type. | Reload does not emit `join-map`, and the client exposes no reliable completion acknowledgement. A boolean would report dispatch or a polling guess rather than a confirmed reload. | Do not claim observable success. |
| `map.setSpawnPoint(): Effect<void>` | Keep the current return type. | The bridge and AQW client provide no acknowledgement or spawn-point readback. A boolean would only report dispatch. | Do not claim success that Lucent cannot observe. |
| `packet.sendClient()` and `packet.sendServer()` | Rename them to `sendToClient()` and `sendToServer()`. | The new names identify the destination. | |
| Packet callbacks expose `wireType: "str" \| "json"` | Expose `encoding: "string" \| "json"` and translate to the internal wire type. | Public send functions already use `"string"`; `"str"` is a bridge representation. | |
| `script.sleep(ms)`, `ArmyRunStepOptions.timeoutMs`, `CombatKillOptions.skillDelay`, and `autoRelogin.setDelay(delayMs)` use numeric milliseconds | Accept `Duration.Input`; reserve an `Ms` suffix for numeric duration outputs. | `wait` already establishes this convention. | |
| `autoRelogin.enable()`, `disable()`, and `setEnabled()` | Keep only `setEnabled(boolean)`. | AutoZone already uses this convention, and all three functions control the same state. | Remove `enable()` and `disable()`. |
| `autoRelogin.setServer("")` clears the selected server | Accept `string \| undefined`, where `undefined` clears it. | Empty-string clearing is hidden behavior. AutoZone already uses `undefined`. | |
| `MonsterQuery` treats strings such as `"id.123"` as monster map IDs | Keep the current parsing behavior. | Lucent preserves established Skua and Grimlite selector behavior. Numbers and selector objects remain available for explicit IDs. | Compatibility takes precedence over removing the magic-string form. |
| `bank.contains()`, `inventory.contains()`, and `tempInventory.contains()` call the count parameter `requested` | Rename the parameter to `quantity`. | Related item APIs already use `quantity`. | |
| Aura, monster, player, faction, outfit, quest, and server collection getters return mutable array types | Return `readonly ...[]` consistently. | Bank, inventory, house, drops, shops, and temporary inventory already use readonly arrays. | |
| Environment quest functions accept `number \| string` IDs | Accept numeric quest and reward IDs throughout the scripting, renderer-service, desktop bridge, IPC, and core mutation contracts. Parse text only in the Environment form. | The rest of the quest API uses numeric IDs, and a hard migration avoids preserving a second transport shape. | Do not retain string-ID compatibility in UI/IPC contracts. |
| `api.environment` exposes 27 flat operations, including granular drop-policy, quest auto-registration, and automation setters | Keep 17 flat operations. Use `updateDropPolicy(patch)`, `updateQuestAutoRegister(patch)`, and `setAutomationEnabled(capability, enabled)`. Rename `clear()` to `clearRegistrations()`. | The combined operations preserve targeted updates while removing exact wrappers. The flat names remain clear beside `api.quests`, `api.inventory`, and `api.drops`. | Do not add `quests`, `items`, or `boosts` subnamespaces unless one later gains independent reads, state, or behavior. |
| `environment.getState()` and mutations return the internal `EnvironmentState` object | Return a deeply detached `EnvironmentSnapshot` with public `dropPolicy` instead of internal `itemRules`. | Scripts must not mutate Environment state outside its operations, and bucket storage is an internal representation. | Keep the snapshot flat. |
| Every Environment operation declares `unknown` errors | Make `getState()` infallible and map mutation failures to `EnvironmentError`. | A named error supports typed recovery while matching the actual infallible local state read. | Do not add an alias for the repeated mutation Effect type. |
| `environment.fetchBoosts()` and `environment.syncToAll()` | Remove both from the user scripting API. | Scripts can filter `inventory.getAll()` themselves, while cross-client synchronization exceeds the calling client's expected scope. | Keep both capabilities internal for the Environment UI. |
| There is no `drops.get(query)` or `house.contains(query, quantity?)` | Add both functions. | Their stores already support the operations, and comparable item containers expose them. | |
| `shops.getInfo()` | Rename it to `shop.getCurrent()`. | It returns the currently loaded shop, not generic information. | |
| `wait.forGameAction()` and `wait.isGameActionAvailable()` | Keep both functions public. | They remain useful when scripts coordinate raw or advanced game actions. | The namespace for `isGameActionAvailable()` is still open below. |
| `army.getSession()` and `army.start()` shallow-clone session data | Deeply clone returned sessions, including nested set and config values. | A script must not mutate Army's stored session through nested references. | |
| `autoZone.getState()`, `setEnabled()`, and `setMap()` return the state object stored in `SubscriptionRef` | Return detached state snapshots. | Direct mutation currently bypasses AutoZone updates and notifications. | |
| `player.rest(full?)` | Use `player.rest({ waitUntilFull? }): Effect<boolean>`. Report dispatch failure, and when `waitUntilFull` is set, return success only after observing full HP and MP. | The named option explains the waiting behavior, while the boolean is backed by observable outcomes. | Approved for this implementation pass. |

## Not yet decided

The proposed parameter vocabulary is:

- A `query` is a public shorthand input that accepts a name, ID, or selector
  object and is normalized before use.
- A `selector` is an already structured identity or filter object, such as an
  `EventSelector`, `PacketSelector`, or `ScriptEquipEnhancementSelector`.
- A `target` is the query that a combat action acts upon. Lookup functions still
  use `query`.

| Before | After | Why | Decision note |
| --- | --- | --- | --- |
| `auth.isServerSelectReady()` and `auth.isTemporarilyKicked()` | Keep them internal to readiness and auto-relogin handling. | They describe client connection phases rather than account-level operations. | |
| `combat.killForItem(target, item, quantity?, killOptions?)` and the temporary-item and Army variants | Preferred: `killForItem(target, item, farmOptions?)`, where `farmOptions` extends `CombatKillOptions` with `quantity`. Alternative: `killForItem({ target, item, quantity }, killOptions?)`. | Keeping the two required operands positional makes the common call compact. The request-object form cleanly separates what to farm from how to fight, but it adds ceremony and leaves two configuration objects. | Open question: whether `target`, `item`, and `quantity` should form one request object followed by kill options. |
| `depositBatch(selectors: readonly ItemQuery[])`, `withdrawBatch(selectors: readonly ItemQuery[])`, `acceptBatch()`, and `loadBatch()` | Use `depositMany(queries)`, `withdrawMany(queries)`, `acceptMany()`, and `loadMany()`. | `Many` describes caller-visible cardinality. The bank inputs are queries, not normalized selectors. Three functions are serial loops, and `loadBatch()` using one bridge request is an implementation detail. | The function names and bank parameter names remain open. |
| `events.on(query, handler)` and the typed `events.once(query)` overload use `query`, while the general `once()` overload uses `selector` | Use `selector` in every overload. | All overloads accept an `EventSelector`, not a name, ID, or shorthand query. The inconsistency appears in generated docs and parameter hints. | |
| `packet.on(query, handler)` and the typed `packet.once(query)` overload use `query`, while the general `once()` overload uses `selector` | Use `selector` in every overload. | All overloads accept a structured `PacketSelector`. | |
| `inventory.equipByEnhancement(query: ScriptEquipEnhancementSelector)` | Use `inventory.equipByEnhancement(selector)`. | The input is already a structured selector and requires no query normalization. | |
| `LiveItem.matches(selector: ItemQuery \| ShopItemQuery)` and `LiveMonster.matches(selector: MonsterQuery)` | Rename the parameters to `query`. | Both methods accept shorthand strings and numbers as well as selector objects. | These parameter names are part of the generated scripting declarations. |
| `combat.hunt(query)`, `kill(query)`, `killForItem(query, ...)`, and `killForTempItem(query, ...)` | Use `target` for each combat action. | `target` describes the role of the input. The accepted `combat.attack(target)` rename and the Army combat functions already use it. | This does not decide the open `killForItem()` argument shape. |
| Backing flash APIs and stores often call an `ItemQuery`, `ShopItemQuery`, or `MonsterQuery` parameter `selector` | Use `query` until calling `toItemSelector()` or `toMonsterSelector()`; use `selector` for the normalized value after that point. | The current naming blurs the boundary between permissive script input and the structured object sent across the bridge. Inferred internal service signatures can also reach scripting wrappers. | Applies to Bank, Inventory, Drops, House, temporary inventory, Shops, Monsters, Combat, Store, live-model matching, and the scripting Players wrapper. |
| `players.getMe()` | Remove it; use `player.get()`. | It is an exact cross-namespace alias. | |
| `player.getHp()`, `getMaxHp()`, `getMp()`, `getMaxMp()`, `getLevel()`, `getPosition()`, `getState()`, and `isAfk()` mirror fields on `player.get()` | Read those fields from `player.get()`. Keep derived or bridge-backed helpers such as `isAlive()`, `isReady()`, `getCell()`, and `getPad()`. | The mirror functions fabricate zero, idle, false, or zero-position values when no player exists. | |
| `map.getId()`, `getName()`, and `getRoomNumber()` | Add `map.get(): Effect<MapSnapshot \| null>`. | One nullable record avoids fragmented reads and unloaded-state sentinels. | |
| `quests.getAll()` | Rename it to `quests.getLoaded()`. | It returns only projected or cached quests, not every quest in the game. | |
| `quests.loadBatch()` filters and deduplicates IDs before returning a boolean array | Preserve input order and result length, or return results keyed by quest ID. | Callers cannot currently correlate each result with the supplied input. | The eventual function name also depends on the `Batch` versus `Many` decision. |
| `bank.load(force?)` | Use `bank.load({ force? })`. | `load(true)` does not explain the mode at the call site. | Reviewed separately from the other optional boolean arguments. |
| `player.outfits.equip(name, keepColors?)` | Use `player.outfits.equip(name, { keepColors? })`. | The option describes behavior rather than a primary operand. | Reviewed separately from `wear()`. |
| `player.outfits.wear(name, keepColors?)` | Use `player.outfits.wear(name, { keepColors? })`. | The option describes behavior rather than a primary operand. | Reviewed separately from `equip()`. |
| `quests.accept(questId, silent?)` | Use `quests.accept(questId, { silent? })`. | A boolean literal does not say that it suppresses quest UI. | Reviewed separately from the collection form. |
| `quests.acceptBatch(questIds, silent?)` | Use `quests.acceptBatch(questIds, { silent? })`, subject to the `Many` naming decision. | The same mode should have the same named shape in the single and collection functions. | Reviewed separately from `accept()`. |
| `quests.load(questId, silent?)` | Use `quests.load(questId, { silent? })`. | A boolean literal does not say that it suppresses quest UI. | Reviewed separately from the collection form. |
| `quests.loadBatch(questIds, silent?)` | Use `quests.loadBatch(questIds, { silent? })`, subject to the `Many` naming decision. | The same mode should have the same named shape in the single and collection functions. | Reviewed separately from `load()`. |
| `wait.isGameActionAvailable()` | Either leave it under `wait` or move it to `map.isGameActionAvailable()`. | The underlying flash operation is `world.isActionAvailable`, but the function is also a readiness wait concern. | Keeping the function public is decided; only its namespace remains open. |
