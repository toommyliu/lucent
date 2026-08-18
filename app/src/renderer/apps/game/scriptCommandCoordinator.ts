/** Serializes every command that can replace or stop the local script run. */
export interface ScriptCommandCoordinator {
  readonly run: <Result>(command: () => Promise<Result>) => Promise<Result>;
}

export const makeScriptCommandCoordinator = (): ScriptCommandCoordinator => {
  let tail = Promise.resolve();

  return {
    run: <Result>(command: () => Promise<Result>): Promise<Result> => {
      const result = tail.then(command, command);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
};
