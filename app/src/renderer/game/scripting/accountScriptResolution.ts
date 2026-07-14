import type {
  ScriptFile,
  ScriptFileResolution,
} from "../../../shared/ipc/scripting";

export class AccountScriptResolutionError extends Error {
  constructor(failure: Extract<ScriptFileResolution, { status: "failed" }>) {
    super(failure.message);
    this.name = "AccountScriptResolutionError";
    if (failure.detailsText !== undefined) {
      this.stack = failure.detailsText;
    }
  }
}

export const resolveAccountScript = async (
  resolveFile: (path: string) => Promise<ScriptFileResolution>,
  path: string,
): Promise<ScriptFile | null> => {
  const resolution = await resolveFile(path);
  switch (resolution.status) {
    case "found":
      return resolution.file;
    case "missing":
      return null;
    case "failed":
      throw new AccountScriptResolutionError(resolution);
  }
};
