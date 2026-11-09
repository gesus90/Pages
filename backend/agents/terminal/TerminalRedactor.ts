/** Literal secrets shorter than this are not masked; they would match ordinary output. */
const MINIMUM_SECRET = 8;

/**
 * A partial secret at the end of a chunk is held back only from this many
 * characters on, so a typed letter is never delayed by chance; at most this
 * many characters minus one of a secret split at a chunk boundary can pass.
 */
const MINIMUM_HELD_PREFIX = 4;

/** Held output beyond this is released, masked as far as it is known. */
const MAXIMUM_HELD = 16 * 1024;

/** Printable characters of earlier chunks kept to finish a match that spans a boundary. */
const CONTEXT_CHARACTERS = 1024;

const MASK = "*";

// The patterns of `sanitizePlanOutput`, applied in place so the layout of the terminal stays.
const TOKEN_PATTERN =
  /\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{12,}|github_pat_[a-zA-Z0-9_]{12,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/gu;
const ASSIGNMENT_PATTERN =
  /((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|authorization)["']?\s*[=:]\s*["']?(?:Bearer\s+)?)[^\s,;"'}]+/giu;
const BEARER_PATTERN = /(\bBearer\s+)[a-zA-Z0-9_.~+/=-]+/giu;
// A token that may still grow; it is held until it ends.
const OPEN_TOKEN_PATTERN =
  /(?:\b(?:sk-|gh[pousr]_|github_pat_|eyJ)[a-zA-Z0-9_.-]*|\bBearer\s*[a-zA-Z0-9_.~+/=-]*)$/u;
const KEY_BEGIN = /-----BEGIN [^-]*PRIVATE KEY-----/u;
const KEY_END = /-----END [^-]*PRIVATE KEY-----/u;

/** One character of the visible text and where it stands in the raw chunk; `-1` for earlier chunks. */
interface VisibleCharacter {
  readonly character: string;
  readonly index: number;
}

/** The visible text of a chunk and where an unfinished control sequence begins. */
interface ScannedChunk {
  readonly visible: readonly VisibleCharacter[];
  /** Raw index of a control sequence that is not complete yet; `-1` for none. */
  readonly openSequence: number;
}

/** Whether a character never belongs to a secret: blanks and frame drawing of a full-screen CLI. */
function isFiller(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return /\s/u.test(character) || (code >= 0x2500 && code <= 0x259f);
}

/** The end of a string-terminated sequence (OSC, DCS, APC, PM, SOS) from `start`; `-1` when it is open. */
function stringSequenceEnd(raw: string, start: number): number {
  for (let index = start; index < raw.length; index += 1) {
    if (raw[index] === "\u0007") return index + 1;
    if (raw[index] === "\u001b" && index + 1 < raw.length)
      return raw[index + 1] === "\\" ? index + 2 : index;
    if (raw[index] === "\u001b") return -1;
  }
  return -1;
}

/** The end of a control sequence introduced by CSI from `start`; `-1` when it is open. */
function csiEnd(raw: string, start: number): number {
  for (let index = start; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index + 1;
    if (code < 0x20 || code > 0x7e) return index;
  }
  return -1;
}

/** The end of the escape sequence at `start`; `-1` when the chunk ends inside it. */
function escapeEnd(raw: string, start: number): number {
  if (start + 1 >= raw.length) return -1;
  const kind = raw[start + 1];
  if (kind === "[") return csiEnd(raw, start + 2);
  if (
    kind === "]" ||
    kind === "P" ||
    kind === "X" ||
    kind === "^" ||
    kind === "_"
  )
    return stringSequenceEnd(raw, start + 2);
  // Character set selection takes one more character, such as `ESC ( B`.
  if (kind !== undefined && "()*+-./#%".includes(kind))
    return start + 2 < raw.length ? start + 3 : -1;
  return start + 2;
}

/**
 * Separates the visible text of a chunk from its control sequences.
 *
 * @param raw - Terminal output as the CLI wrote it.
 * @returns Every visible character with its raw index; blanks read as one space.
 */
function scan(raw: string): ScannedChunk {
  const visible: VisibleCharacter[] = [];
  let index = 0;
  while (index < raw.length) {
    const character = raw[index] ?? "";
    if (character === "\u001b") {
      const end = escapeEnd(raw, index);
      if (end < 0) return { visible, openSequence: index };
      index = end;
      continue;
    }
    const code = character.charCodeAt(0);
    if (/\s/u.test(character)) visible.push({ character: " ", index });
    else if (code >= 0x20 && code !== 0x7f) visible.push({ character, index });
    index += 1;
  }
  return { visible, openSequence: -1 };
}

/**
 * Masks the secrets of one session in a stream of terminal output.
 *
 * @remarks
 * The masking runs on the visible text, so a secret is found even when
 * colors or other control sequences stand between its characters, and in the
 * text without blanks, so a CLI that wraps a long secret over lines cannot
 * split it. Each masked character becomes `*` in place; control sequences
 * and the layout stay as they are. A chunk that ends inside a control
 * sequence, with the beginning of a secret or with a token that may still
 * grow is held back until the next chunk completes it; the visible text of
 * earlier chunks stays as context, so the rest of a match that spans chunks
 * is masked too. The caller releases held output after a short pause with
 * {@link TerminalRedactor.flush}.
 */
export class TerminalRedactor {
  private readonly secrets: readonly string[];
  private pending = "";
  private context = "";
  private isInsideKey = false;

  /**
   * @param secrets - Exact values of the session, such as its MCP credential and
   * provider keys, with their encodings; short and empty values are ignored.
   */
  public constructor(secrets: readonly (string | undefined)[]) {
    this.secrets = [
      ...new Set(
        secrets.filter(
          (secret): secret is string =>
            secret !== undefined && secret.length >= MINIMUM_SECRET,
        ),
      ),
    ].sort((left, right) => right.length - left.length);
  }

  /** Whether output is held back for the next chunk. */
  public get hasPending(): boolean {
    return this.pending.length > 0;
  }

  /**
   * Takes the next chunk and returns what may be shown and stored.
   *
   * @param chunk - Raw output of the CLI.
   * @returns The masked output up to the first character that must wait.
   */
  public push(chunk: string): string {
    return this.process(this.pending + chunk, false);
  }

  /** Releases held output, masked as far as it is complete. */
  public flush(): string {
    return this.process(this.pending, true);
  }

  private process(raw: string, isFinal: boolean): string {
    if (raw.length === 0) return "";
    const scanned = scan(raw);
    const output = raw.split("");
    const context: VisibleCharacter[] = [...this.context].map((character) => ({
      character,
      index: -1,
    }));
    const visible = [...context, ...scanned.visible];
    const keys = keyRanges(visible, context.length, this.isInsideKey);
    for (const [start, stop] of keys.ranges) mask(visible, start, stop, output);
    this.maskPatterns(visible, output);
    this.maskSecrets(visible, output);
    const held = isFinal ? raw.length : this.heldFrom(raw, scanned, visible);
    const end = raw.length - held > MAXIMUM_HELD ? raw.length : held;
    const emitted = visible.filter((entry) => entry.index < end);
    this.isInsideKey =
      end === raw.length
        ? keys.isInsideAtEnd
        : keyRanges(emitted, context.length, this.isInsideKey).isInsideAtEnd;
    this.pending = raw.slice(end);
    this.context = emitted
      .map((entry) => entry.character)
      .join("")
      .slice(-CONTEXT_CHARACTERS);
    return output.slice(0, end).join("");
  }

  /** Raw index from which output waits for the next chunk; the length of `raw` for none. */
  private heldFrom(
    raw: string,
    scanned: ScannedChunk,
    visible: readonly VisibleCharacter[],
  ): number {
    let held = scanned.openSequence >= 0 ? scanned.openSequence : raw.length;
    const text = visible.map((entry) => entry.character).join("");
    const open = OPEN_TOKEN_PATTERN.exec(text);
    if (open) held = Math.min(held, this.rawIndexFrom(visible, open.index));
    const compact = visible.filter((entry) => !isFiller(entry.character));
    const compactText = compact.map((entry) => entry.character).join("");
    for (const secret of this.secrets) {
      const prefix = longestPrefixAtEnd(compactText, secret);
      if (prefix >= MINIMUM_HELD_PREFIX)
        held = Math.min(
          held,
          this.rawIndexFrom(compact, compact.length - prefix),
        );
    }
    return held;
  }

  /** The raw index of the first character at or after a visible position that belongs to this chunk. */
  private rawIndexFrom(
    visible: readonly VisibleCharacter[],
    position: number,
  ): number {
    for (let index = position; index < visible.length; index += 1) {
      const entry = visible[index];
      if (entry && entry.index >= 0) return entry.index;
    }
    return Number.POSITIVE_INFINITY;
  }

  private maskSecrets(
    visible: readonly VisibleCharacter[],
    output: string[],
  ): void {
    const compact = visible.filter((entry) => !isFiller(entry.character));
    const text = compact.map((entry) => entry.character).join("");
    for (const secret of this.secrets) {
      let found = text.indexOf(secret);
      while (found >= 0) {
        mask(compact, found, found + secret.length, output);
        found = text.indexOf(secret, found + 1);
      }
    }
  }

  private maskPatterns(
    visible: readonly VisibleCharacter[],
    output: string[],
  ): void {
    const text = visible.map((entry) => entry.character).join("");
    for (const match of text.matchAll(TOKEN_PATTERN))
      mask(visible, match.index, match.index + match[0].length, output);
    for (const pattern of [ASSIGNMENT_PATTERN, BEARER_PATTERN]) {
      for (const match of text.matchAll(pattern)) {
        const start = match.index + (match[1]?.length ?? 0);
        mask(visible, start, match.index + match[0].length, output);
      }
    }
  }
}

/** Where the visible text lies inside a private key, and whether a key is still open at its end. */
interface KeyRanges {
  readonly ranges: readonly (readonly [number, number])[];
  readonly isInsideAtEnd: boolean;
}

/**
 * Finds the parts of a private key between its markers, also over many chunks.
 *
 * @param visible - Context and current chunk.
 * @param firstNew - Position of the first character of the current chunk.
 * @param isInside - Whether a key was open at the end of the context.
 */
function keyRanges(
  visible: readonly VisibleCharacter[],
  firstNew: number,
  isInside: boolean,
): KeyRanges {
  const text = visible.map((entry) => entry.character).join("");
  const ranges: [number, number][] = [];
  // A marker may straddle the boundary; one wholly in the context was handled already.
  let position = Math.max(0, firstNew - 64);
  let isOpen = isInside;
  while (position < text.length) {
    const found = (isOpen ? KEY_END : KEY_BEGIN).exec(text.slice(position));
    if (isOpen) {
      const stop = found ? position + found.index : text.length;
      ranges.push([position, stop]);
      if (!found) break;
      position = stop + found[0].length;
      isOpen = false;
      continue;
    }
    if (!found) break;
    position += found.index + found[0].length;
    if (position > firstNew) isOpen = true;
  }
  return { ranges, isInsideAtEnd: isOpen };
}

/** Replaces the characters of one match that belong to the current chunk. */
function mask(
  visible: readonly VisibleCharacter[],
  start: number,
  end: number,
  output: string[],
): void {
  for (let position = start; position < end; position += 1) {
    const entry = visible[position];
    if (!entry || entry.index < 0 || entry.character === " ") continue;
    output[entry.index] = MASK;
  }
}

/** The length of the longest proper prefix of `secret` that `text` ends with. */
function longestPrefixAtEnd(text: string, secret: string): number {
  const longest = Math.min(secret.length - 1, text.length);
  for (let length = longest; length > 0; length -= 1) {
    if (text.endsWith(secret.slice(0, length))) return length;
  }
  return 0;
}
