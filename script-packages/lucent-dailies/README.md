# `@lucent/dailies`

```js
const dailies = require("@lucent/dailies");

module.exports = function* run() {
  const eldersBlood = yield* dailies.farmEldersBlood();
  const wheelOfDoom = yield* dailies.spinWheelOfDoom({ bankRewards: true });
  return { eldersBlood, wheelOfDoom };
};
```

`farmEldersBlood` completes the Elders' Blood daily. It skips the quest when
Elders' Blood is already at its stack limit.

`spinWheelOfDoom` attempts the member-daily spin first, followed by the weekly
spin when the account has three Gear of Doom. It returns a separate outcome for
each attempt.
