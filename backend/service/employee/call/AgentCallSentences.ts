/** A part of the answer that can be spoken on its own. */
export interface AnswerSentence {
  /** The text as the voice reads it, without markdown. */
  readonly speech: string;
  /** The position in the text of the answer where this sentence begins. */
  readonly start: number;
  /** The position in the text of the answer where this sentence ends. */
  readonly end: number;
}

/** A clause only ends the first part when it already has this many characters. */
const FIRST_CLAUSE_MINIMUM = 36;

/** Words that end in a period without ending a sentence. */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  "z.b.",
  "d.h.",
  "u.a.",
  "z.t.",
  "o.ä.",
  "bzw.",
  "ca.",
  "etc.",
  "evtl.",
  "ggf.",
  "inkl.",
  "max.",
  "min.",
  "nr.",
  "dr.",
  "prof.",
  "vgl.",
  "usw.",
  "e.g.",
  "i.e.",
  "approx.",
]);

const SENTENCE_END = new Set([".", "!", "?", "…"]);
const CLAUSE_END = new Set([",", ";", ":", "–", "—"]);
const CLOSING = new Set(['"', "'", ")", "”", "“", "»", "«", "*", "_"]);

/**
 * Turns markdown into the text a voice reads.
 * @param text - A part of an answer.
 * @returns The text without code, links, markup and emoji; empty when nothing
 * readable is left.
 */
export function speakableText(text: string): string {
  const speech = text
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gmu, "")
    .replace(/[*_~#|]+/gu, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return /[\p{L}\p{N}]/u.test(speech) ? speech : "";
}

function isAbbreviation(buffer: string, end: number): boolean {
  const start = buffer.lastIndexOf(" ", end) + 1;
  const word = buffer.slice(start, end + 1).toLowerCase();
  if (ABBREVIATIONS.has(word)) return true;
  // "3." in "3. Juli" or "1. Schritt" names a number, not the end of a sentence.
  return /^\d+\.$/u.test(word);
}

function isBoundaryAt(
  buffer: string,
  index: number,
  allowsClause: boolean,
): boolean {
  const character = buffer.charAt(index);
  if (character === "\n") return true;
  const isSentenceEnd = SENTENCE_END.has(character);
  const isClauseEnd =
    allowsClause && CLAUSE_END.has(character) && index >= FIRST_CLAUSE_MINIMUM;
  if (!isSentenceEnd && !isClauseEnd) return false;
  let next = index + 1;
  while (CLOSING.has(buffer.charAt(next))) next += 1;
  // The end of the buffer cannot tell "3." from "3.5": wait for the next characters.
  if (next >= buffer.length || !/\s/u.test(buffer.charAt(next))) return false;
  return !(character === "." && isAbbreviation(buffer, index));
}

/** The index after the first boundary of the buffer, or `-1`. */
function boundaryOf(buffer: string, allowsClause: boolean): number {
  for (let index = 0; index < buffer.length; index += 1) {
    if (!isBoundaryAt(buffer, index, allowsClause)) continue;
    let next = index + 1;
    while (CLOSING.has(buffer.charAt(next))) next += 1;
    return next;
  }
  return -1;
}

/**
 * Cuts the growing text of an answer into sentences the voice speaks as soon
 * as they are complete.
 * @remarks
 * The first part may end at a clause, so the voice starts earlier; later
 * parts end at sentence ends and line breaks. A part without readable text,
 * such as a code block, is dropped but still counts as passed.
 */
export class AnswerSentenceSplitter {
  private buffer = "";
  private consumed = 0;
  private hasEmitted = false;

  /**
   * Adds new text of the answer.
   * @param delta - The next characters of the answer.
   * @returns The sentences that are complete now.
   */
  public push(delta: string): readonly AnswerSentence[] {
    this.buffer += delta;
    const sentences: AnswerSentence[] = [];
    for (;;) {
      const boundary = boundaryOf(this.buffer, !this.hasEmitted);
      if (boundary < 0) return sentences;
      const sentence = this.cut(boundary);
      if (sentence !== null) sentences.push(sentence);
    }
  }

  /**
   * Ends the answer.
   * @returns The rest of the text as a last sentence, if it is readable.
   */
  public flush(): readonly AnswerSentence[] {
    const sentence = this.cut(this.buffer.length);
    return sentence === null ? [] : [sentence];
  }

  private cut(length: number): AnswerSentence | null {
    const part = this.buffer.slice(0, length);
    const start = this.consumed;
    this.buffer = this.buffer.slice(length);
    this.consumed += part.length;
    const speech = speakableText(part);
    if (speech === "") return null;
    this.hasEmitted = true;
    return { speech, start, end: this.consumed };
  }
}
