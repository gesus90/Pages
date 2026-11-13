/** What a statement does with a parameter, as far as its text tells. */
export type ParameterUse = "written" | "compared" | "unclear";

/** A string, a quoted name, a comment, a placeholder, a word or one other character. */
const STATEMENT_TOKEN =
  /[eE]?'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\/|\$[A-Za-z_]\w*|[A-Za-z_][\w.]*|\S/gu;

const READS = new Set(["SELECT", "WITH"]);
const WRITES = new Set(["INSERT", "UPDATE", "DELETE"]);
const AFTER_SET = new Set(["WHERE", "FROM", "RETURNING"]);
const AFTER_SELECT_LIST = new Set(["FROM", "WHERE"]);
const SET_OPERATIONS = new Set(["UNION", "EXCEPT", "INTERSECT"]);

type Tokens = readonly string[];

/** The placeholders of one statement; two kinds of use of one name count as unclear. */
class Uses {
  private readonly uses = new Map<string, ParameterUse>();

  /** Notes every placeholder among the tokens. */
  public note(tokens: Tokens, use: ParameterUse): void {
    for (const token of tokens)
      if (isPlaceholder(token)) this.noteOne(token.slice(1), use);
  }

  /** Notes one use of a name. */
  public noteOne(name: string, use: ParameterUse): void {
    const known = this.uses.get(name);
    this.uses.set(name, known === undefined || known === use ? use : "unclear");
  }

  /** The use of each placeholder noted so far. */
  public result(): ReadonlyMap<string, ParameterUse> {
    return this.uses;
  }
}

function isPlaceholder(token: string): boolean {
  return /^\$[A-Za-z_]/u.test(token);
}

function tokensOf(statement: string): Tokens {
  return (statement.match(STATEMENT_TOKEN) ?? []).filter(
    (token) =>
      !token.startsWith("--") && !token.startsWith("/*") && token !== ";",
  );
}

/** The first token outside all brackets from `start` on that `isEnd` accepts. */
function findOuter(
  tokens: Tokens,
  start: number,
  isEnd: (token: string, index: number) => boolean,
): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (depth === 0 && isEnd(token, index)) return index;
    if (token === "(") depth += 1;
    if (token === ")") depth -= 1;
  }
  return tokens.length;
}

function findWord(
  tokens: Tokens,
  start: number,
  words: ReadonlySet<string>,
): number {
  return findOuter(tokens, start, (token) => words.has(token.toUpperCase()));
}

function splitAtCommas(tokens: Tokens): readonly Tokens[] {
  const items: Tokens[] = [];
  let start = 0;
  for (;;) {
    const comma = findOuter(tokens, start, (token) => token === ",");
    items.push(tokens.slice(start, comma));
    if (comma >= tokens.length) return items;
    start = comma + 1;
  }
}

/** `col = $value` or `col = COALESCE($value, col)`: the value can only land in that column. */
function isPlainAssignment(item: Tokens): boolean {
  const [column, equals, value, open, inner, comma, kept, close] = item;
  if (equals !== "=") return false;
  if (item.length === 3) return isPlaceholder(value ?? "");
  return (
    item.length === 8 &&
    value?.toUpperCase() === "COALESCE" &&
    open === "(" &&
    isPlaceholder(inner ?? "") &&
    comma === "," &&
    kept === column &&
    close === ")"
  );
}

function noteAssignments(tokens: Tokens, uses: Uses): void {
  for (const item of splitAtCommas(tokens))
    uses.note(item, isPlainAssignment(item) ? "written" : "unclear");
}

/** `WHERE` and `FROM` only compare; what `RETURNING` does with a value is not known. */
function noteAfterAssignments(tokens: Tokens, uses: Uses): void {
  const returning = findWord(tokens, 0, new Set(["RETURNING"]));
  uses.note(tokens.slice(0, returning), "compared");
  uses.note(tokens.slice(returning), "unclear");
}

function noteUpdate(tokens: Tokens, uses: Uses): void {
  const set = findWord(tokens, 0, new Set(["SET"]));
  const end = findWord(tokens, set + 1, AFTER_SET);
  uses.note(tokens.slice(0, set), "unclear");
  noteAssignments(tokens.slice(set + 1, end), uses);
  noteAfterAssignments(tokens.slice(end), uses);
}

function columnName(token: string): string {
  return token.replaceAll('"', "").toLowerCase();
}

/** A row of an `INSERT`: a value that stands alone is written to its column. */
function noteRow(
  items: readonly Tokens[],
  columns: readonly string[],
  uses: Uses,
): ReadonlyMap<string, string> {
  const written = new Map<string, string>();
  items.forEach((item, index) => {
    const [only] = item;
    const column = columns[index];
    if (
      item.length === 1 &&
      only !== undefined &&
      isPlaceholder(only) &&
      column !== undefined
    ) {
      uses.noteOne(only.slice(1), "written");
      written.set(column, only.slice(1));
    } else uses.note(item, "unclear");
  });
  return written;
}

function noteValues(
  tokens: Tokens,
  columns: readonly string[],
  uses: Uses,
): ReadonlyMap<string, string> {
  const written = new Map<string, string>();
  let start = 0;
  for (;;) {
    const open = findOuter(tokens, start, (token) => token === "(");
    if (open >= tokens.length) return written;
    const close = findOuter(tokens, open + 1, (token) => token === ")");
    const items = splitAtCommas(tokens.slice(open + 1, close));
    for (const [column, name] of noteRow(items, columns, uses))
      written.set(column, name);
    start = close + 1;
  }
}

function noteSelect(
  tokens: Tokens,
  columns: readonly string[],
  uses: Uses,
): ReadonlyMap<string, string> {
  if (findWord(tokens, 0, SET_OPERATIONS) < tokens.length) {
    uses.note(tokens, "unclear");
    return new Map();
  }
  const end = findWord(tokens, 1, AFTER_SELECT_LIST);
  uses.note(tokens.slice(end), "compared");
  return noteRow(splitAtCommas(tokens.slice(1, end)), columns, uses);
}

/**
 * A value that decides a conflict is a comparison as well: without the character it
 * could update or skip the row of another key. Without a named target any column can.
 */
function noteConflict(
  tokens: Tokens,
  written: ReadonlyMap<string, string>,
  uses: Uses,
): void {
  const hasTarget = tokens[2] === "(";
  const targetEnd = hasTarget
    ? findOuter(tokens, 3, (token) => token === ")")
    : 2;
  const keys = hasTarget
    ? new Set(splitAtCommas(tokens.slice(3, targetEnd)).flat().map(columnName))
    : null;
  for (const [column, name] of written)
    if (keys === null || keys.has(column)) uses.noteOne(name, "unclear");
  const set = findWord(
    tokens,
    hasTarget ? targetEnd + 1 : targetEnd,
    new Set(["SET"]),
  );
  const end = findWord(tokens, set + 1, AFTER_SET);
  noteAssignments(tokens.slice(set + 1, end), uses);
  noteAfterAssignments(tokens.slice(end), uses);
}

function noteInsert(tokens: Tokens, uses: Uses): void {
  const open = findOuter(tokens, 0, (token) => token === "(");
  const close = findOuter(tokens, open + 1, (token) => token === ")");
  const source = (tokens[close + 1] ?? "").toUpperCase();
  if (source !== "VALUES" && source !== "SELECT") {
    uses.note(tokens, "unclear");
    return;
  }
  const columns = splitAtCommas(tokens.slice(open + 1, close)).map((column) =>
    columnName(column[0] ?? ""),
  );
  const conflict = findOuter(
    tokens,
    close + 1,
    (token, index) =>
      token.toUpperCase() === "ON" &&
      (tokens[index + 1] ?? "").toUpperCase() === "CONFLICT",
  );
  const returning = findWord(tokens, close + 1, new Set(["RETURNING"]));
  const bodyEnd = Math.min(conflict, returning);
  const body = tokens.slice(close + 1, bodyEnd);
  const written =
    source === "VALUES"
      ? noteValues(body.slice(1), columns, uses)
      : noteSelect(body, columns, uses);
  if (conflict < tokens.length)
    noteConflict(tokens.slice(conflict), written, uses);
  else uses.note(tokens.slice(bodyEnd), "unclear");
}

/**
 * Tells for each placeholder of a statement whether its value is stored or compared.
 *
 * @param statement - SQL owned by a repository, with `$name` placeholders.
 * @returns The use of each placeholder.
 *
 * @remarks
 * Written means a plain assignment to a column or a value that stands alone
 * in the row of an `INSERT`, outside the target of `ON CONFLICT`. Reads, `DELETE`,
 * `WHERE` and `FROM` compare. All else is unclear, also a name with two kinds of use.
 */
export function parameterUses(
  statement: string,
): ReadonlyMap<string, ParameterUse> {
  const tokens = tokensOf(statement);
  const uses = new Uses();
  const first = (tokens[0] ?? "").toUpperCase();
  if (first === "INSERT") noteInsert(tokens, uses);
  else if (first === "UPDATE") noteUpdate(tokens, uses);
  else if (first === "DELETE") uses.note(tokens, "compared");
  else if (
    READS.has(first) &&
    !tokens.some((token) => WRITES.has(token.toUpperCase()))
  )
    uses.note(tokens, "compared");
  else uses.note(tokens, "unclear");
  return uses.result();
}
