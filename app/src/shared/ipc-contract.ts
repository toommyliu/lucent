export interface IpcInvokeContract<Args extends readonly unknown[], Return> {
  readonly channel: string;
  readonly parseArgs: (args: readonly unknown[]) => Args;
  readonly parseReturn: (value: unknown) => Return;
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
