import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { countWords } from "@/definition/AgentEmployee";

/**
 * Credentials the general mask does not know: GitHub, GitLab, Slack and AWS
 * keys and private key blocks.
 */
const MORE_CREDENTIALS =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu;

/**
 * Removes recognizable credentials before a text of an agent is stored
 * (PAGE-266): `MEMORY.md`, archive entries and the documents of the panel.
 *
 * @param text - Text from a person or a learning run.
 * @returns The text with every recognized credential replaced.
 */
export function stripCredentials(text: string): string {
  return redactCredentials(text).replace(MORE_CREDENTIALS, "[redacted]");
}

/**
 * Cuts a text after a number of words, keeping its line breaks.
 *
 * @param text - Markdown or plain text.
 * @param maximum - Words to keep.
 * @returns The text itself when it fits, else its first words.
 */
export function limitWords(text: string, maximum: number): string {
  if (countWords(text) <= maximum) return text;
  let seen = 0;
  for (const match of text.matchAll(/\S+/gu)) {
    seen += 1;
    if (seen === maximum) return text.slice(0, match.index + match[0].length);
  }
  return text;
}

/** Turns a database time, `YYYY-MM-DD HH:MM:SS` UTC, into an ISO time. */
export function databaseTimeToIso(time: string | null): string | null {
  if (time === null) return null;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(time)
    ? `${time.replace(" ", "T")}Z`
    : time;
}

/** Turns a date into the database form, `YYYY-MM-DD HH:MM:SS` UTC. */
export function toDatabaseTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** The first moment of the calendar month of a date, in the database form. */
export function monthStart(date: Date): string {
  return `${date.toISOString().slice(0, 7)}-01 00:00:00`;
}

/** Adds hours to a database time. */
export function addHours(time: string, hours: number): Date {
  return new Date(Date.parse(`${time.replace(" ", "T")}Z`) + hours * 3_600_000);
}
