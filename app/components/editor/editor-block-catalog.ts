import {
  Bot,
  ChevronRight,
  Code2,
  FilePlus2,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Info,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  Pilcrow,
  Quote,
  Smile,
  Table2,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";
import type { InsertKind } from "@/app/lib/editor/editor-commands";
import type { EditorShortcut } from "@/app/lib/editor/editor-shortcuts";

/** Groups of the slash menu. */
export type BlockOptionGroup = "basic" | "media" | "advanced" | "assistant";

/** Entries that need more than a document change. */
export type SpecialBlockKey = "file" | "page" | "emoji" | "assistant";

/** An entry of the slash and plus menu. */
export interface BlockOption {
  readonly key: InsertKind | SpecialBlockKey;
  readonly group: BlockOptionGroup;
  readonly icon: LucideIcon;
  /** Search words in English and German, including slash commands. */
  readonly keywords: string;
  readonly shortcut?: EditorShortcut;
  /**
   * What typed at the start of a line turns into this block. The menu shows
   * it, so the deviation from Notion is visible: `>` makes a quote, toggles
   * come from `/toggle`.
   */
  readonly markdown?: string;
}

/** Everything the slash menu offers, in menu order. */
export const BLOCK_OPTIONS: readonly BlockOption[] = [
  {
    group: "basic",
    icon: Pilcrow,
    key: "paragraph",
    keywords: "text paragraph plain absatz",
    shortcut: "paragraph",
  },
  {
    group: "basic",
    icon: Heading1,
    key: "heading1",
    markdown: "#",
    keywords: "h1 heading title überschrift titel",
    shortcut: "heading1",
  },
  {
    group: "basic",
    icon: Heading2,
    key: "heading2",
    markdown: "##",
    keywords: "h2 heading überschrift",
    shortcut: "heading2",
  },
  {
    group: "basic",
    icon: Heading3,
    key: "heading3",
    markdown: "###",
    keywords: "h3 heading überschrift",
    shortcut: "heading3",
  },
  {
    group: "basic",
    icon: List,
    key: "bulletList",
    markdown: "-",
    keywords: "bullet list ul aufzählung liste",
    shortcut: "bulletList",
  },
  {
    group: "basic",
    icon: ListOrdered,
    key: "orderedList",
    markdown: "1.",
    keywords: "numbered ordered list ol num nummeriert liste",
    shortcut: "orderedList",
  },
  {
    group: "basic",
    icon: ListChecks,
    key: "taskList",
    markdown: "[ ]",
    keywords: "todo task checkbox aufgabe checkliste",
    shortcut: "taskList",
  },
  {
    group: "basic",
    icon: ChevronRight,
    key: "toggle",
    keywords: "toggle collapse details ausklappen einklappen",
  },
  {
    group: "basic",
    icon: Quote,
    key: "quote",
    markdown: ">",
    keywords: "quote blockquote zitat",
    shortcut: "quote",
  },
  {
    group: "basic",
    icon: Info,
    key: "callout",
    keywords: "callout note hint hinweis notiz box",
  },
  {
    group: "basic",
    icon: FilePlus2,
    key: "page",
    keywords: "page subpage seite unterseite",
  },
  {
    group: "media",
    icon: Image,
    key: "file",
    keywords: "image file upload picture bild datei hochladen anhang",
  },
  { group: "media", icon: Smile, key: "emoji", keywords: "emoji icon symbol" },
  {
    group: "advanced",
    icon: Code2,
    key: "codeBlock",
    markdown: "```",
    keywords: "code codeblock snippet quelltext",
    shortcut: "codeBlock",
  },
  {
    group: "advanced",
    icon: Table2,
    key: "table",
    keywords: "table grid tabelle",
  },
  {
    group: "advanced",
    icon: Minus,
    key: "divider",
    markdown: "---",
    keywords: "divider rule hr line trennlinie linie",
  },
  {
    group: "advanced",
    icon: ListTree,
    key: "contents",
    keywords: "toc contents outline inhaltsverzeichnis",
  },
  {
    group: "assistant",
    icon: Bot,
    key: "assistant",
    keywords: "ai assistant ki assistent textassistenz",
    shortcut: "textAssistant",
  },
];

function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Filters the slash menu.
 *
 * @param options - The entries that are available here.
 * @param query - What follows the slash.
 * @param labelOf - Gives the translated name of an entry.
 * @returns Entries whose name or search words contain every typed word.
 */
export function filterBlockOptions(
  options: readonly BlockOption[],
  query: string,
  labelOf: (option: BlockOption) => string,
): BlockOption[] {
  const words = fold(query)
    .split(/\s+/)
    .filter((word) => word !== "");

  return options.filter((option) => {
    const haystack = fold(`${labelOf(option)} ${option.keywords}`);

    return words.every((word) => haystack.includes(word));
  });
}
