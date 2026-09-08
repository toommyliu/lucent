// @ts-check

const script = require("lucent/script");
const { spinWheelOfDoom } = require("@lucent/dailies");

function* run() {
  const bankRewards = (yield* script.inputs.get("bankRewards")) === true;
  const result = yield* spinWheelOfDoom({ bankRewards });
  // optionally:
  // yield* script.log(result);
  return result;
}

run.inputs = {
  id: "lucent-dailies-spin-wheel-of-doom",
  fields: [
    {
      key: "bankRewards",
      type: "boolean",
      label: "Bank rewards",
      description: "Deposit wheel rewards after each successful spin.",
      default: false,
    },
  ],
};

module.exports = run;
