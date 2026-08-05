import { join } from "path";

/** Resolves the user-owned directories shared by desktop scripting services. */
export const resolveScriptWorkspacePaths = (workspaceDir: string) =>
  ({
    packagesDir: join(workspaceDir, "packages"),
    scriptsDir: join(workspaceDir, "scripts"),
  }) as const;
