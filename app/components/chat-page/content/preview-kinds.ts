import { syntaxLanguageLabel } from "./syntax-highlight";

/**
 * The kinds of code the chat shows as a preview: HTML and SVG in
 * the sandbox, Mermaid as a diagram, JSON as a tree and CSV or TSV as a
 * table. Markdown has its own card.
 */
export type PreviewKind = "html" | "svg" | "mermaid" | "json" | "csv" | "tsv";

/** One file of a preview, as its code tab shows it. */
export interface PreviewFile {
  /** The file name, such as `index.html`, `style.css` or `app.js`. */
  readonly name: string;
  /** The language of the fence or the recognized one; decides colors and role. */
  readonly languageHint: string;
  readonly source: string;
}

const PREVIEW_HINTS: ReadonlyMap<string, PreviewKind> = new Map([
  ["html", "html"],
  ["htm", "html"],
  ["xhtml", "html"],
  ["svg", "svg"],
  ["mermaid", "mermaid"],
  ["mmd", "mermaid"],
  ["json", "json"],
  ["csv", "csv"],
  ["tsv", "tsv"],
]);

/** Labels of the kinds the syntax colors do not know. */
const OWN_LABELS: ReadonlyMap<string, string> = new Map([
  ["mermaid", "Mermaid"],
  ["mmd", "Mermaid"],
  ["csv", "CSV"],
  ["tsv", "TSV"],
  ["txt", "Text"],
  ["text", "Text"],
  ["log", "Log"],
]);

/** The file names a preview gives blocks without a name, by role. */
const DEFAULT_FILE_NAMES: Readonly<Record<PreviewKind | "css" | "js", string>> =
  {
    html: "index.html",
    svg: "image.svg",
    mermaid: "diagram.mmd",
    json: "data.json",
    csv: "table.csv",
    tsv: "table.tsv",
    css: "style.css",
    js: "app.js",
  };

/** The key of a hint: its first word, or the ending of a file name. */
function hintKey(hint: string): string {
  const firstWord = hint.trim().split(/\s/u, 1)[0] ?? "";
  const ending = firstWord.slice(firstWord.lastIndexOf(".") + 1);
  return ending.toLowerCase();
}

/**
 * The kind of preview a code block gets.
 * @param languageHint - The language of the fence, the recognized language
 * or a file name.
 * @returns The kind, or `null` for code without a preview.
 */
export function previewKindOf(languageHint: string): PreviewKind | null {
  return PREVIEW_HINTS.get(hintKey(languageHint)) ?? null;
}

/**
 * The name of a language as a card head shows it, such as `TypeScript`,
 * `Mermaid` or `CSV`.
 * @param languageHint - The language of the fence or a file name.
 * @returns The label; empty for an empty hint.
 */
export function codeKindLabel(languageHint: string): string {
  return (
    OWN_LABELS.get(hintKey(languageHint)) ?? syntaxLanguageLabel(languageHint)
  );
}

/**
 * Tells the role of a code block next to an HTML block of the same message.
 * @param languageHint - The language of the block.
 * @returns `css` or `js` for a block that joins the preview, else `null`.
 */
export function companionRole(languageHint: string): "css" | "js" | null {
  const label = syntaxLanguageLabel(languageHint);
  if (label === "CSS") return "css";
  return label === "JavaScript" ? "js" : null;
}

/**
 * The file name of a block of a preview: its own, or the default of its role.
 * @param name - The name the fence gives, or empty.
 * @param role - The kind of preview or the role next to HTML.
 * @param index - The position among blocks of the same role, from 0; later
 * blocks are numbered, such as `style-2.css`.
 */
export function previewFileName(
  name: string,
  role: PreviewKind | "css" | "js",
  index = 0,
): string {
  if (name !== "") return name;
  const fallback = DEFAULT_FILE_NAMES[role];
  if (index === 0) return fallback;
  const dot = fallback.lastIndexOf(".");
  return `${fallback.slice(0, dot)}-${String(index + 1)}${fallback.slice(dot)}`;
}
