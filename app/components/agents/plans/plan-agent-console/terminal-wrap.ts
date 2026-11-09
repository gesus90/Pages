/** The SGR sequences that open a line and the reset that may close it. */
const STYLED_LINE = /^((?:\u001b\[[0-9;]*m)*)(.*?)((?:\u001b\[0m)?)$/su;
/** Indent and list marker of a line: `●`, `◆`, `✓`, `✗`, `…`, `>`, `❯`, `-`, `*`, `+`, `1.` or `1)`. */
const MARKER = /^(\s*)((?:[●◆✓✗…>❯*+-]|\d+[.)])\s+)?/u;
const RESET = "\u001b[0m";
/** Code point ranges xterm draws two columns wide: East Asian scripts and emoji. */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
];

/**
 * Columns a character takes in xterm: two for wide East Asian characters
 * and emoji, none for combining marks, else one.
 */
function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x300 && code <= 0x36f) return 0;
  return WIDE_RANGES.some(([first, last]) => code >= first && code <= last)
    ? 2
    : 1;
}

function textWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

/** Rows of one line under construction; the open row is always the last. */
class RowBuilder {
  private readonly rows: string[];
  private width: number;
  /** Width of what starts the open row: the indent and marker of the line, then the indent. */
  private base: number;

  private readonly columns: number;
  private readonly indent: string;

  public constructor(first: string, columns: number, indent: string) {
    this.columns = columns;
    this.indent = indent;
    this.rows = [first];
    this.width = textWidth(first);
    this.base = this.width;
  }

  /** Whether the open row holds more than its indent and marker. */
  private get hasContent(): boolean {
    return this.width > this.base;
  }

  /** Adds a word after the space before it, on a new row when it does not fit. */
  public add(space: string, word: string): void {
    const wordWidth = textWidth(word);
    if (wordWidth > this.columns - this.indent.length) {
      this.cut(this.hasContent ? space : "", word);
      return;
    }
    if (
      this.hasContent &&
      this.width + textWidth(space) + wordWidth > this.columns
    )
      this.break();
    const gap = this.hasContent ? space : "";
    this.append(gap, textWidth(gap) + wordWidth, word);
  }

  /** The finished rows without trailing spaces. */
  public result(): readonly string[] {
    return this.rows.map((row) => row.replace(/\s+$/u, ""));
  }

  /** Writes a word longer than a whole row from where the row stands, cut at each row end. */
  private cut(space: string, word: string): void {
    if (this.width + textWidth(space) >= this.columns) this.break();
    else this.append(space, textWidth(space), "");
    for (const char of word) {
      const width = charWidth(char);
      if (this.width + width > this.columns) this.break();
      this.append("", width, char);
    }
  }

  private append(space: string, width: number, word: string): void {
    this.rows[this.rows.length - 1] += `${space}${word}`;
    this.width += width;
  }

  private break(): void {
    this.rows.push(this.indent);
    this.width = this.indent.length;
    this.base = this.width;
  }
}

/**
 * Wraps one finished line of the Pages terminal into rows of at most
 * `columns` visible characters (PAGE-289).
 *
 * @param line - One line without line break, plain or in one ANSI style.
 * @param columns - Visible characters per row; the terminal passes one less than it has, so xterm never wraps itself.
 * @returns The rows; a line that fits stays one row as it is.
 *
 * @remarks
 * Rows break only between words. Only a word longer than a whole row, such
 * as a path, is cut at the row end. Following rows stand flush behind the
 * indent and list marker of the line, which take at most half the columns.
 * A styled line keeps its style in every row, and control sequences take no
 * column.
 */
export function wrapTerminalLine(
  line: string,
  columns: number,
): readonly string[] {
  const [, style = "", body = "", reset = ""] = STYLED_LINE.exec(line) ?? [];
  const text = body.replaceAll("\t", "    ");
  if (columns < 1 || textWidth(text) <= columns)
    return [`${style}${text}${reset}`];
  const [prefix = ""] = MARKER.exec(text) ?? [];
  const indent = " ".repeat(
    Math.min(textWidth(prefix), Math.floor(columns / 2)),
  );
  const rows = new RowBuilder(prefix, columns, indent);
  const parts = text.slice(prefix.length).split(/(\s+)/u);
  for (let index = 0; index < parts.length; index += 2) {
    const word = parts[index] ?? "";
    if (word !== "") rows.add(parts[index - 1] ?? "", word);
  }
  const closing = style === "" ? reset : RESET;
  return rows.result().map((row) => `${style}${row}${closing}`);
}
