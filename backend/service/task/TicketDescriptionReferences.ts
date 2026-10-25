import {
  parseMarkdown,
  walkMarkdown,
} from "@/backend/service/agents/RelativeLinkScanner";
import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import type { Nodes } from "mdast";

/** A live Markdown destination, with offsets for an exact text-preserving replacement. */
export interface TicketDescriptionReference {
  readonly url: string;
  readonly isImage: boolean;
  readonly start: number;
  readonly end: number;
}

/** Parses only local attachment routes; a foreign host with a similar path is never trusted. */
export function ticketDescriptionAddress(
  url: string,
): { readonly source: "agent" | "ticket"; readonly id: string } | null {
  const match =
    /^\/(agent-assets|aufgaben\/attachments)\/([\w-]+)(?:[?#][^\s]*)?$/.exec(
      url,
    );
  if (!match) return null;
  return {
    source: match[1] === "agent-assets" ? "agent" : "ticket",
    id: match[2],
  };
}

function referenceAt(
  markdown: string,
  node: Nodes,
  url: string,
  isImage: boolean,
): TicketDescriptionReference {
  const start = node.position?.start.offset ?? 0;
  const end = node.position?.end.offset ?? start;
  const raw = markdown.slice(start, end);
  const offset = raw.indexOf(url, destinationStart(raw));
  return {
    url,
    isImage,
    start: offset < 0 ? -1 : start + offset,
    end: offset < 0 ? -1 : start + offset + url.length,
  };
}

function destinationStart(raw: string): number {
  if (raw.startsWith("<")) return 1;
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") depth += 1;
    if (character !== "]") continue;
    depth -= 1;
    if (depth === 0) return index + 2;
  }
  return 0;
}

/** Finds inline and reference-style destinations; fenced code and inline code remain inert. */
export function ticketDescriptionReferences(
  markdown: string,
): readonly TicketDescriptionReference[] {
  const tree = parseMarkdown(markdown);
  const definitions = new Map<string, Extract<Nodes, { type: "definition" }>>();
  walkMarkdown(tree, (node) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
  });
  const references: TicketDescriptionReference[] = [];
  walkMarkdown(tree, (node) => {
    if (node.type === "image" || node.type === "link")
      references.push(
        referenceAt(markdown, node, node.url, node.type === "image"),
      );
    if (node.type === "imageReference" || node.type === "linkReference") {
      const definition = definitions.get(node.identifier);
      if (definition)
        references.push(
          referenceAt(
            markdown,
            definition,
            definition.url,
            node.type === "imageReference",
          ),
        );
    }
    // HTML is inert in the renderer, but must not become a way to persist external images.
    if (node.type === "html" && /<(?:img|source|picture)\b/i.test(node.value))
      references.push({ url: node.value, isImage: true, start: -1, end: -1 });
  });
  return references;
}

/** Rewrites destinations only, preserving surrounding Markdown and code samples byte for byte. */
export function rewriteTicketDescription(
  markdown: string,
  replacements: ReadonlyMap<TicketDescriptionReference, string>,
): string {
  const offsets = new Map<
    number,
    { readonly end: number; readonly url: string }
  >();
  for (const [reference, url] of replacements) {
    if (reference.start < 0)
      throw new WorkItemValidationError("attachmentUploadRequired");
    offsets.set(reference.start, { end: reference.end, url });
  }
  let rewritten = markdown;
  for (const [start, replacement] of [...offsets.entries()].sort(
    ([first], [second]) => second - first,
  ))
    rewritten =
      rewritten.slice(0, start) +
      replacement.url +
      rewritten.slice(replacement.end);
  if (
    ticketDescriptionReferences(rewritten).some(
      (reference) =>
        ticketDescriptionAddress(reference.url)?.source === "agent",
    )
  )
    throw new WorkItemValidationError("attachmentUploadRequired");
  return rewritten;
}
