declare const schemaType: unique symbol;
declare const brandType: unique symbol;

export type Path = readonly (string | number)[];
export type IssueCode =
  | "missing"
  | "invalid_type"
  | "invalid_value"
  | "invalid_format"
  | "too_small"
  | "too_big"
  | "not_multiple_of"
  | "unrecognized_key"
  | "invalid_key"
  | "invalid_union"
  | "duplicate_key"
  | "duplicate_value"
  | "invalid_json"
  | "cyclic_reference"
  | "max_depth"
  | "custom";

export interface Issue {
  readonly code: IssueCode;
  readonly path: Path;
  readonly message: string;
  readonly rule?: string;
  readonly expected?: string;
  readonly received?: string;
  readonly branches?: readonly (readonly Issue[])[];
}

export interface IssueInput {
  readonly message: string;
  readonly path?: Path;
  readonly rule?: string;
}

export interface MessageOptions {
  readonly message?: string;
}
export interface RefineOptions extends MessageOptions {
  readonly path?: Path;
  readonly rule?: string;
}
export interface ParseOptions {
  readonly errors?: "first" | "all";
  readonly maxIssues?: number;
  readonly maxDepth?: number;
  readonly message?: (issue: Issue) => string | undefined;
}
export type ParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly Issue[] };
export interface CheckContext {
  readonly path: Path;
  readonly addIssue: (issue: IssueInput) => void;
}
export interface RecoveryContext {
  readonly input: unknown;
  readonly issues: readonly Issue[];
}
export type Metadata = Readonly<Record<string, unknown>>;
export type Brand<T, Name extends string> = T & { readonly [brandType]: Name };
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AnySchema {
  readonly [schemaType]: {
    readonly output: unknown;
    readonly input: unknown;
    readonly optionalOutput: boolean;
    readonly optionalInput: boolean;
  };
}
export type Infer<S extends AnySchema> = S[typeof schemaType]["output"];
export type Input<S extends AnySchema> = S[typeof schemaType]["input"];
export type OptionalOutput<S extends AnySchema> =
  S[typeof schemaType]["optionalOutput"];
export type OptionalInput<S extends AnySchema> =
  S[typeof schemaType]["optionalInput"];

/** Immutable schema. Defaults and recovery supply input that is parsed again. */
export interface Schema<
  Output,
  Input = Output,
  OptionalOut extends boolean = false,
  OptionalIn extends boolean = OptionalOut,
> extends AnySchema {
  readonly [schemaType]: {
    readonly output: Output;
    readonly input: Input;
    readonly optionalOutput: OptionalOut;
    readonly optionalInput: OptionalIn;
  };
  parse(input: unknown, options?: ParseOptions): Output;
  safeParse(input: unknown, options?: ParseOptions): ParseResult<Output>;
  /** Checks accepted input; it does not replace the input with decoded output. */
  is(input: unknown): input is Input;
  optional(): Schema<Output | undefined, Input | undefined, true, true>;
  optionalKey(): Schema<Output, Input, true, true>;
  nullable(): Schema<Output | null, Input | null, OptionalOut, OptionalIn>;
  nullish(): Schema<
    Output | null | undefined,
    Input | null | undefined,
    true,
    true
  >;
  required(): Schema<Exclude<Output, undefined>, Exclude<Input, undefined>>;
  nonnullable(): Schema<
    Exclude<Output, null>,
    Exclude<Input, null>,
    OptionalOut,
    OptionalIn
  >;
  default(
    value: Input | (() => Input),
  ): Schema<Output, Input | undefined, false, true>;
  catch(
    value: Input | ((context: RecoveryContext) => Input),
  ): Schema<Output, unknown, false, true>;
  refine<Narrowed extends Output>(
    predicate: (value: Output) => value is Narrowed,
    options?: RefineOptions,
  ): Schema<Narrowed, Input, OptionalOut, OptionalIn>;
  refine(
    predicate: (value: Output) => boolean,
    options?: RefineOptions,
  ): Schema<Output, Input, OptionalOut, OptionalIn>;
  check(
    callback: (value: Output, context: CheckContext) => void,
  ): Schema<Output, Input, OptionalOut, OptionalIn>;
  transform<Next>(
    callback: (value: Output, context: CheckContext) => Next,
  ): Schema<Exclude<Next, typeof INVALID>, Input, OptionalOut, OptionalIn>;
  preprocess(
    callback: (value: unknown, context: CheckContext) => unknown,
  ): Schema<Output, unknown, OptionalOut, true>;
  pipe<Next extends AnySchema>(
    schema: Next & (Output extends InputOf<Next> ? unknown : never),
  ): Schema<Infer<Next>, Input, OptionalOutput<Next>, OptionalIn>;
  brand<const Name extends string>(
    name: Name,
  ): Schema<Brand<Output, Name>, Input, OptionalOut, OptionalIn>;
  readonly(): Schema<Readonly<Output>, Input, OptionalOut, OptionalIn>;
  describe(text: string): Schema<Output, Input, OptionalOut, OptionalIn>;
  meta(metadata: Metadata): Schema<Output, Input, OptionalOut, OptionalIn>;
  readonly description: string | undefined;
  readonly metadata: Metadata;
}

type InputOf<S extends AnySchema> = Input<S>;

export interface StringSchema<I = string> extends Schema<string, I> {
  min(length: number, options?: MessageOptions): StringSchema<I>;
  max(length: number, options?: MessageOptions): StringSchema<I>;
  length(length: number, options?: MessageOptions): StringSchema<I>;
  regex(pattern: RegExp, options?: MessageOptions): StringSchema<I>;
  startsWith(value: string, options?: MessageOptions): StringSchema<I>;
  endsWith(value: string, options?: MessageOptions): StringSchema<I>;
  includes(value: string, options?: MessageOptions): StringSchema<I>;
  trim(): StringSchema<I>;
  toLowerCase(): StringSchema<I>;
  toUpperCase(): StringSchema<I>;
  normalize(form?: "NFC" | "NFD" | "NFKC" | "NFKD"): StringSchema<I>;
}

export interface NumberSchema<I = number> extends Schema<number, I> {
  int(options?: MessageOptions): NumberSchema<I>;
  min(value: number, options?: MessageOptions): NumberSchema<I>;
  max(value: number, options?: MessageOptions): NumberSchema<I>;
  gt(value: number, options?: MessageOptions): NumberSchema<I>;
  lt(value: number, options?: MessageOptions): NumberSchema<I>;
  multipleOf(value: number, options?: MessageOptions): NumberSchema<I>;
}
export interface DateSchema<I = Date> extends Schema<Date, I> {
  min(value: Date, options?: MessageOptions): DateSchema<I>;
  max(value: Date, options?: MessageOptions): DateSchema<I>;
  gt(value: Date, options?: MessageOptions): DateSchema<I>;
  lt(value: Date, options?: MessageOptions): DateSchema<I>;
}

export type Shape = Readonly<Record<string, AnySchema>>;
type Simplify<T> = { [K in keyof T]: T[K] };
export type ObjectOutput<F extends Shape> = Simplify<
  {
    [K in keyof F as OptionalOutput<F[K]> extends true ? never : K]: Infer<
      F[K]
    >;
  } & {
    [K in keyof F as OptionalOutput<F[K]> extends true ? K : never]?: Infer<
      F[K]
    >;
  }
>;
export type ObjectInput<F extends Shape> = Simplify<
  {
    [K in keyof F as OptionalInput<F[K]> extends true ? never : K]: Input<F[K]>;
  } & {
    [K in keyof F as OptionalInput<F[K]> extends true ? K : never]?: Input<
      F[K]
    >;
  }
>;
type PartialFields<F extends Shape, K extends keyof F> = {
  [P in keyof F]: P extends K
    ? Schema<Infer<F[P]> | undefined, Input<F[P]> | undefined, true, true>
    : F[P];
};
type RequiredFields<F extends Shape, K extends keyof F> = {
  [P in keyof F]: P extends K
    ? Schema<Exclude<Infer<F[P]>, undefined>, Exclude<Input<F[P]>, undefined>>
    : F[P];
};

export interface ObjectSchema<
  F extends Shape,
  Extra = unknown,
  KeepExtra extends boolean = false,
> extends Omit<
  Schema<
    ObjectOutput<F> &
      (KeepExtra extends true
        ? Record<string, Extra | Infer<F[keyof F]>>
        : unknown),
    ObjectInput<F> &
      (KeepExtra extends true ? Record<string, unknown> : unknown)
  >,
  "required"
> {
  readonly shape: F;
  extend<const Added extends Shape>(
    fields: Added,
  ): ObjectSchema<Simplify<Omit<F, keyof Added> & Added>, Extra, KeepExtra>;
  pick<const K extends readonly (keyof F & string)[]>(
    keys: K,
  ): ObjectSchema<Pick<F, K[number]>, Extra, KeepExtra>;
  omit<const K extends readonly (keyof F & string)[]>(
    keys: K,
  ): ObjectSchema<Omit<F, K[number]>, Extra, KeepExtra>;
  partial<K extends keyof F & string = keyof F & string>(
    keys?: readonly K[],
  ): ObjectSchema<PartialFields<F, K>, Extra, KeepExtra>;
  required<K extends keyof F & string = keyof F & string>(
    keys?: readonly K[],
  ): ObjectSchema<RequiredFields<F, K>, Extra, KeepExtra>;
  strip(): ObjectSchema<F>;
  strict(): ObjectSchema<F>;
  passthrough(): ObjectSchema<F, unknown, true>;
  catchall<S extends AnySchema>(schema: S): ObjectSchema<F, Infer<S>, true>;
  keyof(): EnumSchema<readonly (keyof F & string)[]>;
}

export interface ArraySchema<S extends AnySchema> extends Schema<
  Infer<S>[],
  Input<S>[]
> {
  readonly element: S;
  min(length: number, options?: MessageOptions): ArraySchema<S>;
  max(length: number, options?: MessageOptions): ArraySchema<S>;
  length(length: number, options?: MessageOptions): ArraySchema<S>;
  unique(
    keySelector?: (value: Infer<S>) => unknown,
    options?: MessageOptions,
  ): ArraySchema<S>;
}
type TupleOutput<S extends readonly AnySchema[]> = S extends readonly [
  infer H extends AnySchema,
  ...infer T extends readonly AnySchema[],
]
  ? OptionalOutput<H> extends true
    ? [Infer<H>?, ...TupleOutput<T>]
    : [Infer<H>, ...TupleOutput<T>]
  : [];
type TupleInput<S extends readonly AnySchema[]> = S extends readonly [
  infer H extends AnySchema,
  ...infer T extends readonly AnySchema[],
]
  ? OptionalInput<H> extends true
    ? [Input<H>?, ...TupleInput<T>]
    : [Input<H>, ...TupleInput<T>]
  : [];
export interface TupleSchema<
  S extends readonly AnySchema[],
  R extends AnySchema = Schema<never>,
> extends Schema<
  [...TupleOutput<S>, ...Infer<R>[]],
  [...TupleInput<S>, ...Input<R>[]]
> {
  readonly items: S;
  rest<Next extends AnySchema>(schema: Next): TupleSchema<S, Next>;
}
export interface RecordSchema<
  K extends AnySchema,
  V extends AnySchema,
> extends Schema<
  Partial<Record<Extract<Infer<K>, string>, Infer<V>>>,
  Partial<Record<Extract<Input<K>, string>, Input<V>>>
> {
  readonly key: K;
  readonly value: V;
  min(size: number, options?: MessageOptions): RecordSchema<K, V>;
  max(size: number, options?: MessageOptions): RecordSchema<K, V>;
  size(size: number, options?: MessageOptions): RecordSchema<K, V>;
}
export interface EnumSchema<
  V extends readonly (string | number)[],
> extends Schema<V[number]> {
  readonly values: V;
}

export declare const INVALID: unique symbol;
export declare class ValidationError extends Error {
  readonly issues: readonly Issue[];
  constructor(issues: readonly Issue[]);
}
export declare class SchemaUsageError extends Error {}
export declare function formatIssues(issues: readonly Issue[]): string;
export declare function formatPath(path: Path): string;
export declare function isSchema(value: unknown): value is AnySchema;

export declare function string(options?: MessageOptions): StringSchema;
export declare function number(options?: MessageOptions): NumberSchema;
export declare function boolean(options?: MessageOptions): Schema<boolean>;
export declare function date(options?: MessageOptions): DateSchema;
declare function nullSchema(options?: MessageOptions): Schema<null>;
declare function undefinedSchema(options?: MessageOptions): Schema<undefined>;
declare function unknownSchema(): Schema<unknown>;
declare function neverSchema(options?: MessageOptions): Schema<never>;
export {
  nullSchema as null,
  undefinedSchema as undefined,
  unknownSchema as unknown,
  neverSchema as never,
};
export declare function literal<
  const V extends string | number | boolean | null | undefined,
>(value: V, options?: MessageOptions): Schema<V>;
declare function enumSchema<const V extends readonly (string | number)[]>(
  values: V,
  options?: MessageOptions,
): EnumSchema<V>;
export { enumSchema as enum };
export declare function object<const F extends Shape>(
  fields: F,
  options?: MessageOptions,
): ObjectSchema<F>;
export declare function array<S extends AnySchema>(
  element: S,
  options?: MessageOptions,
): ArraySchema<S>;
export declare function tuple<const S extends readonly AnySchema[]>(
  elements: S,
  options?: MessageOptions,
): TupleSchema<S>;
export declare function record<V extends AnySchema>(
  value: V,
  options?: MessageOptions,
): RecordSchema<StringSchema, V>;
export declare function record<K extends AnySchema, V extends AnySchema>(
  key: K & (Infer<K> extends string ? unknown : never),
  value: V,
  options?: MessageOptions,
): RecordSchema<K, V>;
export declare function union<const S extends readonly AnySchema[]>(
  members: S,
  options?: MessageOptions,
): Schema<Infer<S[number]>, Input<S[number]>>;
export declare function discriminatedUnion<
  const S extends readonly ObjectSchema<Shape>[],
>(
  key: string,
  members: S,
  options?: MessageOptions,
): Schema<Infer<S[number]>, Input<S[number]>>;
export declare function lazy<S extends AnySchema>(
  factory: () => S,
): Schema<Infer<S>, Input<S>, OptionalOutput<S>, OptionalInput<S>>;
export declare function instanceOf<Args extends unknown[], T>(
  constructor: abstract new (...args: Args) => T,
  options?: MessageOptions,
): Schema<T>;
export declare function custom<T>(
  predicate: (value: unknown) => value is T,
  options?: MessageOptions,
): Schema<T>;
export declare function custom(
  predicate: (value: unknown) => boolean,
  options?: MessageOptions,
): Schema<unknown>;
export declare function jsonValue(): Schema<JsonValue>;
export declare function json<S extends AnySchema>(
  schema: S,
  options?: MessageOptions,
): Schema<Infer<S>, string>;
export declare const coerce: {
  readonly string: (
    options?: MessageOptions,
  ) => StringSchema<string | number | boolean>;
  readonly number: (options?: MessageOptions) => NumberSchema<string | number>;
  readonly boolean: (
    options?: MessageOptions,
  ) => Schema<boolean, boolean | 0 | 1 | "0" | "1" | "false" | "true">;
  readonly date: (
    options?: MessageOptions,
  ) => DateSchema<Date | number | string>;
};
