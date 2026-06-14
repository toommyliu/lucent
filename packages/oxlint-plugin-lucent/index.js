const { definePlugin, defineRule } = require("@oxlint/plugins");

const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

const EFFECT_RUNTIME_METHODS = new Set([
  "runCallback",
  "runFork",
  "runPromise",
  "runPromiseExit",
  "runSync",
  "runSyncExit",
  "unsafeRunCallback",
  "unsafeRunPromise",
  "unsafeRunSync",
]);

const getPropertyName = (property) => {
  if (
    property?.type === "Identifier" ||
    property?.type === "PrivateIdentifier"
  ) {
    return property.name;
  }
  if (
    (property?.type === "Literal" || property?.type === "StringLiteral") &&
    typeof property.value === "string"
  ) {
    return property.value;
  }
  return undefined;
};

const unwrapExpression = (node) => {
  let current = node;
  while (
    current?.type === "ChainExpression" ||
    current?.type === "TSNonNullExpression"
  ) {
    current = current.expression;
  }
  return current;
};

const getBannedRunner = (callee) => {
  const expression = unwrapExpression(callee);
  if (expression?.type !== "MemberExpression") {
    return undefined;
  }

  const object = unwrapExpression(expression.object);
  const propertyName = getPropertyName(expression.property);

  if (
    object?.type === "Identifier" &&
    object.name === "Effect" &&
    propertyName !== undefined &&
    EFFECT_RUNTIME_METHODS.has(propertyName)
  ) {
    return `Effect.${propertyName}`;
  }

  if (
    object?.type === "Identifier" &&
    object.name === "ManagedRuntime" &&
    propertyName === "make"
  ) {
    return "ManagedRuntime.make";
  }

  return undefined;
};

const noManualEffectRuntimeInTests = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow manual Effect runtime runners in tests; use @effect/vitest instead.",
    },
  },
  create(context) {
    if (!TEST_FILE_PATTERN.test(context.filename)) {
      return {};
    }

    return {
      CallExpression(node) {
        const runner = getBannedRunner(node.callee);
        if (runner === undefined) {
          return;
        }

        context.report({
          node: node.callee,
          message: `Do not use ${runner} in tests. Use @effect/vitest with it.effect(...) or it.layer(...) instead.`,
        });
      },
    };
  },
});

module.exports = definePlugin({
  meta: {
    name: "lucent",
  },
  rules: {
    "no-manual-effect-runtime-in-tests": noManualEffectRuntimeInTests,
  },
});
