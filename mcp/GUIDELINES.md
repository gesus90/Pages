# GUIDELINES.md

# Pages MCP Coding Guidelines

Rules for the code of the MCP package: `src/`, `scripts/`, `tests/`,
`build.config.ts` and `vitest.config.ts`.

The root [GUIDELINES.md](../GUIDELINES.md) applies to this package in full. This
file only adds what is specific to the MCP adapter and never relaxes a root rule.
The React, CSS and SQL chapters of the root guidelines have no subject here.
Working steps, configuration and commands are in [AGENTS.md](./AGENTS.md).

`pnpm run lint` enforces the shared rule sets of `../eslint.rules.js` through
`eslint.config.js`; `pnpm run check` runs `tsc --noEmit` with `tsconfig.json` and
Prettier; `pnpm run test` enforces the coverage thresholds of `vitest.config.ts`.
The registry tests in `tests/src/tools/registry.unit.test.ts` check tool names,
schemas and annotations. Everything else is checked in review.

## 1. Package Boundaries

- `mcp/` is an independent package with its own `package.json`,
  `pnpm-lock.yaml` and `node_modules/`. Its only runtime dependency is
  `@modelcontextprotocol/server`.
- From Pages, code in `mcp/` imports only the shared contracts in
  `../definition/`, by relative path (`../../definition/PagesAgentApi.js`).
  Prefer `import type`. A value import is allowed only for plain data constants
  such as `CAPABILITY` or `WIKI_COVER_PRESETS`: esbuild bundles them, and
  `scripts/package-release.ts` copies `definition/` into the release build.
- Never import from `app/`, `backend/` or other Pages folders. Do not use the `@/`
  path alias in `mcp/src` imports. The `paths` entry in `mcp/tsconfig.json` stays,
  because Pages modules that MCP imports transitively use it.
- The shared contracts import `zod` and the `Tool` type of
  `@modelcontextprotocol/server` themselves. TypeScript resolves a package from
  the importing file upward, so from `../definition/` it never reaches
  `mcp/node_modules`, and the MCP check must not need a root installation.
  `paths` in `tsconfig.json` therefore maps both packages to their declaration
  files in `mcp/node_modules`. esbuild would take such a mapping literally and
  bundle the declaration file, so `build.config.ts` uses `tsconfig.build.json`,
  which keeps only the `@/*` entry.
- Pages imports `src/operations-server.ts` and `src/tools/operation-failure.ts`
  for its HTTP endpoint `/mcp` (`backend/service/mcp/HttpMcpOperations.ts`) and
  reads `version` from `package.json`. These modules and everything they import
  stay transport-neutral: no `process`, environment, file system, `fetch` or
  stdio, and they type-check under the root `tsconfig.json` as well.
- The adapter has no database access and opens no network listener. Identity,
  rights, visibility and argument validation belong to Pages. The adapter
  forwards requests, narrows responses and projects results.

## 2. Structure

```text
src/main.ts, start.ts               process entry and startup modes
src/server.ts, stdio-configuration.ts
                                    stdio server and its credential resolution
src/operations-server.ts            shared tool catalog for stdio and HTTP
src/pages-client.ts, verification.ts, project-names.ts
                                    requests to the Pages Agent API
src/configuration.ts, instance-address.ts
                                    validated settings and instance URLs
src/credential-*.ts, pairing-*.ts   local credentials and pairing commands
src/tools/<domain>.ts               tool definitions of one domain
src/tools/registry.ts               READ_TOOLS
src/tools/write-registry.ts         WRITE_TOOLS
src/tools/wiki-comments.ts          COMMENT_TOOLS
src/tools/read-operation.ts         dispatch of a tool call to Pages
src/tools/operation-failure.ts      whitelist of Pages business failures
scripts/                            release tooling, run directly by Node
tests/src/, tests/scripts/          unit tests, mirroring the source path
tests/stdio/                        manual stdio acceptance, no unit test
```

- A file has one purpose. Tool definitions of a domain live in
  `src/tools/<domain>.ts`; a large domain splits by aspect into
  `<domain>-<aspect>.ts` (`wiki-import-plan.ts`, `wiki-import-apply.ts`).
- Shared schema fragments, annotation presets and tool builders live in one
  module of `src/tools/` and are imported, not copied into each tool file.

## 3. Naming

- Files and folders use kebab-case: `ticket-checklist.ts`.
- Tool names are snake_case in the form verb, object: `read_wiki_page`,
  `set_ticket_title`. They match `^[a-z]+(_[a-z]+)*$` and are unique.
- Tool arguments are camelCase. Use `operationId` for replay, `expected<Field>`
  for the value a write compares against, and `confirmation` for a typed
  confirmation. The only exception is the documented `expected_revision` of
  `delete_wiki_page`.
- Tool names and argument names are public API. Rename one only together with a
  version change and a README note.
- An exported tool constant is named `<DOMAIN>_<ACTION>_TOOL`
  (`TICKET_SET_TITLE_TOOL`). A list of tools is named
  `<DOMAIN>_<READ|WRITE>_TOOLS` (`PLAN_READ_TOOLS`).
- Error classes end in `Error`.
- Tool builders have names that say what they build. Two modules do not define
  different functions with the same name.

## 4. Imports

- Relative imports in `src/` end in `.js` (`./pages-client.js`). The root `tsc`
  follows Pages' imports into `src/` with `allowImportingTsExtensions: false`,
  so a `.ts` specifier would break the root check.
- Files that Node runs directly import with `.ts`: `scripts/`,
  `build.config.ts` and `tests/stdio/`. Unit tests also import with `.ts`,
  `vi.mock` paths included.
- Import a symbol from the module that defines it, not through a re-export.
- Order groups as in chapter 8 of the root guidelines. Type-only imports come
  last.

## 5. Types and External Data

- Everything from outside the process is `unknown` until a type guard has
  narrowed it. This covers Pages responses, `credentials.json`, the environment,
  command-line arguments and tool arguments.
- Narrow objects with one shared `isRecord` type guard and property checks. Do
  not assert `as Record<string, unknown>`.
- Build results from known fields only (`readVerifiedIdentity`,
  `readCredential`). Unknown server fields never reach the MCP client.
- Each validation pattern and limit (token format, identifier length, timeouts,
  endpoint paths) exists once, as a named constant, and is reused.
- Operation names come from `../definition/`. Derive the set of tool operations
  once from the registries; do not repeat the union type.
- Error codes are string-literal unions, never plain `string`.

## 6. Tool Definitions

- A tool is a static `Tool` object (type from `@modelcontextprotocol/server`)
  with `name`, `title`, `description`, `inputSchema` and `annotations`. A
  definition holds data only: it reads no state and calls no Pages API.
- `inputSchema` is a JSON Schema object with `type: "object"` and
  `additionalProperties: false`. Every name in `required` exists in
  `properties`. Schema limits mirror the Pages limits; Pages stays the validator.
- Builders take one options object. No positional boolean parameters (chapter 3
  of the root guidelines).
- `annotations` sets all four hints explicitly, because the MCP defaults assume
  a destructive, open-world tool:

  | Hint              | Value                                                                       |
  | ----------------- | --------------------------------------------------------------------------- |
  | `readOnlyHint`    | `true` for reads, `false` for writes                                        |
  | `destructiveHint` | `true` when a write removes or replaces existing data, else `false`         |
  | `idempotentHint`  | `true` when a repeated call with the same arguments has no further effect   |
  | `openWorldHint`   | `true` only when the call reaches beyond Pages records, such as `play_plan` |

- A write that Pages journals for replay takes a required `operationId`. All
  writes do except `delete_chat_sessions` and `prepare_asset_upload`.
- A write that deletes data or reduces rights takes a `confirmation` argument.
  Pages requires it only when the write actually deletes or reduces, so the schema
  keeps it optional and the description says when it is needed. Its allowed values
  come from one named constant that matches what Pages accepts.
- The `description` addresses the model, in English, and is specific to the
  tool. It states what the tool does, which references it accepts, the rights
  needed, `NOT_FOUND` for hidden objects, limits, replay and confirmation.
  Sentences that several tools share are named constants. A description never
  consists of shared sentences only.
- Register every tool exactly once, with its Pages operation, in `READ_TOOLS`,
  `WRITE_TOOLS` or `COMMENT_TOOLS`. `list_project_names` is the only tool
  defined in `operations-server.ts`.
- A changed tool contract updates the tool reference in `README.md` in the same
  change.

## 7. Requests to Pages

- Agent API operations go through `postAgentRequest` in `src/pages-client.ts`.
  Other endpoints (pairing, asset upload) use the same request options:
  `redirect: "error"`, an `AbortSignal.timeout` with a named constant, JSON
  headers where JSON is sent, and the credential only in `Authorization`.
- Build endpoint URLs with `instanceEndpoint` below the validated instance.
- Never cache a positive verification or a tool list. `tools/list` and every
  call of a registered tool ask Pages again.

## 8. Errors, Output and Secrets

- stdout carries only MCP messages. Nothing in `src/` writes to stdout.
  Diagnostics go to stderr: `console.error` with the prefix `[pages-mcp]` in
  `start.ts`, and the injected `write` of the credential commands.
- `tools/call` maps failures as follows. Change the mapping only together with
  Pages' HTTP endpoint, which shares it.

  | Situation                                      | Result                                                        |
  | ---------------------------------------------- | ------------------------------------------------------------- |
  | Pages refuses with a whitelisted business code | tool result `isError: true` with `{code, message?, details?}` |
  | unknown tool, arguments for a tool without any | `ProtocolError` with `ProtocolErrorCode.InvalidParams`        |
  | authorization, network or unexpected failure   | fixed error `Pages authorization failed.`                     |

- Messages are fixed English sentences. The terminal texts of the credential
  commands come from `credential-messages.ts` (German and English). A message
  never contains a token, device secret, server body, caught error message or
  credential file content. `CredentialStoreError` messages are fixed texts and
  may be shown as they are.
- Business details pass only through the whitelists of `operation-failure.ts`.
  A new Pages reason or limit is added there and to the README.
- A `catch` without binding is allowed when it replaces the error with a fixed
  error or performs a documented recovery. It never discards an error silently.
- An error code names the actual cause.
- Local credentials are read and written only through `CredentialStore`
  (directory `0700`, file `0600`, owner check, no symbolic links, atomic write,
  lock file).

## 9. Maintenance

- `version` in `package.json` is the single source of the package version. The
  README title `# Pages MCP <version>` and the bundle name
  `pages-mcp-v<version>.cjs` follow it; `stampReadme` in
  `scripts/package-release.ts` refuses a README that does not name them.
- `@modelcontextprotocol/server` has the same version here and in the root
  `package.json`, because Pages compiles `src/operations-server.ts` for its HTTP
  endpoint. Upgrade both together.
- `zod` is a dev dependency of this package only so that TypeScript can resolve
  the imports of `../definition/` (chapter 1); no code in `mcp/` imports it. It
  keeps the version that the root `pnpm-lock.yaml` resolves. After upgrading
  `zod` or `@modelcontextprotocol/server`, check the declaration files that the
  `paths` of `tsconfig.json` name.
- Dependencies are pinned to exact versions. `pnpm-workspace.yaml` keeps
  `minimumReleaseAge: 14400`. A new dependency needs a reason that Node and the
  SDK cannot cover; the build stays a single `.cjs` file.
- Remove code that has no production caller, together with its tests.
- The README documents behavior and contracts. Ticket evidence and run reports
  do not go into the package.

## 10. Unit Tests

The test scope is unit tests only. `tests/stdio/` (`pnpm run test:mcp`) is a
manual acceptance against a running Pages instance and is not part of the unit
suite. Do not add integration or end-to-end tests.

### Location and Names

- `tests/` mirrors the source path: `tests/src/<path>/<module>.unit.test.ts` for
  `src/<path>/<module>.ts`, `tests/scripts/` for `scripts/`, and
  `tests/build.config.unit.test.ts`. Only `*.unit.test.ts` is discovered.
- A large suite splits by aspect into `<module>-<aspect>.unit.test.ts`
  (`credential-command-pair.unit.test.ts`). The prefix is always the name of the
  tested source file.

### Structure

- Import `describe`, `it`, `expect` and `vi` from `vitest`; there are no
  globals.
- One top-level `describe` per tested export or entry point:
  `describe("postAgentRequest", ...)`.
- `it` states one behavior in the present tense, such as
  `it("lists only the tools Pages currently offers", ...)`. Use `it.each` or
  `describe.each` for tables.
- Arrange, act, assert. No logic in a test body beyond iterating its table.
- Test data are `UPPER_SNAKE_CASE` constants at the top of the file
  (`CONFIGURATION`) and small builder functions in the same file. Test files do
  not share fixture files or helpers.

### Behavior

- Assert observable behavior: return values, thrown errors, JSON-RPC
  responses, written messages, and requests sent across a boundary.
- Test the MCP server in process through `InMemoryTransport.createLinkedPair()`,
  as `tests/src/server.unit.test.ts` does, not through a subprocess.
- For tool descriptions, assert the phrases that carry the contract (rights,
  limits, confirmation), not the whole text.
- A contract change updates its tests in the same change. Fix a failing test by
  aligning test or code with the intended contract, never by deleting or
  weakening the assertion.

### Isolation

- Mock only boundaries: `fetch` (`vi.stubGlobal`), `node:fs/promises`,
  `node:child_process`, `node:os`, esbuild, and sibling modules that the unit
  under test composes.
- No network, no Pages instance, no real credential or credential directory, no
  real subprocess, no dependence on files of the package tree that the unit does
  not read itself.
- Temporary files only in a `mkdtemp` directory under `os.tmpdir()` that
  `afterEach` removes.
- `vi.mock` stays at the top level of the file; values its factory needs come
  from `vi.hoisted`.
- `vitest.config.ts` restores spies, environment variables and globals after
  every test. Module mock functions keep their implementation, so reset each
  mock that a test configures in `beforeEach`.
- No real waiting: inject `wait`, signals and clocks (`CredentialCommandRuntime`)
  or use fake timers. Do not raise a timeout to make a slow test pass; remove
  the slow dependency.

### Coverage

- Statements, branches, functions and lines stay at 100 % for `src/**/*.ts`,
  `scripts/**/*.ts` and `build.config.ts` (`vitest.config.ts`).
- No coverage-ignore comments and no exclusions. New code comes with its tests
  in the same change.
