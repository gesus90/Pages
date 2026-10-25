import { AgentError } from "@/backend/error/AgentErrors";

import { parseMarkdown, walkMarkdown } from "./RelativeLinkScanner";

import type { AgentTicketAsset } from "@/definition/AgentTicketParameter";

const ASSET_PATH =
  /\/(aufgaben\/attachments|wiki\/attachments|agent-assets)\/([\w-]+)\/?(?:[?#].*)?$/;

/** Rejects a changed file handoff while allowing unrelated content and status revisions. */
export function requireAssetReferences(
  expected: readonly AgentTicketAsset[],
  current: readonly AgentTicketAsset[],
): void {
  if (JSON.stringify(expected) !== JSON.stringify(current))
    throw new AgentError("parameter_ticket_changed");
}

/** Recognizes Pages attachment addresses without fetching arbitrary network locations. */
export function ticketAssetReference(url: string): AgentTicketAsset | null {
  const match = ASSET_PATH.exec(url);
  if (!match) return null;
  const sources: Readonly<Record<string, AgentTicketAsset["source"]>> = {
    "agent-assets": "agent",
    "wiki/attachments": "wiki",
    "aufgaben/attachments": "ticket",
  };
  const source = sources[match[1]];
  return { source, id: match[2], link: `/${match[1]}/${match[2]}` };
}

/** Finds inline and reference-style assets; code examples never request file access. */
export function ticketAssetReferences(
  markdown: string,
): readonly AgentTicketAsset[] {
  const tree = parseMarkdown(markdown);
  const definitions = new Map<string, string>();
  walkMarkdown(tree, (node) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  });
  const references = new Map<string, AgentTicketAsset>();
  walkMarkdown(tree, (node) => {
    let url: string | undefined;
    if (node.type === "image" || node.type === "link") url = node.url;
    if (node.type === "imageReference" || node.type === "linkReference")
      url = definitions.get(node.identifier);
    if (url === undefined) return;
    const reference = ticketAssetReference(url);
    if (reference) references.set(reference.link, reference);
    else if (
      node.type === "image" ||
      node.type === "imageReference" ||
      /\.(?:png|txt)(?:[?#]|$)/i.test(url)
    )
      throw new AgentError("parameter_asset_reference_unsupported");
  });
  return [...references.values()];
}
