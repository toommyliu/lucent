import * as acorn from "acorn";
import { Context, Effect, Layer, Option, Schema } from "effect";

import {
  ScriptInputsDefinitionSchema,
  type ScriptInputsDefinition,
  type ScriptInputField,
} from "../../shared/scriptInputs";

type AstNode = acorn.Node & Record<string, unknown>;

const inputExtractorOperationSchema = Schema.Literals([
  "parse",
  "static-evaluate",
  "validate",
]);

export class ScriptInputsExtractorError extends Schema.TaggedErrorClass<ScriptInputsExtractorError>()(
  "ScriptInputsExtractorError",
  {
    operation: inputExtractorOperationSchema,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface ScriptInputsExtractorShape {
  readonly extract: (
    source: string,
    fallbackId: string,
  ) => Effect.Effect<ScriptInputsDefinition | null, ScriptInputsExtractorError>;
}

export class ScriptInputsExtractor extends Context.Service<
  ScriptInputsExtractor,
  ScriptInputsExtractorShape
>()("lucent/desktop/scripting/ScriptInputsExtractor") {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly type?: unknown }).type === "string";

const staticError = (detail: string, cause?: unknown) =>
  new ScriptInputsExtractorError({
    operation: "static-evaluate",
    detail,
    ...(cause === undefined ? {} : { cause }),
  });

const validationError = (detail: string, cause?: unknown) =>
  new ScriptInputsExtractorError({
    operation: "validate",
    detail,
    ...(cause === undefined ? {} : { cause }),
  });

const keyName = (property: AstNode): string => {
  const computed = property["computed"] === true;
  if (computed) {
    throw staticError("Computed properties are not supported in inputs.");
  }

  const key = property["key"];
  if (!isNode(key)) {
    throw staticError("Input object property key is invalid.");
  }

  if (key.type === "Identifier") {
    return String(key["name"]);
  }

  if (key.type === "Literal") {
    const value = key["value"];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }

  throw staticError("Input object property key must be static.");
};

const evaluateStaticExpression = (node: AstNode): unknown => {
  switch (node.type) {
    case "ArrayExpression":
      return (node["elements"] as readonly unknown[]).map((element) => {
        if (!isNode(element)) {
          throw staticError("Input arrays cannot contain holes.");
        }
        return evaluateStaticExpression(element);
      });

    case "Literal":
      return node["value"];

    case "ObjectExpression": {
      const object: Record<string, unknown> = {};
      for (const rawProperty of node["properties"] as readonly unknown[]) {
        if (!isNode(rawProperty) || rawProperty.type === "SpreadElement") {
          throw staticError("Input objects cannot use spread properties.");
        }

        const name = keyName(rawProperty);
        if (Object.hasOwn(object, name)) {
          throw staticError(`Duplicate input object key: ${name}.`);
        }

        const value = rawProperty["value"];
        if (!isNode(value)) {
          throw staticError(`Input object property ${name} is invalid.`);
        }
        object[name] = evaluateStaticExpression(value);
      }
      return object;
    }

    default:
      throw staticError("Script inputs must be a static object expression.");
  }
};

const isModuleExportsInputsAssignment = (node: AstNode): boolean => {
  if (node.type !== "AssignmentExpression" || node["operator"] !== "=") {
    return false;
  }

  const left = node["left"];
  if (!isNode(left) || left.type !== "MemberExpression") {
    return false;
  }

  if (left["computed"] === true) {
    return false;
  }

  const property = left["property"];
  if (
    !isNode(property) ||
    property.type !== "Identifier" ||
    property["name"] !== "inputs"
  ) {
    return false;
  }

  const object = left["object"];
  if (!isNode(object) || object.type !== "MemberExpression") {
    return false;
  }

  if (object["computed"] === true) {
    return false;
  }

  const exportsProperty = object["property"];
  const moduleObject = object["object"];
  return (
    isNode(exportsProperty) &&
    exportsProperty.type === "Identifier" &&
    exportsProperty["name"] === "exports" &&
    isNode(moduleObject) &&
    moduleObject.type === "Identifier" &&
    moduleObject["name"] === "module"
  );
};

const findInputsExpression = (program: AstNode): Option.Option<AstNode> => {
  for (const statement of program["body"] as readonly unknown[]) {
    if (!isNode(statement) || statement.type !== "ExpressionStatement") {
      continue;
    }

    const expression = statement["expression"];
    if (isNode(expression) && isModuleExportsInputsAssignment(expression)) {
      const right = expression["right"];
      if (isNode(right)) {
        return Option.some(right);
      }
    }
  }

  return Option.none();
};

const assertUniqueFieldKeys = (definition: ScriptInputsDefinition): void => {
  const keys = new Set<string>();
  for (const field of definition.fields as readonly ScriptInputField[]) {
    if (keys.has(field.key)) {
      throw validationError(`Duplicate script input key: ${field.key}.`);
    }
    keys.add(field.key);
  }
};

const normalizeInputDefinitionValue = (
  value: unknown,
  fallbackId: string,
): unknown => {
  if (!isRecord(value)) {
    return value;
  }

  const definition: Record<string, unknown> = { ...value };
  if (!Object.hasOwn(definition, "id")) {
    definition["id"] = fallbackId;
  }

  return definition;
};

const normalizeDefinition = (
  value: unknown,
  fallbackId: string,
): Effect.Effect<ScriptInputsDefinition, ScriptInputsExtractorError> =>
  Schema.decodeUnknownEffect(ScriptInputsDefinitionSchema, {
    onExcessProperty: "error",
  })(normalizeInputDefinitionValue(value, fallbackId)).pipe(
    Effect.mapError((cause) =>
      validationError("Script inputs definition is invalid.", cause),
    ),
    Effect.tap((definition) =>
      Effect.try({
        try: () => {
          assertUniqueFieldKeys(definition);
        },
        catch: (cause) =>
          cause instanceof ScriptInputsExtractorError
            ? cause
            : validationError("Script inputs definition is invalid.", cause),
      }),
    ),
  );

const parseSource = (
  source: string,
): Effect.Effect<AstNode, ScriptInputsExtractorError> =>
  Effect.try({
    try: () =>
      acorn.parse(source, {
        ecmaVersion: "latest",
        sourceType: "script",
      }) as unknown as AstNode,
    catch: (cause) =>
      new ScriptInputsExtractorError({
        operation: "parse",
        detail: "Script source could not be parsed.",
        cause,
      }),
  });

export const layer = Layer.succeed(
  ScriptInputsExtractor,
  ScriptInputsExtractor.of({
    extract: (source, fallbackId) =>
      Effect.gen(function* () {
        const program = yield* parseSource(source);
        const expression = findInputsExpression(program);
        if (Option.isNone(expression)) {
          return null;
        }

        const value = yield* Effect.try({
          try: () => evaluateStaticExpression(expression.value),
          catch: (cause) =>
            cause instanceof ScriptInputsExtractorError
              ? cause
              : staticError(
                  "Script inputs could not be statically evaluated.",
                  cause,
                ),
        });

        return yield* normalizeDefinition(value, fallbackId);
      }),
  }),
);
