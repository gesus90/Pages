import { stripCredentials } from "../AgentEmployeeText";

/** Longest summary of a profile in a list. */
const SUMMARY_CHARACTERS = 240;

/**
 * The short description of an agent for a list: the first paragraph of its
 * `AGENT.md` without headings, markup characters and credentials.
 *
 * @param instructions - The text of `AGENT.md`.
 * @returns At most 240 characters, or `null` for an empty document.
 */
export function summarizeInstructions(instructions: string): string | null {
  const paragraph = stripCredentials(instructions)
    .split(/\n\s*\n/u)
    .map((block) =>
      block
        .split("\n")
        .filter((line) => !/^\s*#/u.test(line))
        .join(" ")
        .replace(/[*_`>]+/gu, "")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .find((block) => block !== "");
  if (paragraph === undefined) return null;
  if (paragraph.length <= SUMMARY_CHARACTERS) return paragraph;
  return `${paragraph.slice(0, SUMMARY_CHARACTERS - 1).trimEnd()}…`;
}

/** A document of an agent for a reader: without credentials, `null` when empty. */
export function readableDocument(text: string): string | null {
  const document = stripCredentials(text);
  return document.trim() === "" ? null : document;
}

/** The headings of an `AGENT.md` that state what an agent is responsible for. */
const SPECIALIZATION_HEADING =
  /^#{1,6}\s*(?:zuständig für|zuständigkeit|spezialisierung|schwerpunkt|responsible for|responsibilities|specialization|focus)\b/iu;

function plainLine(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/u, "")
    .replace(/[*_`>]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The lines under the first heading that states what the agent is responsible for. */
function responsibilityLines(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => SPECIALIZATION_HEADING.test(line));
  if (start < 0) return [];
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*#/u.test(line)) break;
    const text = plainLine(line);
    if (text !== "") section.push(text);
  }
  return section;
}

/**
 * What an agent is specialized in, for the decision of who answers in a group
 * (PAGE-379): its opening paragraph and the list under the heading that states
 * what it is responsible for, without markup and credentials.
 *
 * @param instructions - The text of `AGENT.md`.
 * @param limit - The most characters the result keeps.
 * @returns At most `limit` characters, or an empty text for an empty document.
 *
 * @remarks
 * The headings that count are "Zuständig für", "Zuständigkeit", "Spezialisierung"
 * and "Schwerpunkt" and their English forms. A document without one gives its
 * opening paragraph alone; the rest of the document, such as the working rules,
 * is not part of it.
 */
export function agentSpecialization(
  instructions: string,
  limit: number,
): string {
  const opening = summarizeInstructions(instructions) ?? "";
  const lines = stripCredentials(instructions).split("\n");
  const responsibilities = responsibilityLines(lines);
  const text = [opening, responsibilities.join("; ")]
    .filter((part) => part !== "")
    .join(" · ");
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  return `${characters
    .slice(0, limit - 1)
    .join("")
    .trimEnd()}…`;
}
