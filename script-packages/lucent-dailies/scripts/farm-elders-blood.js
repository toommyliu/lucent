// @ts-check

const { farmEldersBlood } = require("@lucent/dailies");

function* run() {
  return yield* farmEldersBlood();
}

module.exports = run;
