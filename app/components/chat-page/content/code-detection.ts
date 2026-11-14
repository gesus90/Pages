/**
 * Recognizes the language of a code block that names none (PAGE-383).
 *
 * @remarks
 * Every rule asks for a clear sign, so a block whose content fits no
 * language well enough stays plain text. The order matters: formats with a
 * strict shape (JSON, SVG, HTML, Mermaid, Diff) come before languages that
 * are recognized by typical lines, and CSV comes last, because many
 * languages contain separated values.
 */

/** The language hints the detection yields; each is a hint of the syntax colors or of a preview. */
export type DetectedLanguage =
  | "json"
  | "svg"
  | "html"
  | "mermaid"
  | "diff"
  | "sql"
  | "python"
  | "shell"
  | "typescript"
  | "javascript"
  | "css"
  | "yaml"
  | "markdown"
  | "csv"
  | "tsv";

const MERMAID_START =
  /^(?:graph\s+(?:TD|TB|BT|RL|LR)\b|flowchart(?:\s|$)|sequenceDiagram\b|classDiagram(?:-v2)?\b|stateDiagram(?:-v2)?\b|erDiagram\b|gantt\b|pie(?:\s|$)|journey\b|gitGraph\b|mindmap\b|timeline\b|quadrantChart\b|requirementDiagram\b|C4(?:Context|Container|Component|Dynamic|Deployment)\b|sankey(?:-beta)?\b|xychart(?:-beta)?\b|block(?:-beta)?\b|packet(?:-beta)?\b|architecture(?:-beta)?\b|kanban\b|radar(?:-beta)?\b)/u;
const HTML_TAG =
  /<(?:html|head|body|div|span|p|a|button|input|form|label|section|article|header|footer|main|nav|ul|ol|li|table|tr|td|th|h[1-6]|img|script|style|link|meta|canvas|select|option|textarea)\b[^>]*>/giu;
const SQL_START =
  /^\s*(?:SELECT\s[\s\S]*\sFROM\s|INSERT\s+INTO\s|UPDATE\s+\S+\s+SET\s|DELETE\s+FROM\s|CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:TABLE|INDEX|UNIQUE\s+INDEX|VIEW|SCHEMA|FUNCTION|TRIGGER|SEQUENCE|TYPE|EXTENSION)\s|ALTER\s+TABLE\s|DROP\s+(?:TABLE|INDEX|VIEW|SCHEMA)\s|WITH\s+(?:RECURSIVE\s+)?\w+\s+AS\s*\()/iu;
const PYTHON_SIGNS: readonly RegExp[] = [
  /^\s*def\s+\w+\s*\([^)]*\)\s*(?:->\s*[^:]+)?:\s*$/mu,
  /^\s*class\s+\w+(?:\([^)]*\))?\s*:\s*$/mu,
  /^\s*from\s+[\w.]+\s+import\s+[\w*, ()]+$/mu,
  /^\s*import\s+[\w.]+(?:\s+as\s+\w+)?\s*$/mu,
  /^\s*if\s+__name__\s*==\s*["']__main__["']\s*:/mu,
  /^\s*(?:elif\s.+|else|try|except(?:\s.+)?|finally)\s*:\s*$/mu,
  /^\s*print\(.*\)\s*$/mu,
  /\bself\.\w+/u,
  /^\s*(?:for\s+\w+(?:\s*,\s*\w+)*\s+in\s+.+|while\s+.+|with\s+.+\s+as\s+\w+)\s*:\s*$/mu,
];
const SHELL_COMMAND =
  /^(?:\$\s+|sudo\s|npm\s|pnpm\s|npx\s|yarn\s|git\s|cd\s|ls(?:\s|$)|mkdir\s|rm\s|cp\s|mv\s|echo\s|export\s+\w+=|curl\s|wget\s|docker\s|docker-compose\s|apt(?:-get)?\s|brew\s|pip3?\s|chmod\s|chown\s|cat\s|grep\s|ssh\s|scp\s|tar\s|make(?:\s|$)|systemctl\s|journalctl\s|kubectl\s|source\s|psql\s|node\s|python3?\s)/u;
const SCRIPT_SIGNS: readonly RegExp[] = [
  /^\s*(?:const|let|var)\s+[\w${}[\],\s]+=/mu,
  /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*\w*\s*\(/mu,
  /=>/u,
  /^\s*import\s+[\s\S]+?\s+from\s+["'][^"']+["'];?\s*$/mu,
  /^\s*export\s+(?:default|const|function|class|interface|type|enum)\b/mu,
  /\b(?:console|document|window)\.\w+/u,
  /^\s*return\b.*;\s*$/mu,
  /\bawait\s+\w+/u,
];
const TYPESCRIPT_SIGNS: readonly RegExp[] = [
  /^\s*(?:export\s+)?interface\s+\w+/mu,
  /^\s*(?:export\s+)?type\s+\w+(?:<[^>]+>)?\s*=/mu,
  /:\s*(?:string|number|boolean|void|unknown|never|any)\b/u,
  /\b(?:readonly|private|public|protected)\s+\w+/u,
  /\bas\s+const\b/u,
];
const CSS_RULE_START = /^\s*[^{}();=]+\{\s*$/mu;
const CSS_DECLARATION = /^\s*-{0,2}[a-z][\w-]*\s*:\s*[^;{}]+;\s*$/mu;
const CSS_AT_RULE = /^\s*@(?:media|import|keyframes|font-face|supports|layer|tailwind)\b/mu;
const YAML_LINE = /^\s*(?:-\s+.*|-\s*$|[\w"'.-]+\s*:(?:\s+.*)?|#.*|---|\.\.\.)$/u;
const YAML_KEY = /^\s*[\w"'.-]+\s*:(?:\s+\S.*)?$/u;
const MARKDOWN_SIGNS: readonly RegExp[] = [
  /^#{1,6}\s+\S/mu,
  /^\s*[-*+]\s+\S/mu,
  /^\s*\d+\.\s+\S/mu,
  /\*\*[^*\n]+\*\*/u,
  /\[[^\]\n]+\]\([^)\s]+\)/u,
  /^\s*\|?\s*:?-{3,}:?\s*\|/mu,
  /^>\s+\S/mu,
  /`[^`\n]+`/u,
];
const CSV_DELIMITERS: readonly string[] = ["\t", ";", ","];
/** Characters that make a line look like code rather than separated values. */
const CODE_CHARACTERS = /[(){}=<>]/u;

function nonEmptyLines(source: string): string[] {
  return source.split("\n").filter((line) => line.trim() !== "");
}

function countMatches(source: string, signs: readonly RegExp[]): number {
  return signs.filter((sign) => sign.test(source)).length;
}

function isJson(trimmed: string): boolean {
  const first = trimmed[0];
  if (first !== "{" && first !== "[") return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    // Invalid JSON still counts when it clearly has the shape of an object.
    return first === "{" && /^\{\s*"[^"\n]+"\s*:/u.test(trimmed);
  }
}

function isSvg(trimmed: string): boolean {
  const body = trimmed.replace(/^<\?xml[^>]*>\s*/u, "");
  return /^<svg[\s>]/iu.test(body) && /<\/svg>\s*$/iu.test(body);
}

function isHtml(trimmed: string): boolean {
  if (/^<!doctype\s+html/iu.test(trimmed) || /^<html[\s>]/iu.test(trimmed))
    return true;
  if (!trimmed.startsWith("<")) return false;
  const tags = trimmed.match(HTML_TAG) ?? [];
  return tags.length >= 2 && /<\/\w+>/u.test(trimmed);
}

/** The first line of a Mermaid diagram, after front matter and comments. */
function mermaidStart(lines: readonly string[]): string {
  let index = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, at) => at > 0 && line.trim() === "---");
    index = end === -1 ? lines.length : end + 1;
  }
  const rest = lines.slice(index).map((line) => line.trim());
  return rest.find((line) => !line.startsWith("%%")) ?? "";
}

function isDiff(lines: readonly string[]): boolean {
  if (lines.some((line) => line.startsWith("diff --git "))) return true;
  const hasHeaders =
    lines.some((line) => line.startsWith("--- ")) &&
    lines.some((line) => line.startsWith("+++ "));
  return hasHeaders && lines.some((line) => line.startsWith("@@"));
}

function isShell(lines: readonly string[]): boolean {
  if (/^#!\s*\/(?:usr\/)?bin\/(?:env\s+)?(?:ba|z|da)?sh\b/u.test(lines[0] ?? ""))
    return true;
  const commands = lines.filter((line) => !line.trim().startsWith("#"));
  if (commands.length === 0) return false;
  const known = commands.filter((line) => SHELL_COMMAND.test(line.trim()));
  return known.length * 2 >= commands.length && known.length > 0;
}

function scriptLanguage(source: string): DetectedLanguage | null {
  const script = countMatches(source, SCRIPT_SIGNS);
  const typed = countMatches(source, TYPESCRIPT_SIGNS);
  if (typed >= 1 && script + typed >= 2) return "typescript";
  return script >= 2 ? "javascript" : null;
}

function isCss(source: string): boolean {
  if (/[=]>|\bfunction\b|\bconst\b/u.test(source)) return false;
  if (CSS_AT_RULE.test(source) && source.includes("{")) return true;
  return CSS_RULE_START.test(source) && CSS_DECLARATION.test(source);
}

function isYaml(lines: readonly string[]): boolean {
  if (lines.length < 2) return false;
  const keys = lines.filter((line) => YAML_KEY.test(line)).length;
  return keys >= 2 && lines.every((line) => YAML_LINE.test(line));
}

/** Splits a line at a delimiter outside of double quotes. */
function fieldCount(line: string, delimiter: string): number {
  let count = 1;
  let isQuoted = false;
  for (const character of line) {
    if (character === '"') isQuoted = !isQuoted;
    else if (character === delimiter && !isQuoted) count += 1;
  }
  return count;
}

/**
 * Finds the delimiter of separated values: the one that splits every line
 * into the same number of at least two fields.
 *
 * @param lines - The non-empty lines.
 * @returns Tab, semicolon or comma, or `null` when none fits every line.
 */
export function findCsvDelimiter(lines: readonly string[]): string | null {
  const sample = lines.slice(0, 50);
  if (sample.length < 2) return null;
  for (const delimiter of CSV_DELIMITERS) {
    const counts = sample.map((line) => fieldCount(line, delimiter));
    const first = counts[0] ?? 1;
    if (first >= 2 && counts.every((count) => count === first))
      return delimiter;
  }
  return null;
}

function csvLanguage(lines: readonly string[]): DetectedLanguage | null {
  const unquoted = lines.map((line) => line.replace(/"[^"]*"/gu, '""'));
  if (unquoted.some((line) => CODE_CHARACTERS.test(line))) return null;
  // A semicolon that ends every line ends statements, not fields.
  const delimiter = findCsvDelimiter(lines);
  if (delimiter === null) return null;
  if (lines.every((line) => line.trimEnd().endsWith(delimiter))) return null;
  return delimiter === "\t" ? "tsv" : "csv";
}

function markupLanguage(trimmed: string): DetectedLanguage | null {
  if (isJson(trimmed)) return "json";
  if (isSvg(trimmed)) return "svg";
  if (isHtml(trimmed)) return "html";
  return null;
}

function programLanguage(
  source: string,
  lines: readonly string[],
): DetectedLanguage | null {
  if (SQL_START.test(source)) return "sql";
  if (isShell(lines)) return "shell";
  if (countMatches(source, PYTHON_SIGNS) >= 2) return "python";
  const script = scriptLanguage(source);
  if (script !== null) return script;
  return isCss(source) ? "css" : null;
}

/**
 * Recognizes the language of a code block from its content.
 *
 * @param source - The content of the block.
 * @returns The hint of the language, or `null` when the content fits no
 * language clearly; such a block stays plain text.
 */
export function detectCodeLanguage(source: string): DetectedLanguage | null {
  const trimmed = source.trim();
  if (trimmed === "") return null;
  const lines = nonEmptyLines(trimmed);
  const markup = markupLanguage(trimmed);
  if (markup !== null) return markup;
  if (MERMAID_START.test(mermaidStart(lines))) return "mermaid";
  if (isDiff(lines)) return "diff";
  const program = programLanguage(trimmed, lines);
  if (program !== null) return program;
  if (isYaml(lines)) return "yaml";
  if (countMatches(trimmed, MARKDOWN_SIGNS) >= 2) return "markdown";
  return csvLanguage(lines);
}
