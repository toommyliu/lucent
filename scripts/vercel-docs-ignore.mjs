#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const docsPaths = [
  "docs/",
  "scripts/docgen.ts",
  "scripts/gen-script-types.ts",
  "scripts/ts-ast-utils.ts",
  "app/src/renderer/windows/game/",
  "app/src/shared/",
  "packages/game/src/",
  "packages/collection/src/",
];

const defaultBranch = process.env.VERCEL_GIT_PRODUCTION_BRANCH ?? "main";
const currentBranch = process.env.VERCEL_GIT_COMMIT_REF;

const run = (command, args, options = {}) =>
  spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });

const hasRef = (ref) => run("git", ["rev-parse", "--verify", ref]).status === 0;

const firstLine = (value) => value.trim().split(/\r?\n/, 1)[0] ?? "";

const changedSince = (base) =>
  run("git", ["diff", "--quiet", `${base}...HEAD`, "--", ...docsPaths]).status !== 0;

const changedInLastCommit = () => {
  if (!hasRef("HEAD^")) {
    return true;
  }

  return run("git", ["diff", "--quiet", "HEAD^", "HEAD", "--", ...docsPaths]).status !== 0;
};

const ensureDefaultBranch = () => {
  const remoteRef = `origin/${defaultBranch}`;
  if (hasRef(remoteRef)) {
    return remoteRef;
  }

  run("git", ["fetch", "--depth=100", "origin", defaultBranch], { stdio: "ignore" });
  return hasRef(remoteRef) ? remoteRef : null;
};

const shouldBuild = () => {
  if (currentBranch && currentBranch !== defaultBranch) {
    const defaultBranchRef = ensureDefaultBranch();
    if (!defaultBranchRef) {
      return true;
    }

    const mergeBase = firstLine(run("git", ["merge-base", "HEAD", defaultBranchRef]).stdout);
    return mergeBase ? changedSince(mergeBase) : true;
  }

  return changedInLastCommit();
};

process.exit(shouldBuild() ? 1 : 0);
