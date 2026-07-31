#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const docsPath = "docs/";
const docsRelevantFiles = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/docgen.ts",
  "scripts/gen-script-types.ts",
  "scripts/vercel-docs-ignore.mjs",
  "vercel.json",
]);

const run = (command, args, options = {}) =>
  spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });

const hasRef = (ref) => run("git", ["rev-parse", "--verify", ref]).status === 0;

const splitLines = (value) => value.trim().split(/\r?\n/).filter(Boolean);

const isDocsRelevantPath = (path) =>
  path.startsWith(docsPath) || docsRelevantFiles.has(path);

const pathsFromNameStatus = (value) =>
  splitLines(value).flatMap((line) => {
    const [, ...paths] = line.split("\t");
    return paths;
  });

const listChangedFiles = (baseRef, headRef) => {
  const result = run("git", ["diff", "--name-status", baseRef, headRef]);

  return result.status === 0 ? pathsFromNameStatus(result.stdout) : null;
};

const ensureCommitParent = (commitRef) => {
  const parentRef = `${commitRef}^`;
  if (hasRef(parentRef)) {
    return parentRef;
  }

  const currentBranch = process.env.VERCEL_GIT_COMMIT_REF;
  if (currentBranch) {
    run("git", ["fetch", "--deepen=50", "origin", currentBranch], { stdio: "ignore" });
  }

  return hasRef(parentRef) ? parentRef : null;
};

const shouldBuild = () => {
  const commitRef = process.env.VERCEL_GIT_COMMIT_SHA || "HEAD";
  const parentRef = ensureCommitParent(commitRef);

  if (!parentRef) {
    console.warn(
      "Unable to find the parent commit while checking docs-relevant changes; building to avoid skipping a content update.",
    );
    return true;
  }

  const changedFiles = listChangedFiles(parentRef, commitRef);
  if (!changedFiles) {
    console.warn(
      "Unable to read changed files while checking docs-relevant changes; building to avoid skipping a content update.",
    );
    return true;
  }

  const changedDocsFiles = changedFiles.filter(isDocsRelevantPath);
  if (changedDocsFiles.length === 0) {
    console.log("No docs-relevant changes detected; skipping Vercel build.");
    return false;
  }

  console.log("Docs-relevant files changed; Vercel build should run:");
  for (const file of changedDocsFiles) {
    console.log(`- ${file}`);
  }
  return true;
};

process.exit(shouldBuild() ? 1 : 0);
