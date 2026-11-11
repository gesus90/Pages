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
