# AGENTS.md

## Task Completion Requirements

- Before considering a task complete, `pnpm format`, `pnpm lint`, and `pnpm typecheck` must pass.

## Project Description

Lucent is a third-party toolkit for enhancing gameplay experiences in AdventureQuest Worlds (AQW).

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (unexpected failures, timeouts, disconnects, etc.).

Proposing sweeping changes that improve long-term maintainability is encouraged. If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `app/src/main` : The main entrypoint for the project. Contains the electron main process.
- `app/src/renderer`: The main entrypoint for the renderer process. Contains the SolidJS app(s) and related client side behaviors.
- `app/src/shared`: Shared code between main and renderer processes. This includes shared types, utilities, and any logic that needs to be used in both contexts.
- `packages/`: Shared packages consumed by the app.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding agents. Do not modify vendored repositories unless the user explicitly asks for that specific repository to be edited.

Use vendored repositories only as coding-agent reference material:

- Use `.repos/lucent` as the legacy Lucent repository when reviewing prior capabilities and behavior that may be worth porting into this fresh version. Do not reuse legacy implementation details such as class names, file names, folder architecture, module boundaries, naming conventions, etc...
- Use `.repos/aqw-client-decompiled` when checking AQW client behavior, packet shapes, game object names, UI symbols, or ActionScript implementation details.
- Use `.repos/Grimlite-Li` and `.repos/skua` as references for other popular AQW botting clients when comparing bot-client behavior, hooks, loaders, APIs, abstractions, script behavior, or implementation conventions.
- Use `.repos/effect-smol` when working with Effect Smol patterns, APIs, migrations, or package behavior.
- Use `.repos/t3code` as an example of Electron, TypeScript, and Effect architecture, patterns, and tooling.
