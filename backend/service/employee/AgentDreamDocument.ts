import { createHash } from "node:crypto";

import { countCharacters } from "@/definition/AgentMemory";

/** Characters of one lesson. */
const LESSON_CHARACTERS = 300;
/** Characters of the evidence of one lesson. */
const EVIDENCE_CHARACTERS = 200;
/** Share of common words from which two lessons count as similar. */
const SIMILARITY = 0.6;
const LESSON_LINE =
  /^- (.+?) — Beleg: (.+?) · Datum: (\d{4}-\d{2}-\d{2})(?: · Stärke: (\d+))?( · aus)?\s*$/u;

/** One lesson of `DREAM.md`. */
export interface AgentDreamLesson {
  readonly text: string;
  /** What the lesson rests on, such as a chat, a plan run or a feedback. */
  readonly evidence: string;
  /** The newest day it was confirmed, `YYYY-MM-DD`. */
  readonly date: string;
  /** How often it was confirmed; the weakest falls out first. */
  readonly strength: number;
  /** A lesson switched off stays in the file but is not loaded into a session (PAGE-378). */
  readonly isActive: boolean;
}

function cut(text: string, maximum: number): string {
  const single = text.replace(/\s+/gu, " ").replace(/ — /gu, " – ").trim();
  const characters = Array.from(single);
  return characters.length <= maximum
    ? single
    : `${characters.slice(0, maximum - 1).join("")}…`;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3),
  );
}

/** Whether two lessons say nearly the same, by their common words. */
function isSimilar(left: string, right: string): boolean {
  const leftWords = words(left);
  const rightWords = words(right);
  if (leftWords.size === 0 || rightWords.size === 0) return left === right;
  let common = 0;
  for (const word of leftWords) if (rightWords.has(word)) common += 1;
  return common / Math.min(leftWords.size, rightWords.size) >= SIMILARITY;
}

function mergeLessons(
  kept: AgentDreamLesson,
  added: AgentDreamLesson,
): AgentDreamLesson {
  const isNewer = added.date >= kept.date;
  const [first, second] = isNewer ? [added, kept] : [kept, added];
  // The same evidence twice says nothing more.
  const evidence = [
    ...new Set(
      [first.evidence, second.evidence]
        .flatMap((part) => part.split("; "))
        .filter((part) => part.trim() !== ""),
    ),
  ];
  return {
    text: isNewer ? added.text : kept.text,
    evidence: cut(evidence.join("; "), EVIDENCE_CHARACTERS),
    date: isNewer ? added.date : kept.date,
    strength: kept.strength + added.strength,
    // What somebody switched off stays off, however often the run confirms it.
    isActive: kept.isActive,
  };
}

/**
 * Reads the lessons of `DREAM.md`; a line Pages cannot read becomes a
 * lesson without evidence of strength 1, so a hand edit is never lost.
 *
 * @param text - The stored `DREAM.md`.
 * @param today - `YYYY-MM-DD` for lessons without a date.
 */
export function parseDreamDocument(
  text: string,
  today: string,
): AgentDreamLesson[] {
  return text
    .replace(/\r\n/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const match = LESSON_LINE.exec(line);
      if (!match)
        return {
          text: line.slice(2).trim(),
          evidence: "von Hand",
          date: today,
          strength: 1,
          isActive: true,
        };
      return {
        text: match[1] ?? "",
        evidence: match[2] ?? "",
        date: match[3] ?? today,
        strength: Number(match[4] ?? "1"),
        isActive: match[5] === undefined,
      };
    })
    .filter((lesson) => lesson.text !== "");
}

/**
 * The identifier of a lesson: a short digest of its text, stable while the
 * text stays, so the settings find the lesson they show (PAGE-378).
 *
 * @param text - The text of the lesson.
 */
export function lessonId(text: string): string {
  return createHash("sha1")
    .update(cut(text, LESSON_CHARACTERS))
    .digest("hex")
    .slice(0, 12);
}

/**
 * `DREAM.md` as a session receives it: without the lessons that are switched off.
 *
 * @param text - The stored `DREAM.md`.
 */
export function activeDreamDocument(text: string): string {
  return text
    .replace(/\r\n/gu, "\n")
    .split("\n")
    .filter((line) => LESSON_LINE.exec(line.trim())?.[5] === undefined)
    .join("\n")
    .trim();
}

/** Writes the lessons as `DREAM.md`, one line each with evidence and date. */
export function renderDreamDocument(
  lessons: readonly AgentDreamLesson[],
): string {
  return lessons
    .map(
      (lesson) =>
        `- ${cut(lesson.text, LESSON_CHARACTERS)} — Beleg: ${cut(lesson.evidence, EVIDENCE_CHARACTERS) || "–"} · Datum: ${lesson.date} · Stärke: ${lesson.strength}${lesson.isActive ? "" : " · aus"}`,
    )
    .join("\n");
}

/**
 * Merges new lessons into the stored ones and keeps `DREAM.md` within its
 * limit.
 *
 * @param current - The stored lessons.
 * @param added - The lessons of the dream run.
 * @param maximum - The character limit of the agent.
 * @returns The lessons that fit, how many were merged with a similar one
 * and how many fell out, the weakest and then the oldest first, with the
 * texts of the new, the confirmed and the dropped lessons for the log.
 */
export function mergeDreamLessons(
  current: readonly AgentDreamLesson[],
  added: readonly AgentDreamLesson[],
  maximum: number,
): {
  readonly lessons: readonly AgentDreamLesson[];
  readonly merged: number;
  readonly removed: number;
  readonly addedTexts: readonly string[];
  readonly mergedTexts: readonly string[];
  readonly removedTexts: readonly string[];
} {
  const lessons: AgentDreamLesson[] = [];
  const addedTexts: string[] = [];
  const mergedTexts: string[] = [];
  for (const [position, lesson] of [...current, ...added].entries()) {
    const isNew = position >= current.length;
    const index = lessons.findIndex((kept) =>
      isSimilar(kept.text, lesson.text),
    );
    const similar = index < 0 ? undefined : lessons[index];
    if (similar === undefined) {
      lessons.push(lesson);
      if (isNew) addedTexts.push(lesson.text);
      continue;
    }
    lessons[index] = mergeLessons(similar, lesson);
    if (isNew) mergedTexts.push(lesson.text);
  }
  const dropOrder = [...lessons].sort(
    (left, right) =>
      left.strength - right.strength || left.date.localeCompare(right.date),
  );
  const kept = new Set(lessons);
  const removedTexts: string[] = [];
  for (const lesson of dropOrder) {
    if (
      countCharacters(
        renderDreamDocument(lessons.filter((entry) => kept.has(entry))),
      ) <= maximum
    )
      break;
    kept.delete(lesson);
    removedTexts.push(lesson.text);
  }
  return {
    lessons: lessons.filter((entry) => kept.has(entry)),
    merged: mergedTexts.length,
    removed: removedTexts.length,
    addedTexts,
    mergedTexts,
    removedTexts,
  };
}
