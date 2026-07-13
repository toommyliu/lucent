# AGENTS.md

## Project

Lucent is a third-party toolkit for enhancing gameplay experiences in AdventureQuest Worlds (AQW).

## Priorities

Preserve correctness, reliability, and predictable behavior under load and during failures. Among designs that satisfy those requirements, prefer lower runtime and resource cost.

Prefer maintainable designs over short-term convenience. Extract shared logic when multiple call sites implement the same stable behavior and the abstraction improves ownership or testing. Do not generalize for speculative reuse.

Do not implement material changes outside the requested scope without approval.

## Validation

After code changes, run:

- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`

Run relevant tests when available. Report any command that cannot pass because of an unrelated existing failure.

## Package Roles

- `app/src/main`: Electron main process and native application services.
- `app/src/renderer`: SolidJS applications and client-side behavior.
- `app/src/shared`: IPC contracts and code shared between Electron processes.
- `packages/core`: Shared application schemas and domain types.
- `packages/game`: AQW game-domain models and types.
- `packages/ui`: Reusable SolidJS components, styles, and design tokens.

## Vendored Repositories

Treat `.repos/effect-smol/` as read-only reference material. Do not edit or import from it unless explicitly requested.

- When writing Effect (EffectTS) code, read `.repos/effect-smol/LLMS.md` first, then inspect `.repos/effect-smol/` for idiomatic APIs, tests, module structure, and patterns.
