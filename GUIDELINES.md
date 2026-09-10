# GUIDELINES.md

# Pages Coding Guidelines

Coding conventions for source code only.

These rules define how code should be written and structured. They do **not** define project workflows, build commands, testing commands, architecture decisions, deployment, or repository processes.

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

Boolean names should read like conditions:

```ts
isActive
hasPermission
canEdit
shouldReload
```

Avoid:

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

---

## 7. TypeDoc

Use TypeDoc-compatible `/** ... */` comments for public APIs.

Document:

- exported classes
- exported functions
- public methods
- exported interfaces/types when their purpose is not obvious
- non-obvious public properties

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

Avoid circular dependencies.

---

## 9. File Structure

A file should have one clear primary purpose.

Good:

```text
ProjectService.ts
ProjectRepository.ts
ProjectCard.tsx
ProjectCard.module.css
```

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

The called function must handle its own errors.

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

Avoid empty catches.

```ts
catch {
  // ignored
}
```

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

Prefer component-scoped CSS Modules.

```text
ProjectCard.tsx
ProjectCard.module.css
```

Use readable class names:

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
