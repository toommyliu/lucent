# `@lucent/consumables`

A script package containing a loose script and library for obtaining Scrolls and Potions.

```js
const consumables = require("@lucent/consumables");

module.exports = function* run() {
  yield* consumables.ensure(
    [
      { item: "Malice Potion", quantity: 25 },
      { item: "Scroll of Enrage", quantity: 100 },
      { item: "Scroll of Life Steal", quantity: 99 },
    ],
    { potionMethod: "buy", mode: "farm", maxGold: 1_000_000 },
  );
};
```
