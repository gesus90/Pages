/** Indent and list marker of a line: `●`, `◆`, `✓`, `✕`, `▸`, `▾`, `☐`, `☑`, `↻`, `…`, `>`, `❯`, `-`, `*`, `+`, `1.` or `1)`. */
const MARKER = /^(\s*)((?:[●◆✓✕✗▸▾☐☑↻…>❯*+-]|\d+[.)])\s+)?/u;
const RESET = "\u001b[0m";
/** One SGR sequence or one visible character. */
const TOKEN = /\u001b\[([0-9;]*)m|(.)/gsu;
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

/** A visible character with the SGR sequences in force where it stands. */
interface Cell {
  readonly char: string;
  readonly style: string;
}

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

function cellsWidth(cells: readonly Cell[]): number {
  let width = 0;
  for (const cell of cells) width += charWidth(cell.char);
  return width;
}

function cellsOf(text: string, style: string): Cell[] {
  return [...text].map((char) => ({ char, style }));
}

/** The visible characters of a line, each with the style it is drawn in. */
function readCells(line: string): Cell[] {
  const cells: Cell[] = [];
  let style = "";
  for (const [token, parameters, char] of line.matchAll(TOKEN)) {
    if (char === undefined) {
      style = parameters === "" || parameters === "0" ? "" : `${style}${token}`;
      continue;
    }
    if (char === "\t") cells.push(...cellsOf("    ", style));
    else cells.push({ char, style });
  }
  return cells;
}

/** A row as text: every run of one style opens with its sequences and closes with a reset. */
function rowText(cells: readonly Cell[]): string {
  let text = "";
  let run = "";
  let runStyle = "";
  function close(): void {
    text += runStyle === "" ? run : `${runStyle}${run}${RESET}`;
    run = "";
  }
  for (const cell of cells) {
    if (cell.style !== runStyle) {
      close();
      runStyle = cell.style;
    }
    run += cell.char;
  }
  close();
  return text;
}

function isBlank(cell: Cell): boolean {
  return cell.char === " ";
}

/** Splits cells into words and the blanks before each; a leading blank run belongs to the first word. */
function wordsOf(
  cells: readonly Cell[],
): readonly { readonly space: Cell[]; readonly word: Cell[] }[] {
  const words: { space: Cell[]; word: Cell[] }[] = [];
  let space: Cell[] = [];
  let word: Cell[] = [];
  for (const cell of cells) {
    if (isBlank(cell)) {
      if (word.length > 0) {
        words.push({ space, word });
        space = [];
        word = [];
      }
      space.push(cell);
    } else word.push(cell);
  }
  if (word.length > 0) words.push({ space, word });
  return words;
}

/** Rows of one line under construction; the open row is always the last. */
class RowBuilder {
  private readonly rows: Cell[][];
  private width: number;
  /** Width of what starts the open row: the indent and marker of the line, then the indent. */
  private base: number;

  private readonly columns: number;
  private readonly indent: readonly Cell[];

  public constructor(
    first: readonly Cell[],
    columns: number,
    indent: readonly Cell[],
  ) {
    this.columns = columns;
    this.indent = indent;
    this.rows = [[...first]];
    this.width = cellsWidth(first);
    this.base = this.width;
  }

  /** Whether the open row holds more than its indent and marker. */
  private get hasContent(): boolean {
    return this.width > this.base;
  }

  /** Adds a word after the blanks before it, on a new row when it does not fit. */
  public add(space: readonly Cell[], word: readonly Cell[]): void {
    const wordWidth = cellsWidth(word);
    if (wordWidth > this.columns - this.indent.length) {
      this.cut(this.hasContent ? space : [], word);
      return;
    }
    if (
      this.hasContent &&
      this.width + cellsWidth(space) + wordWidth > this.columns
    )
      this.break();
    this.append(this.hasContent ? space : []);
    this.append(word);
  }

  /** The finished rows without trailing blanks. */
  public result(): readonly Cell[][] {
    return this.rows.map((row) => {
      const end = row.findLastIndex((cell) => !isBlank(cell));
      return row.slice(0, end + 1);
    });
  }

  /** Writes a word longer than a whole row from where the row stands, cut at each row end. */
  private cut(space: readonly Cell[], word: readonly Cell[]): void {
    if (this.width + cellsWidth(space) >= this.columns) this.break();
    else this.append(space);
    for (const cell of word) {
      if (this.width + charWidth(cell.char) > this.columns) this.break();
      this.append([cell]);
    }
  }

  private append(cells: readonly Cell[]): void {
    this.rows[this.rows.length - 1]?.push(...cells);
    this.width += cellsWidth(cells);
  }

  private break(): void {
    this.rows.push([...this.indent]);
    this.width = this.indent.length;
    this.base = this.width;
  }
}

/** The blanks that start the following rows: the hanging indent, else the indent of the line's marker. */
function followIndent(
  cells: readonly Cell[],
  columns: number,
  hang: number | undefined,
): { readonly prefix: readonly Cell[]; readonly indent: readonly Cell[] } {
  const limit = Math.floor(columns / 2);
  const text = cells.map((cell) => cell.char).join("");
  const [marker = ""] = MARKER.exec(text) ?? [];
  const [blanks = ""] = /^\s*/u.exec(text) ?? [];
  // A line with a hanging indent keeps only its leading blanks, such as an empty time column.
  const lead = hang === undefined ? marker : blanks;
  const prefix = cells.slice(0, [...lead].length);
  const width = hang ?? cellsWidth(prefix);
  return { prefix, indent: cellsOf(" ".repeat(Math.min(width, limit)), "") };
}

/**
 * Wraps one finished line of the Pages terminal into rows of at most
 * `columns` visible characters.
 * @param line - One line without line break, plain or in several ANSI styles.
 * @param columns - Visible characters per row; the terminal passes one less than it has, so xterm never wraps itself.
 * @param hang - Columns the following rows start at; without it they stand behind the indent and list marker of the line.
 * @returns The rows; a line that fits stays one row as it is.
 * @remarks
 * Rows break only between words, and only a word longer than a whole row,
 * such as a path, is cut at the row end. Following rows stand flush behind
 * the hanging indent, which takes at most half the columns. Every row keeps
 * the styles in force where it starts, and control sequences take no column.
 */
export function wrapTerminalLine(
  line: string,
  columns: number,
  hang?: number,
): readonly string[] {
  const cells = readCells(line);
  if (columns < 1 || cellsWidth(cells) <= columns) return [rowText(cells)];
  const { prefix, indent } = followIndent(cells, columns, hang);
  const rows = new RowBuilder(prefix, columns, indent);
  for (const { space, word } of wordsOf(cells.slice(prefix.length)))
    rows.add(space, word);
  return rows.result().map(rowText);
}
