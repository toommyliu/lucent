import { mkdirSync, writeFileSync } from "fs";
import { EOL } from "os";
import { join } from "path";

import * as Schema from "effect/Schema";

const validTrustFileName = /^[a-zA-Z0-9-_.]+$/;

export class FlashTrustError extends Schema.TaggedError<FlashTrustError>()(
  "FlashTrustError",
  {
    operation: Schema.Literals(["mkdir", "read", "validate", "write"]),
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Flash trust ${this.operation} failed at ${this.path}.`;
  }
}

const trustDirectory = (rootPath: string): string =>
  join(rootPath, "#Security", "FlashPlayerTrust");

const trustFilePath = (rootPath: string, appName: string): string =>
  join(trustDirectory(rootPath), `${appName}.cfg`);

const assertValidAppName = (appName: string, path: string): void => {
  if (!validTrustFileName.test(appName)) {
    throw new FlashTrustError({
      operation: "validate",
      path,
      cause: new Error(
        "Trust file name must contain only letters, numbers, dots, hyphens, and underscores.",
      ),
    });
  }
};

export const writeTrustFile = (input: {
  readonly appName: string;
  readonly rootPath: string;
  readonly trustedPaths: readonly string[];
}): void => {
  const directory = trustDirectory(input.rootPath);
  const path = trustFilePath(input.rootPath, input.appName);
  assertValidAppName(input.appName, path);

  try {
    mkdirSync(directory, { recursive: true });
  } catch (cause) {
    throw new FlashTrustError({ operation: "mkdir", path: directory, cause });
  }

  try {
    writeFileSync(path, input.trustedPaths.join(EOL), "utf8");
  } catch (cause) {
    throw new FlashTrustError({ operation: "write", path, cause });
  }
};
