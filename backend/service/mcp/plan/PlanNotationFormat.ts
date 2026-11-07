import { isPlanNotationIdentifier } from "./PlanNotationVocabulary";

/** One attribute as it is written, its value already formatted. */
export interface PlanNotationEntry {
  readonly key: string;
  readonly value: string;
}

/**
 * Writes a text in quotes, escaping `\`, `"` and line breaks.
 *
 * @param text - Any text.
 */
export function quotedPlanNotation(text: string): string {
  const escaped = text
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
  return `"${escaped}"`;
}

/**
 * Writes a word bare when it is a DOT identifier and in quotes otherwise.
 *
 * @param text - A name, identifier or fixed word.
 */
export function planNotationWord(text: string): string {
  return isPlanNotationIdentifier(text) ? text : quotedPlanNotation(text);
}

/**
 * Writes a number bare when DOT reads it as one, in quotes otherwise.
 *
 * @param number - A finite number.
 */
export function planNotationNumber(number: number): string {
  const text = String(number);
  return /^-?\d+(?:\.\d+)?$/u.test(text) ? text : quotedPlanNotation(text);
}

/**
 * Writes JSON in quotes, for the long form of a structured field.
 *
 * @param value - Any JSON value.
 */
export function planNotationJson(value: unknown): string {
  return quotedPlanNotation(JSON.stringify(value));
}

/** Creates an entry of a word. */
export function wordEntry(key: string, text: string): PlanNotationEntry {
  return { key, value: planNotationWord(text) };
}

/** Creates an entry of a quoted text. */
export function textEntry(key: string, text: string): PlanNotationEntry {
  return { key, value: quotedPlanNotation(text) };
}

/** Creates an entry of JSON. */
export function jsonEntry(key: string, value: unknown): PlanNotationEntry {
  return { key, value: planNotationJson(value) };
}

/** Writes the attribute list of a node or edge, or nothing without attributes. */
export function planNotationAttributeList(
  entries: readonly PlanNotationEntry[],
): string {
  if (entries.length === 0) return "";
  return ` [${entries.map((entry) => `${entry.key}=${entry.value}`).join(", ")}]`;
}
