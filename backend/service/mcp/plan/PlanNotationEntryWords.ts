import type { AgentParameterType } from "@/definition/AgentParameters";

/** The value types a declared input, return or payload may have. */
export const PLAN_NOTATION_ENTRY_TYPES: readonly AgentParameterType[] = [
  "text",
  "number",
  "ticket",
  "workspace",
  "wiki",
  "asset",
];

/**
 * The text that marks a node's bindings as present but empty.
 * @remarks
 * An end carries `bindings` only when it declares what it hands back, and an
 * absent field differs from an empty one. Every other binding is written on
 * its own, so this is the one value the whole field is written for.
 */
export const PLAN_NOTATION_EMPTY_BINDINGS = "{}";

/** One declared value as the compact list says it: its name, its type and whether it is required. */
export interface PlanNotationEntryWord {
  readonly name: string;
  /** `text` when the word names no type. */
  readonly type: string;
  readonly isRequired: boolean;
}

/**
 * Whether a text names a value type of an entry.
 * @param text - A word of the notation.
 */
export function isPlanNotationEntryType(
  text: string,
): text is AgentParameterType {
  return PLAN_NOTATION_ENTRY_TYPES.some((type) => type === text);
}

/**
 * Writes one declared value as a word of the compact list: `name`, `name:type`, `name!` or `name:type!`.
 * @param entry - The declared value; `text` is the type a word without one has.
 */
export function planNotationEntryWord(entry: {
  readonly name: string;
  readonly type: AgentParameterType;
  readonly isRequired?: boolean;
}): string {
  const type = entry.type === "text" ? "" : `:${entry.type}`;
  return `${entry.name}${type}${entry.isRequired === true ? "!" : ""}`;
}

/**
 * Reads one word of the compact list.
 * @param word - A trimmed entry of the comma-separated list.
 * @returns The word, or `null` when it has more than a name and a type.
 */
export function readPlanNotationEntryWord(
  word: string,
): PlanNotationEntryWord | null {
  const isRequired = word.endsWith("!");
  const parts = (isRequired ? word.slice(0, -1) : word).split(":");
  const [name = "", type = "text"] = parts;
  return parts.length > 2 ? null : { name, type, isRequired };
}
