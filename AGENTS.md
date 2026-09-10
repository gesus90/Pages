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
- Vitest

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
- Reuse existing components and patterns where practical.
- Keep desktop, tablet, and mobile behavior in mind.
- Keep user-facing text compatible with i18next.
- Preserve SSR compatibility.

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

---

## 8. Database Changes

For database work:

- Follow all SQL formatting and structure rules from `GUIDELINES.md`.
- Add a new migration for schema changes.
- Do not rewrite previously applied migrations.
- Keep SQL explicit and readable.
- Parameterize dynamic values.
- Update related repository code and shared types when required.

---

## 9. Tests

When behavior changes:

- Add or update relevant tests.
- Do not delete or weaken tests only to make a change pass.
- Follow existing test patterns in the repository.
- Keep tests focused on observable behavior.

Do not create unnecessary test infrastructure when the current setup is sufficient.

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
