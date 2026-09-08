# `@lucent/dailies`

```js
const { spinWheelOfDoom } = require("@lucent/dailies");

module.exports = function* run() {
  return yield* spinWheelOfDoom({ bankRewards: true });
};
```

`spinWheelOfDoom` attempts the member-daily spin first, followed by the weekly
spin when the account has three Gear of Doom. It returns a separate outcome for
each attempt.
