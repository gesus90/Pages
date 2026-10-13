import { createHash } from "node:crypto";

import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import type { ListItem, Nodes } from "mdast";
import type { AgentChecklistItem } from "@/definition/AgentTicketChecklist";
import type { WorkItemChecklistItem } from "@/definition/Task";

const parser = unified().use(remarkParse).use(remarkGfm);
const CHECKBOX_PATTERN = /\[([ xX])\]/u;

/** A task list item of a description and where its checkbox character sits. */
interface DescriptionEntry {
  readonly item: AgentChecklistItem;
  /** Offset of the character between the brackets of the checkbox. */
  readonly markerOffset: number;
}

interface WalkState {
  readonly markdown: string;
  readonly entries: DescriptionEntry[];
  /** How often an entry with the same parent and text occurred before. */
  readonly occurrences: Map<string, number>;
}

/** The checklist of a ticket together with what a change needs. */
export interface MaterializedChecklist {
  readonly items: readonly AgentChecklistItem[];
  /** Covers every stored value an entry depends on; the service turns it into a revision. */
  readonly contentHash: string;
  /** Covers requirements and order, allowing checkbox changes during a run. */
  readonly requirementsHash: string;
  /** Checkbox offsets of the description entries, by entry identifier. */
  readonly markers: ReadonlyMap<string, number>;
  /** Stored acceptance criteria, by entry identifier. */
  readonly criteria: ReadonlyMap<string, WorkItemChecklistItem>;
}

function digest(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

// The text runs from the closing bracket of the checkbox to the end of the first paragraph.
function itemText(markdown: string, node: ListItem, offset: number): string {
  const end = node.children[0]?.position?.end.offset;
  if (end === undefined) return "";
  return markdown
    .slice(offset + 2, end)
    .replace(/\s+/gu, " ")
    .trim();
}

// The checkbox is the first bracket pair after the bullet. remark-gfm moves the
// start of the first paragraph past it only when text follows; before inline
// code or emphasis the paragraph still starts at the checkbox, so the search
// runs up to the end of that paragraph.
function markerOffset(markdown: string, node: ListItem): number | null {
  const start = node.position?.start.offset;
  const contentEnd = node.children[0]?.position?.end.offset;
  if (start === undefined || contentEnd === undefined) return null;
  const match = CHECKBOX_PATTERN.exec(markdown.slice(start, contentEnd));
  return match ? start + match.index + 1 : null;
}

function describeEntry(
  node: ListItem,
  parent: DescriptionEntry | null,
  state: WalkState,
): DescriptionEntry | null {
  const offset = markerOffset(state.markdown, node);
  if (offset === null) return null;
  const text = itemText(state.markdown, node, offset);
  const parentId = parent?.item.id ?? null;
  const key = JSON.stringify([parentId, text]);
  const occurrence = state.occurrences.get(key) ?? 0;
  state.occurrences.set(key, occurrence + 1);
  return {
    markerOffset: offset,
    item: {
      id: `md-${digest([parentId, text, occurrence]).slice(0, 16)}`,
      source: "description",
      text,
      checked: node.checked === true,
      order: 0,
      depth: parent ? parent.item.depth + 1 : 0,
      parentId,
    },
  };
}

function visit(
  node: Nodes,
  parent: DescriptionEntry | null,
  state: WalkState,
): void {
  let enclosing = parent;
  if (node.type === "listItem" && typeof node.checked === "boolean") {
    const entry = describeEntry(node, parent, state);
    if (entry) {
      state.entries.push(entry);
      enclosing = entry;
    }
  }
  if (!("children" in node)) return;
  for (const child of node.children) visit(child, enclosing, state);
}

function readDescription(markdown: string): readonly DescriptionEntry[] {
  const state: WalkState = { markdown, entries: [], occurrences: new Map() };
  visit(parser.parse(markdown), null, state);
  return state.entries;
}

/**
 * Reads the task list items of any Markdown text, such as the instruction of a plan node.
 *
 * @param markdown - The text.
 * @returns The entries in document order; code blocks never contribute one.
 */
export function readMarkdownTasks(
  markdown: string,
): readonly AgentChecklistItem[] {
  return readDescription(markdown).map((entry, order) => ({
    ...entry.item,
    order,
  }));
}

/**
 * Builds the checklist of a ticket from its description and acceptance criteria.
 *
 * @param description - The stored Markdown description.
 * @param criteria - The stored acceptance criteria in their order.
 * @returns The entries in document order, description first, and a content hash.
 *
 * @remarks
 * Only real task list items count; fenced or indented code never does. An
 * entry is named by its parent, its text and how often that text occurred
 * before under the same parent, so equal texts stay distinguishable and the
 * name survives a change of the checkbox. The content hash covers every
 * stored value an entry depends on.
 */
export function materializeTicketChecklist(
  description: string,
  criteria: readonly WorkItemChecklistItem[],
): MaterializedChecklist {
  const entries = readDescription(description);
  const items: AgentChecklistItem[] = [
    ...entries.map((entry) => entry.item),
    ...criteria.map((criterion): AgentChecklistItem => ({
      id: `ac-${criterion.id}`,
      source: "criteria",
      text: criterion.title,
      checked: criterion.isDone,
      order: 0,
      depth: 0,
      parentId: null,
    })),
  ].map((item, order) => ({ ...item, order }));
  return {
    items,
    contentHash: digest([
      description,
      criteria.map((entry) => [
        entry.id,
        entry.title,
        entry.isDone,
        entry.sortOrder,
      ]),
    ]),
    requirementsHash: digest([
      entries.reduce(
        (markdown, entry) =>
          setDescriptionCheckbox(markdown, entry.markerOffset, false),
        description,
      ),
      criteria.map((entry) => [entry.id, entry.title, entry.sortOrder]),
    ]),
    markers: new Map(
      entries.map((entry) => [entry.item.id, entry.markerOffset]),
    ),
    criteria: new Map(criteria.map((entry) => [`ac-${entry.id}`, entry])),
  };
}

/**
 * Sets one checkbox of a description and leaves every other character as it is.
 *
 * @param markdown - The stored description.
 * @param offset - The checkbox character of the entry, from {@link materializeTicketChecklist}.
 * @param checked - The state to set.
 * @returns The description with that one character replaced.
 */
export function setDescriptionCheckbox(
  markdown: string,
  offset: number,
  checked: boolean,
): string {
  return `${markdown.slice(0, offset)}${checked ? "x" : " "}${markdown.slice(offset + 1)}`;
}
