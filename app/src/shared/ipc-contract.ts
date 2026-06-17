import { Effect, Schema } from "effect";

export interface IpcInvokeContract<Args extends readonly unknown[], Return> {
  readonly channel: string;
  readonly parseArgs: (args: readonly unknown[]) => Args;
  readonly parseReturn: (value: unknown) => Return;
}

export interface DesktopIpcInvokeContract<
  Args extends readonly unknown[],
  Return,
> extends IpcInvokeContract<Args, Return> {
  readonly decodeArgsEffect: (
    args: readonly unknown[],
  ) => Effect.Effect<Args, Schema.SchemaError>;
  readonly encodeReturnEffect: (
    value: Return,
  ) => Effect.Effect<unknown, Schema.SchemaError>;
  readonly decodeReturnEffect: (
    value: unknown,
  ) => Effect.Effect<Return, Schema.SchemaError>;
}

export type IpcValueParser<A> = (value: unknown) => A;
export type IpcArgsParser<Args extends readonly unknown[]> = (
  channel: string,
  args: readonly unknown[],
) => Args;

export const defineIpcInvokeContract = <
  Args extends readonly unknown[],
  Return,
>(options: {
  readonly channel: string;
  readonly parseArgs: IpcArgsParser<Args>;
  readonly parseReturn: IpcValueParser<Return>;
}): IpcInvokeContract<Args, Return> => ({
  channel: options.channel,
  parseArgs: (args) => options.parseArgs(options.channel, args),
  parseReturn: options.parseReturn,
});

export const defineDesktopIpcInvokeContract = <
  Args extends readonly unknown[],
  Return,
>(options: {
  readonly channel: string;
  readonly argsSchema: Schema.Codec<Args, unknown, never, never>;
  readonly returnSchema: Schema.Codec<Return, unknown, never, never>;
  readonly parseArgs?: IpcArgsParser<Args>;
  readonly parseReturn?: IpcValueParser<Return>;
}): DesktopIpcInvokeContract<Args, Return> => {
  const decodeArgs = Schema.decodeUnknownEffect(options.argsSchema);
  const encodeReturn = Schema.encodeUnknownEffect(options.returnSchema);
  const decodeReturn = Schema.decodeUnknownEffect(options.returnSchema);

  const decodeArgsEffect = (
    args: readonly unknown[],
  ): Effect.Effect<Args, Schema.SchemaError> =>
    decodeArgs(args).pipe(
      Effect.map((decoded) =>
        options.parseArgs === undefined
          ? decoded
          : options.parseArgs(options.channel, decoded),
      ),
    );

  const decodeReturnEffect = (
    value: unknown,
  ): Effect.Effect<Return, Schema.SchemaError> =>
    decodeReturn(value).pipe(
      Effect.map((decoded) =>
        options.parseReturn === undefined
          ? decoded
          : options.parseReturn(decoded),
      ),
    );

  return {
    channel: options.channel,
    decodeArgsEffect,
    decodeReturnEffect,
    encodeReturnEffect: encodeReturn,
    parseArgs: (args) => Effect.runSync(decodeArgsEffect(args)),
    parseReturn: (value) => Effect.runSync(decodeReturnEffect(value)),
  };
};

const messageFromCause = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : String(cause);

const tupleLengthError = (
  channel: string,
  expected: number,
  actual: number,
): Error =>
  new Error(`${channel} expected ${expected} argument(s), received ${actual}`);

const parseArgument = <A>(
  channel: string,
  index: number,
  parse: IpcValueParser<A>,
  value: unknown,
): A => {
  try {
    return parse(value);
  } catch (cause) {
    throw new Error(
      `${channel} argument ${index}: ${messageFromCause(cause)}`,
      {
        cause,
      },
    );
  }
};

export const args0 = (): IpcArgsParser<[]> => (channel, args) => {
  if (args.length !== 0) {
    throw tupleLengthError(channel, 0, args.length);
  }

  return [];
};

export const args1 =
  <A>(parseA: IpcValueParser<A>): IpcArgsParser<[A]> =>
  (channel, args) => {
    if (args.length !== 1) {
      throw tupleLengthError(channel, 1, args.length);
    }

    return [parseArgument(channel, 0, parseA, args[0])];
  };

export const args2 =
  <A, B>(
    parseA: IpcValueParser<A>,
    parseB: IpcValueParser<B>,
  ): IpcArgsParser<[A, B]> =>
  (channel, args) => {
    if (args.length !== 2) {
      throw tupleLengthError(channel, 2, args.length);
    }

    return [
      parseArgument(channel, 0, parseA, args[0]),
      parseArgument(channel, 1, parseB, args[1]),
    ];
  };

export const voidReturn = (value: unknown): void => {
  if (value !== undefined) {
    throw new Error("Expected void return value");
  }
};

export const unknownReturn = <A = unknown>(value: unknown): A => value as A;

export const nullableReturn =
  <A>(parse: IpcValueParser<A>): IpcValueParser<A | null> =>
  (value) => {
    if (value === null) {
      return null;
    }

    return parse(value);
  };
