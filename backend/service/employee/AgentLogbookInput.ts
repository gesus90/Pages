import { z } from "zod";

import {
  AGENT_LOGBOOK_TEXT_CHARACTERS,
  AGENT_LOGBOOK_TOPIC_CHARACTERS,
} from "@/definition/AgentLogbook";

import type { AgentLogbookKind } from "@/definition/AgentLogbook";

/** The German names of the kinds, as `lagebuch_merken` takes them. */
const KIND_BY_NAME: Readonly<Record<string, AgentLogbookKind>> = {
  entscheidung: "decision",
  aufgabe: "open",
  offen: "open",
  fakt: "fact",
  frage: "question",
  notiz: "note",
};

/** The German name of a kind, as the tools answer it. */
const NAME_BY_KIND: Readonly<Record<AgentLogbookKind, string>> = {
  decision: "Entscheidung",
  open: "Aufgabe/Offen",
  fact: "Fakt",
  question: "Frage",
  note: "Notiz",
};

/**
 * The kind a German name stands for.
 *
 * @param name - `entscheidung`, `aufgabe`, `fakt`, `frage` or `notiz`, in any case.
 * @returns The kind, or `null` for another word.
 */
export function readLogbookKind(name: string): AgentLogbookKind | null {
  return KIND_BY_NAME[name.trim().toLowerCase()] ?? null;
}

/**
 * The German name of a kind.
 *
 * @param kind - The kind of an entry.
 */
export function logbookKindName(kind: AgentLogbookKind): string {
  return NAME_BY_KIND[kind];
}

/** The input of `lagebuch_merken`. */
export const LOGBOOK_REMEMBER_SCHEMA = z
  .object({
    art: z
      .string()
      .trim()
      .refine((name) => readLogbookKind(name) !== null),
    text: z.string().trim().min(1).max(AGENT_LOGBOOK_TEXT_CHARACTERS),
  })
  .strict();

/** The input of `lagebuch_suchen`. */
export const LOGBOOK_SEARCH_SCHEMA = z
  .object({ text: z.string().trim().min(1).max(200) })
  .strict();

/** The input of `lagebuch_lesen`: a chat, a topic, or both. */
export const LOGBOOK_READ_SCHEMA = z
  .object({
    chat: z.string().trim().max(200).optional(),
    thema: z.string().trim().max(200).optional(),
  })
  .strict();

/** The words of a search text, without the empty ones. */
export function searchWords(text: string | undefined): string[] {
  return (text ?? "").split(/\s+/u).filter((word) => word !== "");
}

/** A text with its white space folded, as two entries are compared for being the same. */
export function normalizedLogbookText(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase();
}

/**
 * The short name of an entry for the hint line: its first clause, cut at a
 * word.
 *
 * @param text - The text of the entry.
 */
export function topicOfLogbookText(text: string): string {
  const folded = text.replace(/\s+/gu, " ").trim();
  const clause = folded.split(/(?<=[.:;!?])\s/u)[0] ?? folded;
  const characters = Array.from(clause.replace(/[.:;!?]+$/u, ""));
  if (characters.length <= AGENT_LOGBOOK_TOPIC_CHARACTERS)
    return characters.join("");
  const cut = characters.slice(0, AGENT_LOGBOOK_TOPIC_CHARACTERS - 1).join("");
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 12 ? cut.slice(0, lastSpace) : cut}…`;
}
