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

/** A clause ends a later part only when it already has this many characters, so phrases stay short but natural. */
const LATER_CLAUSE_MINIMUM = 90;

/** A part without any boundary is cut at the last space before this length, so the voice never waits for a long run-on text. */
const MAXIMUM_PHRASE_LENGTH = 220;

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
  clauseMinimum: number,
): boolean {
  const character = buffer.charAt(index);
  if (character === "\n") return true;
  const isSentenceEnd = SENTENCE_END.has(character);
  const isClauseEnd = CLAUSE_END.has(character) && index >= clauseMinimum;
  if (!isSentenceEnd && !isClauseEnd) return false;
  let next = index + 1;
  while (CLOSING.has(buffer.charAt(next))) next += 1;
  // The end of the buffer cannot tell "3." from "3.5": wait for the next characters.
  if (next >= buffer.length || !/\s/u.test(buffer.charAt(next))) return false;
  return !(character === "." && isAbbreviation(buffer, index));
}

/** The index after the first boundary of the buffer, or `-1`. */
function boundaryOf(buffer: string, clauseMinimum: number): number {
  let isInCode = false;
  for (let index = 0; index < buffer.length; index += 1) {
    // A code block is one part, so it is dropped whole instead of being read line by line.
    if (buffer.startsWith("```", index)) {
      isInCode = !isInCode;
      index += 2;
      continue;
    }
    if (isInCode || !isBoundaryAt(buffer, index, clauseMinimum)) continue;
    let next = index + 1;
    while (CLOSING.has(buffer.charAt(next))) next += 1;
    return next;
  }
  return -1;
}

/** Where an overlong part without a boundary is cut, or `-1` while it may still grow. */
function overlongCutOf(buffer: string): number {
  if (buffer.length <= MAXIMUM_PHRASE_LENGTH) return -1;
  // An open code block is dropped as a whole once it closes; cutting it would read code aloud.
  if ((buffer.match(/```/gu)?.length ?? 0) % 2 === 1) return -1;
  const space = buffer.lastIndexOf(" ", MAXIMUM_PHRASE_LENGTH);
  return space > 0 ? space + 1 : -1;
}

/**
 * Cuts the growing text of an answer into sentences the voice speaks as soon
 * as they are complete.
 * @remarks
 * The first part may end at a short clause, so the voice starts earlier;
 * later parts end at sentence ends, line breaks and the clauses of long
 * sentences, and a run-on text without any is cut at a space. A part without
 * readable text, such as a code block, is dropped but still counts as passed.
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
      const clauseMinimum = this.hasEmitted
        ? LATER_CLAUSE_MINIMUM
        : FIRST_CLAUSE_MINIMUM;
      const found = boundaryOf(this.buffer, clauseMinimum);
      const boundary = found < 0 ? overlongCutOf(this.buffer) : found;
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
