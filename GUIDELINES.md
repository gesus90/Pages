# GUIDELINES.md

# Pages Coding Guidelines

Coding conventions for source code only.

These rules define how code should be written and structured. They do **not** define project workflows, build commands, testing commands, architecture decisions, deployment, or repository processes.

Every rule that a tool can check is enforced as an **error** by `pnpm check` (TypeScript, Prettier) or `pnpm lint` (ESLint, no warnings allowed). Chapter 18 lists which rule is enforced by which tool. All other rules are checked in code review.

## 1. General Style

- Prefer clear and explicit code over clever code.
- Keep code small, focused, and predictable.
- Use descriptive names instead of abbreviations.
- Avoid unnecessary abstractions.
- Avoid duplicated business logic.
- Remove dead code instead of commenting it out.
- Comments should explain **why**, not repeat what the code already says.
- Keep nesting shallow and control flow easy to follow.

---

## 2. TypeScript Naming

Use:

```text
variables           camelCase
functions           camelCase
methods             camelCase
hooks               useCamelCase
classes             PascalCase
interfaces          PascalCase
types               PascalCase
React components    PascalCase
constants           UPPER_SNAKE_CASE only for true fixed constants
```

Good:

```ts
const activeProjects = [];
const MAX_LOGIN_ATTEMPTS = 5;

function getProjectById(): void {}

class ProjectService {}

interface Project {}

type ProjectStatus = "active" | "archived";
```

Files use the name style of their folder:

```text
app/                         kebab-case    task-form-dialog.tsx, use-task-form.ts
backend/                     PascalCase    TaskRepository.ts, ProjectErrors.ts
definition/, language/       PascalCase    Task.ts, Language.ts
```

Boolean names should read like conditions:

```ts
isActive
hasPermission
canEdit
shouldReload
```

Avoid these names for variables, functions, and parameters:

```ts
flag
data
obj
tmp
value1
helper
stuff
```

---

## 3. Functions

A function should perform one coherent task.

Prefer:

```ts
function createProject(input: CreateProjectInput): Project {
  // ...
}
```

Avoid functions that mix unrelated responsibilities.

Size limits for every function and method, React components included:

```text
100 lines of code     blank lines and comments do not count
complexity 15         cyclomatic complexity
nesting depth 3
4 parameters
```

A function that exceeds a limit is split by responsibility. A component splits into section components and hooks. The limits are realistic for the code base: every function fits them, so they stay errors without exceptions.

Prefer guard clauses over deep nesting:

```ts
function updateProject(project: Project | null): void {
  if (!project) {
    return;
  }

  if (!project.isEditable) {
    return;
  }

  // ...
}
```

Avoid:

```ts
function updateProject(project: Project | null): void {
  if (project) {
    if (project.isEditable) {
      // ...
    }
  }
}
```

### Parameters

Keep parameter lists short.

Avoid:

```ts
function getProject(
  id: string,
  includeTasks: boolean,
  includeMembers: boolean,
  includeWiki: boolean,
): void {}
```

Prefer an options object:

```ts
interface GetProjectOptions {
  includeTasks?: boolean;
  includeMembers?: boolean;
  includeWiki?: boolean;
}

function getProject(
  id: string,
  options: GetProjectOptions = {},
): void {}
```

Avoid boolean parameters when their meaning is unclear at the call site.

### Return Values

Exported functions should have explicit return types.

```ts
export function getProjectName(project: Project): string {
  return project.name;
}
```

Use early returns where they improve readability.

---

## 4. Types

Avoid `any`.

Use `unknown` for values whose type is not known yet.

```ts
function parseInput(value: unknown): Project {
  // validate and narrow
}
```

Prefer narrowing over unsafe casting.

Avoid:

```ts
const project = value as Project;
```

Allowed are `as const` and an assertion for a fact the compiler cannot see, such as an element returned by a query. An assertion on an object literal and the non-null assertion `!` are errors.

Prefer:

```ts
if (!isProject(value)) {
  throw new Error("Invalid project");
}

const project = value;
```

Use `interface` for object contracts:

```ts
interface Project {
  id: string;
  name: string;
}
```

Use `type` for unions and compositions:

```ts
type ProjectStatus = "active" | "archived";
```

Prefer string unions or `as const` objects over enums unless an enum is specifically useful.

Use `readonly` when reassignment should not be allowed.

```ts
interface Project {
  readonly id: string;
  name: string;
}
```

---

## 5. Generics

Use generics only when they express a real reusable relationship between types.

Good:

```ts
function first<T>(items: readonly T[]): T | undefined {
  return items[0];
}
```

Avoid generics that only make simple code harder to understand.

Use descriptive generic names when more than one generic exists:

```ts
function mapRecord<Key extends string, Value>(
  input: Record<Key, Value>,
): Value[] {
  return Object.values(input);
}
```

Single generic parameters may use `T`.

---

## 6. Classes

Use classes for stateful services, repositories, or objects with clear behavior.

Preferred member order:

```text
static fields
instance fields
constructor
public methods
protected methods
private methods
```

Example:

```ts
export class ProjectService {
  private readonly repository: ProjectRepository;

  public constructor(repository: ProjectRepository) {
    this.repository = repository;
  }

  public async getProject(id: string): Promise<Project | null> {
    return this.repository.getById(id);
  }

  private validateId(id: string): void {
    // ...
  }
}
```

Rules:

- Keep fields `private` unless they are part of the public API.
- Use `readonly` when a dependency should not be reassigned.
- Do not create classes for simple stateless utility functions.
- Avoid large classes with unrelated responsibilities.
- A file has at most 600 lines of code (blank lines and comments do not count). A class that grows beyond that is split into one small class per aggregate; the original class stays as a thin facade when other code depends on its public API.
- Member order, explicit accessibility on every member, and `readonly` for fields that are never reassigned are checked by ESLint.

---

## 7. TypeDoc

Use TypeDoc-compatible `/** ... */` comments for public APIs.

Document:

- exported classes
- exported functions
- public methods
- exported interfaces/types when their purpose is not obvious
- non-obvious public properties

A missing comment on an exported function or class or on a public method is an error. `@param` names must match the parameters, and tags must not repeat types. Properties of a destructured props parameter do not need their own `@param` tag.

Do not document trivial private implementation details.

Good:

```ts
/**
 * Returns the project with the given identifier.
 *
 * @param id - Project identifier.
 * @returns The project, or `null` when no project exists.
 */
export async function getProject(id: string): Promise<Project | null> {
  // ...
}
```

Use tags only when they add useful information:

```text
@param
@returns
@throws
@remarks
@example
@deprecated
```

Do not repeat TypeScript types in documentation.

Avoid:

```ts
/**
 * Gets the name.
 *
 * @param project - The project.
 * @returns The name.
 */
```

Prefer documentation that adds context:

```ts
/**
 * Returns the display name used in project navigation.
 *
 * @remarks
 * Archived projects keep their original display name.
 */
```

Use normal `//` comments for local implementation reasoning.

---

## 8. Imports

Order imports consistently:

```text
1. Node.js built-ins
2. external packages
3. internal absolute imports
4. relative imports
5. type-only imports
```

Example:

```ts
import path from "node:path";

import { useMemo } from "react";

import { ProjectService } from "@/backend/service/ProjectService";

import { ProjectCard } from "./ProjectCard";

import type { Project } from "@/definition/ProjectDefinition";
```

Use `import type` for type-only imports.

Prefer named exports unless a default export is clearly more appropriate.

`import type` is enforced. The order itself is checked in code review.

Avoid circular dependencies.

---

## 9. File Structure

A file should have one clear primary purpose.

Good:

```text
backend/service/ProjectService.ts
backend/database/repositories/ProjectRepository.ts
app/components/projects/project-card.tsx
app/components/projects/project-card/project-card-actions.tsx
app/components/projects/project-card/use-project-card.ts
```

A component that outgrows the size limits becomes a folder next to its file. The original file keeps the exported component as a composition of the section components and hooks in the folder, so imports of it stay valid.

Avoid generic dumping grounds:

```text
Utils.ts
Helpers.ts
Common.ts
Misc.ts
Stuff.ts
```

Preferred order inside a TypeScript file:

```text
imports
constants
types/interfaces
small local helpers
main implementation
```

Keep related code close together.

---

## 10. Async Code

Prefer `async` / `await`.

```ts
const project = await repository.getById(id);
```

Avoid unnecessary promise chains.

Run independent operations together only when they are actually independent:

```ts
const [project, members] = await Promise.all([
  getProject(),
  getMembers(),
]);
```

Do not silently ignore promises.

If fire-and-forget behavior is intentional, make it explicit:

```ts
void sendMetric();
```

The called function must handle its own errors. Unhandled and misused promises are errors.

---

## 11. Error Handling

Use `unknown` for caught errors:

```ts
try {
  await saveProject();
} catch (error: unknown) {
  // handle or rethrow
}
```

Avoid empty catches. Empty blocks are errors.

```ts
catch {
  // ignored
}
```

Use `console.error` and `console.warn` for diagnostics, `console.info` for operator notices, and `console.debug` only for traces that are switched on explicitly. `console.log` is not allowed.

Catch errors only when the current function can:

- handle them,
- translate them,
- add useful context,
- or deliberately recover.

Prefer specific error classes when callers need to react differently.

```ts
class ProjectNotFoundError extends Error {}
class PermissionDeniedError extends Error {}
```

---

## 12. React Components

Keep components focused.

Preferred structure:

```tsx
interface ProjectCardProps {
  project: Project;
}

export function ProjectCard({
  project,
}: ProjectCardProps): React.ReactElement {
  const title = project.name.trim();

  function handleOpen(): void {
    // ...
  }

  return (
    <article>
      <h2>{title}</h2>
      <button type="button" onClick={handleOpen}>
        Open
      </button>
    </article>
  );
}
```

Rules:

- Define props explicitly.
- Do not mutate props or state.
- Keep hooks at the top level.
- Keep business logic out of JSX.
- Prefer derived values over unnecessary state.
- Prefer local event-handler functions over complex inline callbacks.
- Split large components by responsibility.
- Avoid `useMemo` and `useCallback` unless they solve a real problem.
- Use semantic HTML elements.
- Hooks follow the rules of hooks, and effects list every value they read.
- Replace a nested ternary with a small component, an early return, or a lookup table.

Avoid:

```tsx
<button onClick={() => doA() && doB() && doC()}>
```

Prefer:

```tsx
function handleSave(): void {
  doA();
  doB();
  doC();
}
```

---

## 13. CSS

Style components with Tailwind utility classes in the JSX. Shared design values are theme tokens and CSS custom properties, not repeated literals.

Use a component-scoped CSS Module only for what utility classes cannot express, such as scrollbar styling, drag states, or animations:

```text
kanban-scroll-area.tsx
kanban-scroll-area.module.css
```

Use readable class names in CSS Modules:

```css
.projectCard {}
.projectTitle {}
.projectActions {}
```

Avoid:

```css
.box1 {}
.leftThing {}
.wrapper2 {}
```

Rules:

- Keep selectors shallow.
- Prefer classes over IDs.
- Avoid `!important`.
- Prefer Flexbox and Grid for layout.
- Avoid unnecessary absolute positioning.
- Avoid repeated magic values.
- Use CSS custom properties for shared design values.
- Use logical names for variables.

Good:

```css
:root {
  --color-text: #171717;
  --color-surface: #ffffff;
  --color-accent: #f97316;
  --space-small: 0.5rem;
  --space-medium: 1rem;
}
```

Keep related declarations together:

```css
.projectCard {
  display: flex;
  flex-direction: column;
  gap: var(--space-medium);

  padding: var(--space-medium);

  background: var(--color-surface);
  border-radius: 0.75rem;
}
```

---

## 14. SQL

Use readable, consistently formatted SQL.

Use:

```text
keywords     UPPERCASE
tables       snake_case
columns      snake_case
aliases      snake_case
```

Good:

```sql
SELECT
    id,
    name,
    owner_id,
    created_at
FROM projects
WHERE owner_id = $owner_id
ORDER BY created_at DESC;
```

Rules:

- One selected column per line for non-trivial queries.
- Avoid `SELECT *`.
- Use descriptive aliases.
- Keep joins visually clear.
- Keep conditions one per line when several are present.
- Prefer explicit column lists in `INSERT`.
- Always parameterize values.
- Interpolate only fixed fragments, such as a column list or a placeholder list, never a value.

`SELECT *` is an error. The other SQL rules are checked in code review.

Good:

```sql
INSERT INTO projects (
    id,
    name,
    owner_id
)
VALUES (
    $id,
    $name,
    $owner_id
);
```

Good join formatting:

```sql
SELECT
    projects.id,
    projects.name,
    users.display_name AS owner_name
FROM projects
INNER JOIN users
    ON users.id = projects.owner_id
WHERE projects.id = $project_id;
```

Avoid deeply nested SQL when a clearer query or named intermediate step would be easier to maintain.

---

## 15. Comments

Use comments sparingly.

Bad:

```ts
// Increment count
count++;
```

Good:

```ts
// Keep the previous value because the API may return duplicate events.
count++;
```

Do not leave commented-out code.

Do not use comments to compensate for unclear naming.

If code needs a long explanation, first check whether the implementation can be simplified.

---

## 16. Avoid These Patterns

```text
any
@ts-ignore
vague names
deep nesting
long boolean parameter lists
unsafe casts
huge functions
huge classes
generic Utils.ts files
commented-out code
empty catch blocks
unnecessary abstractions
unnecessary useEffect
unnecessary useMemo/useCallback
business logic inside JSX
nested ternaries
console.log
the non-null assertion !
unhandled promises
deep CSS selector chains
!important as a normal solution
SELECT *
SQL string concatenation
```

---

## 17. Default Decision Rule

When several implementations are valid, prefer:

```text
clarity
simplicity
type safety
consistency
maintainability
```

Shorter code is only better when it is also easier to understand.

---

## 18. Enforcement

`pnpm check` runs the TypeScript compiler (`strict`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`) and Prettier. `pnpm lint` runs ESLint with `--max-warnings=0`. Both must pass without exceptions. Suppression comments such as `eslint-disable` are not honoured, and `any`, `@ts-ignore`, and coverage-ignore comments are not used.

```text
Chapter  Rule                                         Tool
2        naming of variables, functions, types        @typescript-eslint/naming-convention
2        vague names                                  @typescript-eslint/naming-convention
3        function size, complexity, depth, params     max-lines-per-function, complexity, max-depth, max-params
3        explicit return types                        explicit-function-return-type, explicit-module-boundary-types
4        no any, no @ts-ignore                        typescript-eslint recommended
4        interface for object contracts               consistent-type-definitions
4        assertions                                   consistent-type-assertions, no-non-null-assertion, no-unnecessary-type-assertion
6        class member order and accessibility         member-ordering, explicit-member-accessibility, prefer-readonly
6        file size                                    max-lines
7        TypeDoc                                      jsdoc/require-jsdoc, jsdoc/check-param-names, jsdoc/no-types
8        import type                                  consistent-type-imports
10       promises                                     no-floating-promises, no-misused-promises
11       empty catch, console.log                     no-empty, no-console
11       unknown in catch                             useUnknownInCatchVariables, use-unknown-in-catch-callback-variable
12       hooks                                        react-hooks/rules-of-hooks, react-hooks/exhaustive-deps
16       nested ternaries                             no-nested-ternary
14       SELECT *                                     no-restricted-syntax
```

Checked in code review, because no tool can decide them: names that explain the purpose, import order, semantic HTML and accessibility, comments that explain why, unnecessary abstractions, unnecessary effects, and the SQL layout.

`eslint-plugin-jsx-a11y` is not used because its newest release (6.10.2) does not declare support for ESLint 10. Accessibility is checked in review until it does.
