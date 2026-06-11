#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

process.chdir(repoRoot);
await import("../../scripts/vercel-docs-ignore.mjs");
