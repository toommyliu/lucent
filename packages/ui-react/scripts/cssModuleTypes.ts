import { glob, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { transform } from "lightningcss";
import type { Plugin } from "vite";

const moduleSuffix = ".module.css";
const declarationSuffix = ".d.ts";
const identifierPattern = /^[A-Za-z_$][\w$]*$/;

const isCssModule = (file: string): boolean => file.endsWith(moduleSuffix);

const renderDeclaration = (names: ReadonlyArray<string>): string => {
  const members = names.map(
    (name) =>
      `  readonly ${identifierPattern.test(name) ? name : JSON.stringify(name)}: string;`,
  );
  const body = members.length === 0 ? "{}" : `{\n${members.join("\n")}\n}`;
  return `declare const styles: ${body};\nexport default styles;\n`;
};

export async function writeCssModuleTypes(file: string): Promise<void> {
  const { exports } = transform({
    code: await readFile(file),
    cssModules: true,
    filename: file,
  });
  const declaration = renderDeclaration(Object.keys(exports ?? {}).sort());
  const target = `${file}${declarationSuffix}`;
  const current = await readFile(target, "utf8").catch(() => null);
  if (current !== declaration) {
    await writeFile(target, declaration);
  }
}

export async function syncCssModuleTypes(sourceDir: string): Promise<void> {
  const modules = new Set<string>();
  for await (const file of glob(`**/*${moduleSuffix}`, { cwd: sourceDir })) {
    modules.add(join(sourceDir, file));
  }
  for await (const file of glob(`**/*${moduleSuffix}${declarationSuffix}`, {
    cwd: sourceDir,
  })) {
    const declaration = join(sourceDir, file);
    if (!modules.has(declaration.slice(0, -declarationSuffix.length))) {
      await rm(declaration, { force: true });
    }
  }
  await Promise.all([...modules].map(writeCssModuleTypes));
}

export function cssModuleTypes(sourceDir: string): Plugin {
  return {
    name: "lucent:css-module-types",
    async buildStart() {
      await syncCssModuleTypes(sourceDir);
    },
    configureServer(server) {
      const regenerate = (file: string): void => {
        if (!isCssModule(file)) {
          return;
        }
        writeCssModuleTypes(file).catch((cause: unknown) => {
          server.config.logger.error(
            `Failed to generate CSS module types for ${file}: ${String(cause)}`,
          );
        });
      };
      server.watcher.on("add", regenerate);
      server.watcher.on("change", regenerate);
      server.watcher.on("unlink", (file) => {
        if (isCssModule(file)) {
          void rm(`${file}${declarationSuffix}`, { force: true });
        }
      });
    },
  };
}
