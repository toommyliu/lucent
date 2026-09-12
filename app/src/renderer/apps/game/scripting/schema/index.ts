import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Native from "effect/Schema";

import {
  ArrayImpl,
  ObjectImpl,
  RecordImpl,
  record,
  TupleImpl,
} from "./collections";
import {
  assertSync,
  baseDefinition,
  decode,
  declare,
  definitionOf,
  INVALID,
  isSchema,
  message,
  missingOf,
  stateOf,
  type Backend,
} from "./engine";
import {
  flatten,
  formatIssues,
  formatPath,
  fromIssues,
  issue,
  SchemaUsageError,
  ValidationError,
} from "./issues";
import {
  boolean,
  coerce,
  custom,
  date,
  DateImpl,
  EnumImpl,
  literal,
  number,
  NumberImpl,
  primitive,
  string,
  StringImpl,
} from "./primitives";
import type * as Public from "./public";
import { create, SchemaImpl } from "./Schema";

const union = (
  members: readonly unknown[],
  options?: Public.MessageOptions,
): SchemaImpl => {
  if (!Array.isArray(members) || members.length === 0)
    throw new SchemaUsageError("A union needs at least one schema.");
  const definitions = members.map(definitionOf);
  const text = message(
    options,
    "Expected one of the allowed values or shapes.",
  );
  return create(
    baseDefinition(
      declare((input, parseOptions) => {
        const failures = [];
        for (const definition of definitions) {
          const result = decode(definition.backend, input, parseOptions);
          if (Result.isSuccess(result)) return result;
          failures.push(result.failure);
        }
        return Result.fail(
          fromIssues([
            {
              code: "invalid_union",
              path: [],
              message: text,
              branches: failures.map((failure) =>
                flatten(failure, {
                  maxIssues: stateOf(parseOptions).maxIssues,
                }),
              ),
            },
          ]),
        );
      }),
    ),
  );
};

const discriminatedUnion = (
  key: string,
  members: readonly unknown[],
  options?: Public.MessageOptions,
): SchemaImpl => {
  if (
    typeof key !== "string" ||
    !Array.isArray(members) ||
    members.length === 0
  )
    throw new SchemaUsageError(
      "A discriminated union needs a key and object schemas.",
    );
  const branches = new Map<unknown, Backend>();
  for (const member of members) {
    if (!(member instanceof ObjectImpl))
      throw new SchemaUsageError(
        "Discriminated union members must be object schemas.",
      );
    const discriminator = definitionOf(member.shape[key]);
    if (
      discriminator.missing !== "reject" ||
      discriminator.literals === undefined
    ) {
      throw new SchemaUsageError(
        "A discriminator must be a required literal or enum.",
      );
    }
    for (const value of discriminator.literals) {
      if (branches.has(value))
        throw new SchemaUsageError("Discriminator values must be unique.");
      branches.set(value, definitionOf(member).backend);
    }
  }
  const text = message(options, `Use a recognized ${key} value.`);
  return create(
    baseDefinition(
      declare((input, parseOptions) => {
        if (!Predicate.isObject(input) || !Object.hasOwn(input, key))
          return Result.fail(issue("invalid_union", text, [key]));
        const backend = branches.get(input[key]);
        return backend === undefined
          ? Result.fail(issue("invalid_union", text, [key]))
          : decode(backend, input, parseOptions);
      }),
    ),
  );
};

const lazy = (factory: () => unknown): SchemaImpl => {
  if (!Predicate.isFunction(factory))
    throw new SchemaUsageError("A lazy schema needs a factory.");
  let resolved: ReturnType<typeof definitionOf> | undefined;
  let resolving = false;
  let resolvingMissing = false;
  const resolve = (): ReturnType<typeof definitionOf> => {
    if (resolved === undefined) {
      if (resolving)
        throw new SchemaUsageError(
          "A lazy factory cannot parse its own schema while resolving.",
        );
      resolving = true;
      try {
        resolved = definitionOf(assertSync(factory()));
      } finally {
        resolving = false;
      }
    }
    return resolved;
  };
  const active = new WeakMap<ReturnType<typeof stateOf>, Set<unknown>>();
  const backend = declare((input, options) => {
    const target = resolve();
    const state = stateOf(options);
    let inputs = active.get(state);
    if (inputs === undefined) {
      inputs = new Set();
      active.set(state, inputs);
    }
    if (inputs.has(input))
      return Result.fail(
        issue(
          "cyclic_reference",
          "A recursive schema revisited the same value.",
        ),
      );
    inputs.add(input);
    try {
      return decode(target.backend, input, options);
    } finally {
      inputs.delete(input);
    }
  });
  return create({
    ...baseDefinition(backend),
    missing: () => {
      if (resolving || resolvingMissing) return "reject";
      resolvingMissing = true;
      try {
        return missingOf(resolve());
      } finally {
        resolvingMissing = false;
      }
    },
  });
};

const json = (schema: unknown, options?: Public.MessageOptions): SchemaImpl => {
  const target = definitionOf(schema);
  const text = message(options, "Use valid JSON text.");
  return create(
    baseDefinition(
      declare((input, parseOptions) => {
        const accepted = decode(Native.String, input, parseOptions);
        if (Result.isFailure(accepted))
          return Result.fail(issue("invalid_type", "Expected JSON text."));
        let parsed: unknown;
        try {
          parsed = JSON.parse(accepted.success);
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          return Result.fail(issue("invalid_json", text));
        }
        return decode(target.backend, parsed, parseOptions);
      }),
    ),
  );
};

const jsonValue = (): SchemaImpl => {
  const scalar = Native.Union([
    Native.Null,
    Native.Boolean,
    Native.Finite,
    Native.String,
  ]);
  const value = lazy(() =>
    create(
      baseDefinition(
        declare((input, options) => {
          const backend = Array.isArray(input)
            ? arrayBackend
            : Predicate.isObject(input)
              ? recordBackend
              : scalar;
          return decode(backend, input, options);
        }),
      ),
    ),
  );
  const arrayBackend = definitionOf(new ArrayImpl(value)).backend;
  const recordBackend = definitionOf(new RecordImpl(string(), value)).backend;
  return value;
};

const instanceOf = (
  constructor: unknown,
  options?: Public.MessageOptions,
): SchemaImpl => {
  if (!Predicate.isFunction(constructor))
    throw new SchemaUsageError("Expected a class constructor.");
  return custom((value) => value instanceof constructor, options);
};

for (const implementation of [
  SchemaImpl,
  StringImpl,
  NumberImpl,
  DateImpl,
  ObjectImpl,
  ArrayImpl,
  RecordImpl,
  TupleImpl,
  EnumImpl,
]) {
  Object.freeze(implementation.prototype);
}

// The declaration contract carries inference without exposing Effect schemas or their ASTs.
export const scriptSchema = Object.freeze({
  string,
  number,
  boolean,
  date,
  literal,
  custom,
  instanceOf,
  union,
  discriminatedUnion,
  lazy,
  json,
  jsonValue,
  null: (options?: Public.MessageOptions) =>
    create(primitive(Native.Null, options)),
  undefined: (options?: Public.MessageOptions) =>
    create(primitive(Native.Undefined, options)),
  unknown: () => create(baseDefinition(Native.Unknown)),
  never: (options?: Public.MessageOptions) =>
    create(primitive(Native.Never, options)),
  enum: (
    values: readonly (string | number)[],
    options?: Public.MessageOptions,
  ) => new EnumImpl(values, options),
  object: (
    fields: Readonly<Record<string, unknown>>,
    options?: Public.MessageOptions,
  ) => new ObjectImpl(fields, "strip", options),
  array: (element: unknown, options?: Public.MessageOptions) =>
    new ArrayImpl(element, options),
  tuple: (elements: readonly unknown[], options?: Public.MessageOptions) =>
    new TupleImpl(elements, undefined, options),
  record,
  coerce,
  INVALID,
  isSchema,
  ValidationError,
  SchemaUsageError,
  formatIssues,
  formatPath,
} satisfies Record<keyof typeof Public, unknown>) as unknown as typeof Public;
