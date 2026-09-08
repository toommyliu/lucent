import fs from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import * as Schema from "effect/Schema";
import ts from "typescript";

import { ScriptPackageNameSchema } from "../packages/core/src/scriptPackages";

const decodeManifest = Schema.decodeUnknownSync(
  Schema.Struct({
    name: ScriptPackageNameSchema,
    description: Schema.optionalKey(Schema.String),
    version: Schema.optionalKey(Schema.String),
    types: Schema.optionalKey(Schema.String),
  }),
);

export interface ScriptPackageReference {
  readonly name: string;
  readonly description: string;
  readonly version: string | undefined;
  readonly route: string;
  readonly typesFile: string | undefined;
}

/** Discover bundled packages without loading or executing their JavaScript. */
export const discoverScriptPackages = async (
  repoRoot: string,
): Promise<readonly ScriptPackageReference[]> => {
  const root = join(repoRoot, "script-packages");
  const packages: ScriptPackageReference[] = [];
  const names = new Set<string>();
  const routes = new Set<string>();
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    const manifestPath = join(directory, "package.json");
    const manifest = decodeManifest(
      JSON.parse(await fs.readFile(manifestPath, "utf8")) as unknown,
    );
    const route = manifest.name.replace(/^@/, "");
    if (names.has(manifest.name) || routes.has(route.toLowerCase())) {
      throw new Error(
        `Duplicate script package name or documentation route: ${manifest.name}`,
      );
    }
    names.add(manifest.name);
    routes.add(route.toLowerCase());
    let typesFile: string | undefined;
    if (manifest.types !== undefined) {
      typesFile = resolve(directory, manifest.types);
      const path = relative(directory, typesFile);
      if (
        path === "" ||
        path.startsWith("..") ||
        isAbsolute(path) ||
        !/\.d\.[cm]?ts$/.test(path)
      ) {
        throw new Error(
          `${manifestPath}: types must name a declaration file inside the package`,
        );
      }
      await fs.access(typesFile);
    }
    packages.push({
      name: manifest.name,
      description: manifest.description ?? "",
      version: manifest.version,
      route,
      typesFile,
    });
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name));
};

/** Resolve the public module, preserving each package's own type names. */
export const getScriptPackageModule = (
  program: ts.Program,
  pkg: ScriptPackageReference,
): ts.Symbol | undefined => {
  if (pkg.typesFile === undefined) return undefined;
  const source = program.getSourceFile(pkg.typesFile);
  if (source === undefined) throw new Error(`Unable to load ${pkg.typesFile}`);
  const diagnostics = program.getSyntacticDiagnostics(source);
  if (diagnostics.length > 0) {
    throw new Error(
      `${pkg.typesFile}: ${diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n")}`,
    );
  }
  const checker = program.getTypeChecker();
  const declaration = source.statements.find(
    (statement): statement is ts.ModuleDeclaration =>
      ts.isModuleDeclaration(statement) &&
      ts.isStringLiteral(statement.name) &&
      statement.name.text === pkg.name,
  );
  const symbol =
    declaration === undefined
      ? checker.getSymbolAtLocation(source)
      : checker.getSymbolAtLocation(declaration.name);
  if (symbol === undefined) {
    throw new Error(
      `${pkg.typesFile} must export a module or declare module ${JSON.stringify(pkg.name)}`,
    );
  }
  return symbol;
};
