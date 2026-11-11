/** Colour class of a piece of highlighted source text. */
export type SyntaxTokenKind =
  "keyword" | "function" | "string" | "number" | "comment" | "plain";

/** A run of source text that shares one colour. */
export interface SyntaxToken {
  readonly kind: SyntaxTokenKind;
  readonly text: string;
}

/** Language families the highlighter has a scanner for. */
export type SyntaxLanguage =
  | "typescript"
  | "json"
  | "shell"
  | "sql"
  | "python"
  | "css"
  | "html"
  | "markdown"
  | "yaml"
  | "diff";

/** A delimited construct such as a string or a block comment. */
interface SpanRule {
  readonly open: string;
  readonly close: string;
  readonly kind: SyntaxTokenKind;
  /** Whether the construct continues on the next line when it is not closed. */
  readonly isMultiline: boolean;
  /** Whether a backslash hides the following character from the close search. */
  readonly hasEscapes: boolean;
}

interface CodeConfig {
  readonly keywords: ReadonlySet<string>;
  readonly lineComments: readonly string[];
  readonly spans: readonly SpanRule[];
  /** Characters that count as part of a word besides letters, digits and `_`. */
  readonly extraWordCharacters: string;
  readonly hasCaseInsensitiveKeywords?: boolean;
  /** A line comment only starts at the line start or after white space (`$#`, `a#b`). */
  readonly hasBoundaryComments?: boolean;
  /** JSON: a string followed by `:` is a key. */
  readonly hasKeyStrings?: boolean;
  /** CSS: a word followed by `:` inside a rule is a property name. */
  readonly hasPropertyNames?: boolean;
  /** YAML: the text before a `: ` at the start of a line is a mapping key. */
  readonly hasMappingKeys?: boolean;
}

/** Scanner state that survives the end of a line. */
interface SpanState {
  pending: SpanRule | null;
}

interface MarkupState extends SpanState {
  isInsideTag: boolean;
}

interface LineCursor {
  readonly line: string;
  readonly tokens: SyntaxToken[];
  index: number;
}

interface LanguageEntry {
  readonly language: SyntaxLanguage;
  readonly label: string;
}

type LineScanner = (line: string) => SyntaxToken[];

const WORD_START = /[\p{L}_]/u;
const WORD_PART = /[\p{L}\p{N}_]/u;
const DIGIT = /[0-9]/;
const WHITE_SPACE = /\s/;
const TAG_NAME_PART = /[\w:.-]/;
const ATTRIBUTE_NAME_PART = /[^\s=>/"']/;
const UNQUOTED_VALUE_PART = /[^\s>"']/;
const MARKDOWN_HEADING = /^#{1,6}(?:\s|$)/;
const YAML_NON_KEY_START = /["'#{[&*!|>]/;
const DIFF_HEADER = /^(?:\+\+\+|---|diff |index )/;
const FENCE_LENGTH = 3;

function wordSet(words: string): ReadonlySet<string> {
  return new Set(words.split(" "));
}

function stringSpan(
  delimiter: string,
  isMultiline: boolean,
  hasEscapes = true,
): SpanRule {
  return {
    open: delimiter,
    close: delimiter,
    kind: "string",
    isMultiline,
    hasEscapes,
  };
}

function commentSpan(open: string, close: string): SpanRule {
  return { open, close, kind: "comment", isMultiline: true, hasEscapes: false };
}

const BLOCK_COMMENT = commentSpan("/*", "*/");
const MARKUP_COMMENT = commentSpan("<!--", "-->");
const DOUBLE_QUOTED = stringSpan('"', false);
const SINGLE_QUOTED = stringSpan("'", false);
const MARKUP_DOUBLE_QUOTED = stringSpan('"', true, false);
const MARKUP_SINGLE_QUOTED = stringSpan("'", true, false);

const TYPESCRIPT_CONFIG: CodeConfig = {
  keywords: wordSet(
    "abstract any as async await boolean break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let namespace never new null number object of override private protected public readonly return satisfies set static string super switch symbol this throw true try type typeof undefined unknown var void while yield",
  ),
  lineComments: ["//"],
  spans: [BLOCK_COMMENT, DOUBLE_QUOTED, SINGLE_QUOTED, stringSpan("`", true)],
  extraWordCharacters: "$",
};

const JSON_CONFIG: CodeConfig = {
  keywords: wordSet("true false null"),
  lineComments: ["//"],
  spans: [BLOCK_COMMENT, DOUBLE_QUOTED],
  extraWordCharacters: "",
  hasKeyStrings: true,
};

const SHELL_CONFIG: CodeConfig = {
  keywords: wordSet(
    "if then else elif fi for while until do done case esac in function select time return exit break continue export local readonly declare unset source alias set shift trap eval exec cd echo printf read test true false",
  ),
  lineComments: ["#"],
  spans: [stringSpan('"', true), stringSpan("'", true, false)],
  extraWordCharacters: "-",
  hasBoundaryComments: true,
};

const SQL_CONFIG: CodeConfig = {
  keywords: wordSet(
    "select from where and or not in is null as on join inner left right full outer cross union all distinct group by order having limit offset insert into values update set delete create alter drop table index view trigger primary key foreign references unique default constraint check if exists case when then else end begin commit rollback transaction with recursive returning asc desc like between true false cascade add column database schema grant revoke explain analyze",
  ),
  lineComments: ["--"],
  spans: [BLOCK_COMMENT, SINGLE_QUOTED, DOUBLE_QUOTED],
  extraWordCharacters: "",
  hasCaseInsensitiveKeywords: true,
};

const PYTHON_CONFIG: CodeConfig = {
  keywords: wordSet(
    "and as assert async await break case class continue def del elif else except False finally for from global if import in is lambda match None nonlocal not or pass raise return self True try while with yield",
  ),
  lineComments: ["#"],
  spans: [
    stringSpan('"""', true),
    stringSpan("'''", true),
    DOUBLE_QUOTED,
    SINGLE_QUOTED,
  ],
  extraWordCharacters: "",
};

const CSS_CONFIG: CodeConfig = {
  keywords: wordSet(
    "@media @import @supports @keyframes @font-face @layer @container @property @theme @apply @utility @variant @charset @namespace @page",
  ),
  lineComments: [],
  spans: [BLOCK_COMMENT, DOUBLE_QUOTED, SINGLE_QUOTED],
  extraWordCharacters: "-@",
  hasPropertyNames: true,
};

const YAML_CONFIG: CodeConfig = {
  keywords: wordSet("true false null yes no on off"),
  lineComments: ["#"],
  spans: [DOUBLE_QUOTED, stringSpan("'", false, false)],
  extraWordCharacters: "-",
  hasBoundaryComments: true,
  hasMappingKeys: true,
};

const LANGUAGE_GROUPS: readonly (readonly [string, SyntaxLanguage, string])[] =
  [
    ["ts tsx mts cts typescript", "typescript", "TypeScript"],
    ["js jsx mjs cjs javascript", "typescript", "JavaScript"],
    ["json jsonc json5 jsonl", "json", "JSON"],
    ["sh bash zsh shell shellscript", "shell", "Shell"],
    ["sql", "sql", "SQL"],
    ["py pyi python", "python", "Python"],
    ["css", "css", "CSS"],
    ["html htm xhtml", "html", "HTML"],
    ["xml", "html", "XML"],
    ["svg", "html", "SVG"],
    ["md mdx markdown", "markdown", "Markdown"],
    ["yaml yml", "yaml", "YAML"],
    ["diff patch", "diff", "Diff"],
  ];

// A Map, because a hint such as "constructor" must not hit Object.prototype.
const LANGUAGE_ALIASES: ReadonlyMap<string, LanguageEntry> = new Map(
  LANGUAGE_GROUPS.flatMap(([aliases, language, label]) =>
    aliases
      .split(" ")
      .map((alias): [string, LanguageEntry] => [alias, { language, label }]),
  ),
);

function hintKey(hint: string): string {
  const baseName = hint.slice(
    Math.max(hint.lastIndexOf("/"), hint.lastIndexOf("\\")) + 1,
  );
  return baseName.slice(baseName.lastIndexOf(".") + 1).toLowerCase();
}

function findLanguageEntry(hint: string): LanguageEntry | null {
  const trimmedHint = hint.trim();
  // A fence info string may carry attributes after the language ("ts title=x").
  const firstWord = trimmedHint.split(/\s/, 1)[0] ?? "";
  return (
    LANGUAGE_ALIASES.get(hintKey(trimmedHint)) ??
    LANGUAGE_ALIASES.get(hintKey(firstWord)) ??
    null
  );
}

/**
 * Resolves the language family of a code block or file.
 *
 * @param hint - Code fence info string ("ts", "bash", "yml") or a file name or
 *   extension ("console-terminal.tsx", ".py").
 * @returns The language, or `null` when the hint is unknown.
 */
export function resolveSyntaxLanguage(hint: string): SyntaxLanguage | null {
  return findLanguageEntry(hint)?.language ?? null;
}

/**
 * Returns the label shown for a language hint, such as "TypeScript" or "Shell".
 *
 * @remarks
 * JavaScript hints are labelled "JavaScript" although they are highlighted as
 * TypeScript.
 *
 * @param hint - Code fence info string, file name, or extension.
 * @returns The label; for an unknown hint the trimmed hint itself, which is
 *   empty for an empty hint.
 */
export function syntaxLanguageLabel(hint: string): string {
  return findLanguageEntry(hint)?.label ?? hint.trim();
}

function createCursor(line: string): LineCursor {
  return { line, tokens: [], index: 0 };
}

/** Moves the cursor to `end` and adds the text in between, merged into an equal neighbour. */
function emit(cursor: LineCursor, kind: SyntaxTokenKind, end: number): void {
  const text = cursor.line.slice(cursor.index, end);
  cursor.index = Math.max(cursor.index, end);
  if (text === "") {
    return;
  }
  const previous = cursor.tokens.at(-1);
  if (previous?.kind === kind) {
    cursor.tokens[cursor.tokens.length - 1] = {
      kind,
      text: previous.text + text,
    };
    return;
  }
  cursor.tokens.push({ kind, text });
}

function wholeLine(line: string, kind: SyntaxTokenKind): SyntaxToken[] {
  return line === "" ? [] : [{ kind, text: line }];
}

/** Returns the index after the closing delimiter, or -1 when the line ends first. */
function findSpanEnd(line: string, from: number, rule: SpanRule): number {
  if (!rule.hasEscapes) {
    const closeIndex = line.indexOf(rule.close, from);
    return closeIndex === -1 ? -1 : closeIndex + rule.close.length;
  }
  let index = from;
  while (index < line.length) {
    if (line.charAt(index) === "\\") {
      index += 2;
    } else if (line.startsWith(rule.close, index)) {
      return index + rule.close.length;
    } else {
      index += 1;
    }
  }
  return -1;
}

function continuePendingSpan(cursor: LineCursor, state: SpanState): void {
  const pending = state.pending;
  if (!pending) {
    return;
  }
  const end = findSpanEnd(cursor.line, cursor.index, pending);
  emit(cursor, pending.kind, end === -1 ? cursor.line.length : end);
  if (end !== -1) {
    state.pending = null;
  }
}

function emitSpan(cursor: LineCursor, state: SpanState, rule: SpanRule): void {
  const end = findSpanEnd(cursor.line, cursor.index + rule.open.length, rule);
  if (end !== -1) {
    emit(cursor, rule.kind, end);
    return;
  }
  emit(cursor, rule.kind, cursor.line.length);
  if (rule.isMultiline) {
    state.pending = rule;
  }
}

function skipWhiteSpace(line: string, from: number): number {
  let index = from;
  while (index < line.length && WHITE_SPACE.test(line.charAt(index))) {
    index += 1;
  }
  return index;
}

function readSpan(
  cursor: LineCursor,
  config: CodeConfig,
  state: SpanState,
): boolean {
  const { line } = cursor;
  const rule = config.spans.find((candidate) =>
    line.startsWith(candidate.open, cursor.index),
  );
  if (!rule) {
    return false;
  }
  emitSpan(cursor, state, rule);
  const isKey =
    config.hasKeyStrings === true &&
    rule.kind === "string" &&
    line.charAt(skipWhiteSpace(line, cursor.index)) === ":";
  const key = isKey ? cursor.tokens.pop() : undefined;
  if (key) {
    cursor.tokens.push({ kind: "function", text: key.text });
  }
  return true;
}

function readLineComment(cursor: LineCursor, config: CodeConfig): boolean {
  const { line, index } = cursor;
  if (!config.lineComments.some((prefix) => line.startsWith(prefix, index))) {
    return false;
  }
  const isAtBoundary = index === 0 || WHITE_SPACE.test(line.charAt(index - 1));
  if (config.hasBoundaryComments && !isAtBoundary) {
    return false;
  }
  emit(cursor, "comment", line.length);
  return true;
}

function isNumberPart(line: string, index: number): boolean {
  const character = line.charAt(index);
  if (character === ".") {
    return DIGIT.test(line.charAt(index + 1));
  }
  return WORD_PART.test(character);
}

function readNumber(cursor: LineCursor): boolean {
  const { line } = cursor;
  if (!DIGIT.test(line.charAt(cursor.index))) {
    return false;
  }
  let end = cursor.index + 1;
  while (end < line.length && isNumberPart(line, end)) {
    end += 1;
  }
  emit(cursor, "number", end);
  return true;
}

function isWordPart(character: string, config: CodeConfig): boolean {
  return (
    WORD_PART.test(character) || config.extraWordCharacters.includes(character)
  );
}

/** A property name follows `{`, `;` or the line start; a selector such as `a:hover {` does not. */
function isCssProperty(cursor: LineCursor, end: number): boolean {
  const { line, index } = cursor;
  if (line.charAt(end) !== ":") {
    return false;
  }
  let before = index - 1;
  while (before >= 0 && WHITE_SPACE.test(line.charAt(before))) {
    before -= 1;
  }
  if (before < 0) {
    return !line.includes("{", end);
  }
  return "{;".includes(line.charAt(before));
}

function classifyWord(
  cursor: LineCursor,
  config: CodeConfig,
  end: number,
): SyntaxTokenKind {
  const word = cursor.line.slice(cursor.index, end);
  const keyword = config.hasCaseInsensitiveKeywords ? word.toLowerCase() : word;
  if (config.keywords.has(keyword)) {
    return "keyword";
  }
  if (cursor.line.charAt(end) === "(") {
    return "function";
  }
  if (config.hasPropertyNames && isCssProperty(cursor, end)) {
    return "keyword";
  }
  return "plain";
}

function readWord(cursor: LineCursor, config: CodeConfig): boolean {
  const { line } = cursor;
  const first = line.charAt(cursor.index);
  if (!WORD_START.test(first) && !config.extraWordCharacters.includes(first)) {
    return false;
  }
  let end = cursor.index + 1;
  while (end < line.length && isWordPart(line.charAt(end), config)) {
    end += 1;
  }
  emit(cursor, classifyWord(cursor, config, end), end);
  return true;
}

/** Returns the index of the `:` that ends a mapping key starting at `start`, or -1. */
function findYamlKeyEnd(line: string, start: number): number {
  if (start >= line.length || YAML_NON_KEY_START.test(line.charAt(start))) {
    return -1;
  }
  for (let index = start; index < line.length; index += 1) {
    const character = line.charAt(index);
    const isBeforeGap =
      index + 1 === line.length || WHITE_SPACE.test(line.charAt(index + 1));
    if (character === ":" && isBeforeGap) {
      return index > start ? index : -1;
    }
    if (character === "#" && WHITE_SPACE.test(line.charAt(index - 1))) {
      return -1;
    }
  }
  return -1;
}

function readYamlKey(cursor: LineCursor): void {
  const { line } = cursor;
  let start = skipWhiteSpace(line, 0);
  while (line.startsWith("- ", start)) {
    start = skipWhiteSpace(line, start + 1);
  }
  const end = findYamlKeyEnd(line, start);
  if (end === -1) {
    return;
  }
  emit(cursor, "plain", start);
  emit(cursor, "function", end);
}

function createCodeScanner(config: CodeConfig): LineScanner {
  const state: SpanState = { pending: null };
  return (line) => {
    const cursor = createCursor(line);
    if (config.hasMappingKeys && !state.pending) {
      readYamlKey(cursor);
    }
    continuePendingSpan(cursor, state);
    while (cursor.index < line.length) {
      const isConsumed =
        readLineComment(cursor, config) ||
        readSpan(cursor, config, state) ||
        readNumber(cursor) ||
        readWord(cursor, config);
      if (!isConsumed) {
        emit(cursor, "plain", cursor.index + 1);
      }
    }
    return cursor.tokens;
  };
}

function emitRun(
  cursor: LineCursor,
  kind: SyntaxTokenKind,
  part: RegExp,
): void {
  const { line } = cursor;
  let end = cursor.index;
  while (end < line.length && part.test(line.charAt(end))) {
    end += 1;
  }
  emit(cursor, kind, end);
}

function readMarkupText(cursor: LineCursor, state: MarkupState): void {
  const { line } = cursor;
  const open = line.indexOf("<", cursor.index);
  if (open === -1) {
    emit(cursor, "plain", line.length);
    return;
  }
  emit(cursor, "plain", open);
  if (line.startsWith(MARKUP_COMMENT.open, open)) {
    emitSpan(cursor, state, MARKUP_COMMENT);
    return;
  }
  const nameStart = open + ("/!?".includes(line.charAt(open + 1)) ? 2 : 1);
  if (nameStart >= line.length || !WORD_START.test(line.charAt(nameStart))) {
    emit(cursor, "plain", open + 1);
    return;
  }
  emit(cursor, "plain", nameStart);
  emitRun(cursor, "keyword", TAG_NAME_PART);
  state.isInsideTag = true;
}

function readTagPart(cursor: LineCursor, state: MarkupState): void {
  const character = cursor.line.charAt(cursor.index);
  if (character === ">") {
    emit(cursor, "plain", cursor.index + 1);
    state.isInsideTag = false;
    return;
  }
  if (character === '"' || character === "'") {
    const rule =
      character === '"' ? MARKUP_DOUBLE_QUOTED : MARKUP_SINGLE_QUOTED;
    emitSpan(cursor, state, rule);
    return;
  }
  if (character === "=") {
    emit(cursor, "plain", cursor.index + 1);
    emitRun(cursor, "string", UNQUOTED_VALUE_PART);
    return;
  }
  if (!ATTRIBUTE_NAME_PART.test(character)) {
    emit(cursor, "plain", cursor.index + 1);
    return;
  }
  emitRun(cursor, "function", ATTRIBUTE_NAME_PART);
}

function createMarkupScanner(): LineScanner {
  const state: MarkupState = { pending: null, isInsideTag: false };
  return (line) => {
    const cursor = createCursor(line);
    continuePendingSpan(cursor, state);
    while (cursor.index < line.length) {
      if (state.isInsideTag) {
        readTagPart(cursor, state);
      } else {
        readMarkupText(cursor, state);
      }
    }
    return cursor.tokens;
  };
}

/** Reads a code span. Without a closing backtick nothing is consumed. */
function readInlineCode(cursor: LineCursor): boolean {
  const close = cursor.line.indexOf("`", cursor.index + 1);
  emit(cursor, "string", close + 1);
  return close !== -1;
}

/**
 * Reads `[text](target)`. Both searches stop at the next bracket, so a line of
 * unfinished links is still scanned in linear time.
 */
function readMarkdownLink(cursor: LineCursor): boolean {
  const { line } = cursor;
  let end = cursor.index + 1;
  while (end < line.length && !"[]".includes(line.charAt(end))) {
    end += 1;
  }
  if (!line.startsWith("](", end)) {
    return false;
  }
  end += 2;
  while (end < line.length && !"[()".includes(line.charAt(end))) {
    end += 1;
  }
  if (line.charAt(end) !== ")") {
    return false;
  }
  emit(cursor, "function", end + 1);
  return true;
}

function scanMarkdownText(line: string): SyntaxToken[] {
  const trimmedLine = line.trimStart();
  if (MARKDOWN_HEADING.test(trimmedLine)) {
    return wholeLine(line, "keyword");
  }
  if (trimmedLine.startsWith(">")) {
    return wholeLine(line, "comment");
  }
  const cursor = createCursor(line);
  while (cursor.index < line.length) {
    const character = line.charAt(cursor.index);
    const isConsumed =
      (character === "`" && readInlineCode(cursor)) ||
      (character === "[" && readMarkdownLink(cursor));
    if (!isConsumed) {
      emit(cursor, "plain", cursor.index + 1);
    }
  }
  return cursor.tokens;
}

function fenceMarker(line: string): string | null {
  const marker = line.trimStart().slice(0, FENCE_LENGTH);
  return marker === "```" || marker === "~~~" ? marker : null;
}

function isClosingFence(line: string, fence: string): boolean {
  const trimmedLine = line.trim();
  return (
    trimmedLine.startsWith(fence) &&
    trimmedLine === fence.charAt(0).repeat(trimmedLine.length)
  );
}

function createMarkdownScanner(): LineScanner {
  let openFence: string | null = null;
  return (line) => {
    if (openFence !== null) {
      if (isClosingFence(line, openFence)) {
        openFence = null;
      }
      return wholeLine(line, "string");
    }
    openFence = fenceMarker(line);
    return openFence === null
      ? scanMarkdownText(line)
      : wholeLine(line, "string");
  };
}

function diffLineKind(line: string): SyntaxTokenKind {
  if (line.startsWith("@@")) {
    return "keyword";
  }
  if (DIFF_HEADER.test(line)) {
    return "comment";
  }
  if (line.startsWith("+")) {
    return "string";
  }
  return line.startsWith("-") ? "number" : "plain";
}

const LINE_SCANNER_FACTORIES: Readonly<
  Record<SyntaxLanguage, () => LineScanner>
> = {
  typescript: () => createCodeScanner(TYPESCRIPT_CONFIG),
  json: () => createCodeScanner(JSON_CONFIG),
  shell: () => createCodeScanner(SHELL_CONFIG),
  sql: () => createCodeScanner(SQL_CONFIG),
  python: () => createCodeScanner(PYTHON_CONFIG),
  css: () => createCodeScanner(CSS_CONFIG),
  html: createMarkupScanner,
  markdown: createMarkdownScanner,
  yaml: () => createCodeScanner(YAML_CONFIG),
  diff: () => (line) => wholeLine(line, diffLineKind(line)),
};

/**
 * Splits source text into coloured tokens, one array per line.
 *
 * @remarks
 * Lines are split on `\n` and a trailing `\r` is dropped. Constructs that span
 * lines (block comments, template strings, Python triple quotes, HTML
 * comments) keep their kind across lines. The token texts of a line joined
 * together are the line itself; an empty line is an empty array. The scan is
 * linear in the source length and never throws.
 *
 * @param source - Source text to highlight.
 * @param language - Language of the source, or `null` for plain text.
 * @returns The tokens of every line.
 */
export function highlightLines(
  source: string,
  language: SyntaxLanguage | null,
): SyntaxToken[][] {
  const lines = source
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (language === null) {
    return lines.map((line) => wholeLine(line, "plain"));
  }
  return lines.map(LINE_SCANNER_FACTORIES[language]());
}
