/** Where one TODO of the agent's own list stands, as the agent reported it. */
export const AGENT_TODO_STATUSES = ["open", "active", "done"] as const;

/** The most TODOs of one list Pages keeps. */
export const AGENT_TODO_LIMIT = 40;

/** The longest TODO text Pages keeps. */
export const AGENT_TODO_TEXT_LENGTH = 200;

/**
 * One entry of the TODO list a CLI reported as a structured plan (PAGE-306).
 *
 * @remarks
 * The ACP plan names no identifier, so the identifier is the position in the
 * list (`1`, `2`, ...). Pages never reads TODOs from free text.
 */
export interface AgentPlanAgentTodo {
  readonly id: string;
  readonly text: string;
  readonly status: (typeof AGENT_TODO_STATUSES)[number];
  /** When the entry last changed its text or status, as Pages received it. */
  readonly updatedAt: string;
}

/** The last TODO list of one attempt of a step. */
export interface AgentPlanAgentTodoList {
  readonly attemptId: string;
  readonly todos: readonly AgentPlanAgentTodo[];
  /** When the CLI last reported the list. */
  readonly updatedAt: string;
}

/** One entry of an ACP plan update before Pages numbers and dates it. */
export interface AgentPlanEntry {
  readonly content: string;
  readonly status: string;
}

function entryStatus(status: string): AgentPlanAgentTodo["status"] {
  if (status === "in_progress") return "active";
  return status === "completed" ? "done" : "open";
}

/**
 * Reads the structured entries of a `plan` journal event.
 *
 * @param text - The journal text, JSON written by the session recorder.
 * @returns The entries; `null` for text of another form, which is never guessed at.
 */
export function readPlanEventEntries(
  text: string,
): readonly AgentPlanEntry[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const entries = "entries" in parsed ? parsed.entries : null;
    if (!Array.isArray(entries)) return null;
    return entries.flatMap((entry: unknown) =>
      typeof entry === "object" &&
      entry !== null &&
      "content" in entry &&
      "status" in entry &&
      typeof entry.content === "string" &&
      typeof entry.status === "string"
        ? [{ content: entry.content, status: entry.status }]
        : [],
    );
  } catch {
    return null;
  }
}

/**
 * Turns a reported plan into the TODO list of the attempt.
 *
 * @param entries - The entries of the newest plan update; a plan replaces the list.
 * @param previous - The list reported before, whose times an unchanged entry keeps.
 * @param reportedAt - When the update arrived.
 */
export function mergeAgentTodos(
  entries: readonly AgentPlanEntry[],
  previous: readonly AgentPlanAgentTodo[],
  reportedAt: string,
): readonly AgentPlanAgentTodo[] {
  return entries.slice(0, AGENT_TODO_LIMIT).map((entry, index) => {
    const id = String(index + 1);
    const text = entry.content.trim().slice(0, AGENT_TODO_TEXT_LENGTH);
    const status = entryStatus(entry.status);
    const earlier = previous.find((todo) => todo.id === id);
    const isUnchanged = earlier?.text === text && earlier.status === status;
    return {
      id,
      text,
      status,
      updatedAt: isUnchanged ? earlier.updatedAt : reportedAt,
    };
  });
}

/** The TODO the agent reported as in progress; `null` when it reported none. */
export function activeAgentTodo(
  todos: readonly AgentPlanAgentTodo[],
): AgentPlanAgentTodo | null {
  return todos.find((todo) => todo.status === "active") ?? null;
}
