import { parse } from "acorn";
import {
  normalizeScriptInputsDefinition,
  type ScriptInputsDefinition,
} from "../../../shared/script-inputs";
import { roundTimingMs, timingNow } from "../../timing";

export class ScriptInputsExtractionError extends Error {
  override readonly name = "ScriptInputsExtractionError";
}

export interface ScriptInputsExtractionTimings {
  readonly parseMs: number;
  readonly validationMs: number;
  readonly totalMs: number;
  readonly declarationFound: boolean;
}

export interface ScriptInputsExtractionResult {
  readonly definition?: ScriptInputsDefinition;
  readonly timings: ScriptInputsExtractionTimings;
}

const SCRIPT_INPUT_DECLARATION_HINT =
  /module\s*\.\s*exports\s*(?:\.\s*inputs|\[\s*["']inputs["']\s*\])/;

interface SourceLocation {
  readonly start: {
    readonly line: number;
    readonly column: number;
  };
}

interface AstNode {
  readonly type: string;
  readonly loc?: SourceLocation | null;
  readonly [key: string]: unknown;
}

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly type?: unknown }).type === "string";

const locationLabel = (node: AstNode): string =>
  node.loc ? ` at ${node.loc.start.line}:${node.loc.start.column + 1}` : "";

const extractionError = (message: string, node?: AstNode): never => {
  throw new ScriptInputsExtractionError(
    `${message}${node === undefined ? "" : locationLabel(node)}`,
  );
};

const isIdentifier = (node: unknown, name: string): boolean =>
  isNode(node) && node.type === "Identifier" && node["name"] === name;

const isStaticPropertyName = (
  node: unknown,
  name: string,
  computed: boolean,
): boolean => {
  if (!computed) {
    return isIdentifier(node, name);
  }

  return isNode(node) && node.type === "Literal" && node["value"] === name;
};

const isModuleExports = (node: unknown): boolean => {
  if (!isNode(node) || node.type !== "MemberExpression") {
    return false;
  }

  return (
    isIdentifier(node["object"], "module") &&
    isStaticPropertyName(node["property"], "exports", node["computed"] === true)
  );
};

const isModuleExportsInputsAssignment = (node: AstNode): boolean => {
  if (node.type !== "AssignmentExpression" || node["operator"] !== "=") {
    return false;
  }

  const left = node["left"];
  if (!isNode(left) || left.type !== "MemberExpression") {
    return false;
  }

  return (
    isModuleExports(left["object"]) &&
    isStaticPropertyName(left["property"], "inputs", left["computed"] === true)
  );
};

const propertyKey = (property: AstNode): string => {
  const key = property["key"];
  if (property["computed"] === true) {
    return extractionError("Script input object keys must be static", property);
  }

  if (isNode(key) && key.type === "Identifier") {
    return String(key["name"]);
  }

  if (
    isNode(key) &&
    key.type === "Literal" &&
    typeof key["value"] === "string"
  ) {
    return key["value"];
  }

  return extractionError("Script input object keys must be strings", property);
};

const evaluateLiteralNode = (node: AstNode): unknown => {
  if (node.type === "Literal") {
    const value = node["value"];
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    return extractionError(
      "Script input literals must be JSON-compatible",
      node,
    );
  }

  if (node.type === "UnaryExpression") {
    const operator = node["operator"];
    const argument = node["argument"];
    if (
      (operator === "-" || operator === "+") &&
      isNode(argument) &&
      argument.type === "Literal" &&
      typeof argument["value"] === "number"
    ) {
      return operator === "-" ? -argument["value"] : argument["value"];
    }
  }

  if (node.type === "ArrayExpression") {
    const elements = node["elements"];
    if (!Array.isArray(elements)) {
      return extractionError("Script input arrays are invalid", node);
    }

    return elements.map((element: unknown) => {
      if (!isNode(element)) {
        return extractionError(
          "Script input arrays must not contain holes",
          node,
        );
      }
      return evaluateLiteralNode(element);
    });
  }

  if (node.type === "ObjectExpression") {
    const properties = node["properties"];
    if (!Array.isArray(properties)) {
      return extractionError("Script input objects are invalid", node);
    }

    const output: Record<string, unknown> = {};
    for (const property of properties as readonly unknown[]) {
      if (!isNode(property) || property.type !== "Property") {
        return extractionError(
          "Script input objects must not contain spreads",
          node,
        );
      }

      if (property["kind"] !== "init" || property["method"] === true) {
        return extractionError(
          "Script input object values must be plain values",
          property,
        );
      }

      const key = propertyKey(property);
      if (Object.prototype.hasOwnProperty.call(output, key)) {
        return extractionError(
          `Script input object contains duplicate key: ${key}`,
          property,
        );
      }

      const value = property["value"];
      if (!isNode(value)) {
        return extractionError(
          "Script input object values must be static",
          property,
        );
      }

      output[key] = evaluateLiteralNode(value);
    }

    return output;
  }

  return extractionError(
    "module.exports.inputs must be a static JSON-like object literal",
    node,
  );
};

const visit = (node: AstNode, onNode: (node: AstNode) => void): void => {
  onNode(node);

  for (const value of Object.values(node)) {
    if (isNode(value)) {
      visit(value, onNode);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          visit(item, onNode);
        }
      }
    }
  }
};

export const extractScriptInputsDefinitionWithTimings = (
  source: string,
  sourceName: string,
): ScriptInputsExtractionResult => {
  const totalStartedAt = timingNow();
  if (!SCRIPT_INPUT_DECLARATION_HINT.test(source)) {
    return {
      timings: {
        parseMs: 0,
        validationMs: 0,
        totalMs: roundTimingMs(timingNow() - totalStartedAt),
        declarationFound: false,
      },
    };
  }

  let program: AstNode;
  const parseStartedAt = timingNow();
  let parseMs = 0;
  try {
    program = parse(source, {
      allowHashBang: true,
      ecmaVersion: 2024,
      locations: true,
      sourceType: "script",
    }) as unknown as AstNode;
    parseMs = roundTimingMs(timingNow() - parseStartedAt);
  } catch (cause) {
    parseMs = roundTimingMs(timingNow() - parseStartedAt);
    const message =
      cause instanceof Error && cause.message !== ""
        ? cause.message
        : "Could not parse script source";
    throw new ScriptInputsExtractionError(
      `Could not inspect script inputs for ${sourceName}: ${message}`,
      { cause },
    );
  }

  let rawInputs: unknown;
  let found = false;
  visit(program, (node) => {
    if (!isModuleExportsInputsAssignment(node)) {
      return;
    }

    if (found) {
      extractionError("module.exports.inputs must only be assigned once", node);
    }

    const right = node["right"];
    if (!isNode(right)) {
      return extractionError(
        "module.exports.inputs must be a static object",
        node,
      );
    }

    rawInputs = evaluateLiteralNode(right);
    found = true;
  });

  if (!found) {
    return {
      timings: {
        parseMs,
        validationMs: 0,
        totalMs: roundTimingMs(timingNow() - totalStartedAt),
        declarationFound: false,
      },
    };
  }

  const validationStartedAt = timingNow();
  try {
    const definition = normalizeScriptInputsDefinition(rawInputs);
    const validationMs = roundTimingMs(timingNow() - validationStartedAt);
    return {
      definition,
      timings: {
        parseMs,
        validationMs,
        totalMs: roundTimingMs(timingNow() - totalStartedAt),
        declarationFound: true,
      },
    };
  } catch (cause) {
    const message =
      cause instanceof Error && cause.message !== ""
        ? cause.message
        : "Invalid script inputs";
    throw new ScriptInputsExtractionError(message, { cause });
  }
};

export const extractScriptInputsDefinition = (
  source: string,
  sourceName: string,
): ScriptInputsDefinition | undefined =>
  extractScriptInputsDefinitionWithTimings(source, sourceName).definition;
