/** Keys of the page templates that ship with Pages; texts are translated. */
export const WIKI_BUILTIN_TEMPLATES = [
  "note",
  "decision",
  "guide",
  "idea",
  "incident",
] as const;

/** The key of a template that ships with Pages. */
export type WikiBuiltinTemplate = (typeof WIKI_BUILTIN_TEMPLATES)[number];

/** Where a new page is created, written as one text for a select. */
export interface WikiAreaChoice {
  readonly scope: "instance" | "project" | "private";
  readonly projectId: string | null;
}

/**
 * Writes an area as the value of a select option.
 *
 * @param area - Scope and project.
 * @returns A text that {@link parseAreaChoice} reads back.
 */
export function formatAreaChoice(area: WikiAreaChoice): string {
  return area.scope === "project" ? `project:${area.projectId}` : area.scope;
}

/**
 * Reads the value of a select option written by {@link formatAreaChoice}.
 *
 * @param value - Option value.
 * @returns The area; unknown values mean the whole instance.
 */
export function parseAreaChoice(value: string): WikiAreaChoice {
  if (value.startsWith("project:")) {
    return { projectId: value.slice("project:".length), scope: "project" };
  }

  return {
    projectId: null,
    scope: value === "private" ? "private" : "instance",
  };
}
