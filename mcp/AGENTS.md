# AGENTS.md

# Pages MCP Agent Instructions

Instructions for AI coding agents working in `mcp/`, the Pages MCP adapter.

## 1. Rules and Reading Order

Read before changing anything:

1. [`../AGENTS.md`](../AGENTS.md): repository rules for scope, layers, tests and
   completion.
2. [`../GUIDELINES.md`](../GUIDELINES.md): coding rules of the repository.
3. [`GUIDELINES.md`](./GUIDELINES.md): the MCP-specific coding and unit-test
   rules.
4. The sections of [`README.md`](./README.md) that cover the tools or the
   behavior you change. The README is the user and tool reference.
5. The source files involved, their tests, and nearby modules of the same kind.

Coding rules live only in the two `GUIDELINES.md` files. This file describes
the workflow, the configuration and the commands.

`../backend/service/chat/pica/AGENTS.md` instructs the Pica chatbot at runtime
and `../mobile/AGENTS.md` covers the mobile app; neither applies to this
package.

## 2. What the Package Is

- A Model Context Protocol server that MCP clients start as a local process.
  It speaks MCP over stdio and calls the Pages Agent API with the personal
  credential of the connected account.
- `pnpm run build` bundles it into one file, `dist/pages-mcp-v<version>.cjs`.
- Pages serves the same tool catalog over HTTP at `/mcp` and imports
  `src/operations-server.ts` and `src/tools/operation-failure.ts` for it. A
  change there changes both transports.
- The boundaries to Pages are in chapter 1 of [GUIDELINES.md](./GUIDELINES.md).

## 3. Configuration

| File                                   | Purpose                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                         | Scripts, exact dependency versions, `engines` (Node 24 or newer, pnpm 10 or newer), `packageManager` `pnpm@11.23.0`, `version` (read by Pages) |
| `pnpm-lock.yaml`                       | Lockfile of this package only                                                                                                                  |
| `pnpm-workspace.yaml`                  | `allowBuilds` for esbuild, `minimumReleaseAge: 14400`                                                                                          |
| `tsconfig.json`                        | `strict`, `NodeNext`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `noEmit`                                     |
| `eslint.config.js`                     | Type-aware linting with the rule sets of `../eslint.rules.js`; inline `eslint-disable` comments are not honoured                               |
| `../prettier.config.mjs`               | Prettier settings; the package has no configuration of its own                                                                                 |
| `.prettierignore`                      | Excludes `node_modules/`, `dist/`, `coverage/` and `pnpm-lock.yaml` from the package check                                                     |
| `vitest.config.ts`                     | Unit test discovery (`tests/**/*.unit.test.ts`), Node environment, mock restoring, V8 coverage at 100 %                                        |
| `build.config.ts`                      | esbuild bundle: Node 24 target, CommonJS, no code splitting                                                                                    |
| `scripts/package-release.ts`           | Release archive for a tag `mcp-vX.Y.Z`; run by the release workflow                                                                            |
| `../.github/workflows/ci.yml`          | Job **Pages check** (root gates), then job **MCP check** (`lint`, `check`, `build`, `test` in `mcp/`)                                          |
| `../.github/workflows/mcp-release.yml` | Release on a pushed tag `mcp-v*`, after the CI gates                                                                                           |

At runtime the adapter reads `PAGES_URL` and optionally `PAGES_TOKEN`; paired
credentials live in `credentials.json` in the platform configuration directory
(`$XDG_CONFIG_HOME/pages-mcp` or `~/.config/pages-mcp` on Linux). See the README
sections "Connect a client over stdio" and "Credential status, rotation and
removal".

## 4. Commands

Run these in `mcp/`, one after the other. They are the scripts of
`package.json`:

```sh
pnpm install --frozen-lockfile
pnpm run lint    # eslint . --max-warnings=0
pnpm run check   # tsc --noEmit && prettier --check .
pnpm run build   # node build.config.ts, writes dist/
pnpm run test    # vitest run --coverage, all metrics must reach 100 %
pnpm run clean   # removes node_modules/, dist/ and coverage/
```

- CI runs `lint`, `check`, `build` and `test` in this order; run them the same
  way.
- There is no watch mode and no `format` script. Format changed files with the
  package's Prettier: `node_modules/.bin/prettier --write <files>`.
- `pnpm run test:mcp` builds the bundle and runs `tests/stdio/client.ts` against
  a running Pages instance with a real credential. It is a manual acceptance,
  not a unit test. Run it only when a task asks for it and names an isolated
  instance.

The root gates also cover this package. Run them from the repository root after
changing `mcp/`; they need the root dependencies and the dependencies of
`mcp/`:

- `pnpm run lint` lints `mcp/src/`, `mcp/scripts/` and `mcp/tests/`.
- `pnpm run check` type-checks the `mcp/src/` modules that Pages imports and
  runs Prettier over `mcp/`. The root `.prettierignore` skips every
  `AGENTS.md`, `GUIDELINES.md` and `README.md`, so the package `check` is the
  only formatting check for these three files.
- `pnpm run test:backend` is needed when `src/operations-server.ts`,
  `src/tools/operation-failure.ts`, the modules they import or
  `../definition/` change, because Pages' backend behavior changes with them.

## 5. Workflow

1. Find the place: a tool lives in `src/tools/<domain>.ts` and is registered in
   `src/tools/registry.ts`, `src/tools/write-registry.ts` or
   `src/tools/wiki-comments.ts`. Requests to Pages are in `src/pages-client.ts`,
   startup in `src/start.ts`, pairing in `src/credential-command.ts`.
2. Change only what the task needs. Tool names, argument names and result
   fields are public API for MCP clients and the Pages HTTP endpoint.
3. Write or update the unit tests in the same change
   ([GUIDELINES.md](./GUIDELINES.md), chapter 10).
4. Update the tool reference in `README.md` when a tool contract changes.
   Change `version` in `package.json` only when the task asks for it, and the
   README title and bundle name with it.
5. Run the package commands of chapter 4, then the root gates. Report every
   command with its exit code. Report failing tests as they are; do not hide or
   skip them.

## 6. Do Not

- Edit `dist/`, `coverage/` or `node_modules/`.
- Push a tag `mcp-v*`, publish a release, or deploy a bundle.
- Use or print a real credential, or touch the local credential directory, in
  development or tests.
- Run `pnpm run test:mcp` against a production instance.
- Add a dependency, a coverage-ignore comment, an `eslint-disable` comment, or a
  relaxed rule or threshold.
- Import from Pages outside `../definition/`, or import code from `mobile/`.
