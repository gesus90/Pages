# AGENTS.md

# Pages Agent Instructions

Instructions for AI coding agents working in this repository.

## 1. Mandatory Coding Rules

**`GUIDELINES.md` is mandatory.**

Before writing, modifying, or generating source code, every agent MUST read and follow:

```text
GUIDELINES.md
```

The coding rules in `GUIDELINES.md` are not optional recommendations. They are the repository standard for:

- TypeScript
- React
- TypeDoc
- functions
- classes
- naming
- imports
- file structure
- async code
- error handling
- CSS
- SQL
- comments

If generated code conflicts with `GUIDELINES.md`, the code must be changed to comply with it.

The rules that a tool can check are enforced by `pnpm check` and `pnpm lint` (ESLint, no warnings allowed). Chapter 18 of `GUIDELINES.md` lists them. Do not switch a rule off, relax a limit, or add suppression comments to make code pass; change the code instead.

Do not weaken, bypass, reinterpret, or ignore the coding guidelines for convenience.

If an existing implementation conflicts with `GUIDELINES.md`, prefer the guidelines for new code unless the task explicitly requires preserving the existing pattern.

---

## 2. Project Context

Pages is a self-hosted project management and wiki application built with:

- React 19
- TypeScript
- Node.js
- Vite
- React Router
- DuckDB
- i18next

The application uses server-side rendering and is intended to support multiple users.

---

## 3. Required Reading Order

Before making changes, read:

1. `AGENTS.md`
2. `GUIDELINES.md`
3. the relevant existing source files
4. nearby implementations that may establish local patterns

`README.md` may be used for general project context.

Do not start implementing before the relevant coding rules and surrounding code are understood.

---

## 4. Architecture Boundaries

Use the intended dependency flow:

```text
Route / Loader
    ↓
Service
    ↓
Repository
    ↓
DuckDB
```

Responsibilities:

- **Routes / Loaders** handle request and route concerns.
- **Services** contain business logic.
- **Repositories** contain persistence and SQL.
- **React components** contain UI behavior and rendering.
- **Definitions** contain shared types and contracts.

Do not bypass these layers without a clear requirement.

---

## 5. Scope of Changes

When implementing a task:

- Change only what is required.
- Avoid unrelated refactors.
- Do not rename or move files without need.
- Do not rewrite working code because of personal preference.
- Do not add dependencies unless necessary.
- Preserve existing public APIs unless the task requires a change.
- Do not remove existing functionality unless requested.

Prefer small, focused changes.

---

## 6. Frontend Changes

For frontend work:

- Follow all React, TypeScript, TypeDoc, and CSS rules from `GUIDELINES.md`.
- Preserve the existing visual language.
- Name colors by their semantic token (`bg-surface`, `text-muted-foreground`).
  The tokens carry the light and the dark palette; add a token with a value for
  both instead of a color in a component.
- Reuse existing components and patterns where practical.
- Keep desktop, tablet, and mobile behavior in mind.
- Keep user-facing text compatible with i18next.
- Preserve SSR compatibility.
- Style with Tailwind utility classes; use a CSS Module only for what utilities cannot express.
- Split a component that grows beyond the size limits of `GUIDELINES.md` into section components and hooks.

Do not introduce a new UI pattern when an existing project pattern already solves the same problem.

---

## 7. Backend Changes

For backend work:

- Follow all TypeScript, TypeDoc, function, class, and error-handling rules from `GUIDELINES.md`.
- Keep business logic in services.
- Keep SQL in repositories.
- Keep request-specific logic out of repositories.
- Validate external input before use.
- Keep authorization checks server-side.
- Do not expose backend-only data to the client.
- Split a repository or service that grows beyond the size limits of `GUIDELINES.md` into one small class per aggregate; the original class stays as a facade when other code depends on its public API.

---

## 8. Database Changes

For database work:

- Follow all SQL formatting and structure rules from `GUIDELINES.md`.
- Add a new migration for schema changes, as a numbered `.sql` file in
  `backend/database/migrations-duckdb/`. The SQLite migrations in
  `backend/database/migrations/` are frozen; they only describe the old file
  that `pnpm db:transfer` reads.
- Do not rewrite previously applied migrations.
- Keep SQL explicit and readable.
- Parameterize dynamic values.
- Update related repository code and shared types when required.

---

## 9. Tests

### Current state after PAGE-32 and PAGE-33

PAGE-38 introduced the standalone Backend/Frontend Vitest and diagnostic
coverage configuration. PAGE-32 rebuilds and executes the Backend unit suite
using exactly `pnpm run test:backend`. See [tests/backend/README.md](./tests/backend/README.md)
for the analyzed behavior, mocked boundaries, measured results and remaining
coverage gaps. Existing targeted Backend regressions are included. PAGE-33
separately extends and validates the Frontend suite using exactly
`pnpm run test:frontend`; see [tests/frontend/README.md](./tests/frontend/README.md)
for behavior selection, boundaries, results and gaps. Backend validation says
nothing about Frontend coverage.

Keep the two Pages scripts `test:backend` and `test:frontend` separate. No root
`test` script, aggregate, alias or MCP forwarding command is allowed. Pages CI
test execution remains absent after PAGE-35. The independent **MCP check** job
(PAGE-57) runs that package's own tests after **Pages check**. Its Vitest suite
under `mcp/tests/` remains outside Pages discovery and coverage; see
[mcp/README.md](./mcp/README.md). Run `pnpm run check` and `pnpm run lint` as
non-test gates; neither demonstrates functional coverage.

### Rules for future test work

- Once test infrastructure is rebuilt, add or update relevant tests whenever
  behavior changes; keep them focused on observable behavior.
- Do not delete or weaken tests only to make a change pass.
- Follow the test patterns established by the rebuild and avoid unnecessary
  test infrastructure.
- Coverage is diagnostic: report statements, branches, functions and lines per
  relevant Pages source module, including untested files and branch gaps. No
  mandatory percentage, per-file quota or replacement threshold applies for now.
  Do not hide gaps with coverage-ignore comments or blanket exclusions.
- Keep exactly two Pages test scripts: `test:backend` and `test:frontend`, both
  with coverage. No `test` script, aggregator, alias or MCP forwarding command.
- Choose scope by behavior: server-side loaders/actions under `app/` belong to
  Backend in Node; isolated React components/hooks belong to Frontend in jsdom.
  Discovery stays disjoint under `tests/backend/` and `tests/frontend/`, with
  `*.unit.test.{ts,tsx}` only. Mixed route modules and shared source deliberately
  appear in both diagnostic reports; do not aggregate the reports.
- Mock external boundaries. No real databases, services, networks or subprocess
  chains, and no smoke, E2E, browser, integration or live-provider tests.
- Intended reports go to `coverage/backend/` and `coverage/frontend/`: terminal
  and file text tables, HTML, JSON counters and per-module JSON metric summaries.
  PAGE-32 validates Backend reports; PAGE-33 separately validates Frontend reports.
- Pages tests may verify Pages-owned Agent API, pairing, wiki and database
  behavior. They must not import executable modules from the independent `mcp/`
  package or start an MCP server, client, transport or process, including through
  a shared helper. Use mocks or stubs at an MCP boundary. Pages connection
  instructions may read the package version from `mcp/package.json`; this is
  static runtime metadata.
- Keep future Pages scripts, discovery, setup, coverage and watch mode scoped to
  Pages. Do not add a root test aggregator or forwarding command for MCP.

---

## 10. Generated and Local Files

Do not intentionally modify or commit generated or local-only files such as:

```text
dist/
node_modules/
coverage/
.env
*.log
```

Modify source files instead of generated output.

---

## 11. When Requirements Are Unclear

If a requirement is ambiguous:

1. follow `GUIDELINES.md`,
2. follow the existing repository structure,
3. preserve current behavior,
4. choose the smallest reasonable implementation,
5. avoid speculative features or abstractions.

Do not use ambiguity as a reason to ignore the coding guidelines.

---

## 12. Completion Rules

Before considering a task complete:

- Confirm the requested behavior is implemented.
- Confirm changed code follows `GUIDELINES.md`.
- Run `pnpm run check` and `pnpm run lint`; do not claim test or coverage validation from these gates. Run `pnpm run test:backend` for Backend behavior changes and the tests required by the current task unless that task explicitly prohibits execution. Frontend validation remains separate. Keep the independent MCP package outside Pages test discovery and coverage.
- Confirm no unrelated code was changed.
- Confirm types and interfaces match the implementation.
- Update documentation only when documented behavior changed.
- Clearly mention unresolved assumptions or limitations.

A task is not complete if the implementation violates `GUIDELINES.md`.

---

## 13. Forbidden Agent Behavior

Do not:

- ignore or partially apply `GUIDELINES.md`
- generate code before reading the relevant guidelines
- introduce `any`, unsafe casts, weak naming, or undocumented public APIs contrary to the guidelines
- perform broad refactors without request
- add speculative features
- present placeholder implementations as complete
- duplicate existing abstractions
- add unnecessary dependencies
- bypass architecture layers without need
- weaken types to silence errors
- remove tests to make changes pass
- hardcode secrets or environment-specific values
- edit generated files instead of their sources
- invent a new coding style when `GUIDELINES.md` already defines one
