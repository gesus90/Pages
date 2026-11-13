import { AgentAssetReferenceError } from "@/backend/error/AgentAssetReferenceError";
import { AgentError } from "@/backend/error/AgentErrors";
import { logEvent } from "@/backend/logging/Logger";

import { parseMarkdown, walkMarkdown } from "./RelativeLinkScanner";

import type { AgentTicketAsset } from "@/definition/AgentTicketParameter";

const ASSET_PATH =
  /\/(aufgaben\/attachments|wiki\/attachments|agent-assets)\/([\w-]+)\/?(?:[?#].*)?$/;

/** Keeps the strict reference policy for wiki and directly bound plan assets. */
export function requireAssetReferences(
  expected: readonly AgentTicketAsset[],
  current: readonly AgentTicketAsset[],
): void {
  if (JSON.stringify(expected) !== JSON.stringify(current))
    throw new AgentError("parameter_ticket_changed");
}

/** Reports ticket changes as information; the first manifest and its copies remain the handoff. */
export function reportTicketAssetChanges(
  expected: readonly AgentTicketAsset[],
  current: readonly AgentTicketAsset[],
  changed: readonly string[] = [],
): void {
  const key = (asset: AgentTicketAsset): string =>
    `${asset.source}:${asset.id}`;
  const previous = new Set(expected.map(key));
  const latest = new Set(current.map(key));
  const added = current.filter((asset) => !previous.has(key(asset))).length;
  const removed = expected.filter((asset) => !latest.has(key(asset))).length;
  const modified = new Set(changed).size;
  const messages: string[] = [];
  if (added > 0)
    messages.push(
      added === 1
        ? "1 Anhang kam nach dem Start dazu und ist nicht in diesem Lauf."
        : `${added} Anhänge kamen nach dem Start dazu und sind nicht in diesem Lauf.`,
    );
  if (removed + modified > 0)
    messages.push(
      removed + modified === 1
        ? "1 Anhang wurde nach dem Start geändert oder entfernt. Dieser Lauf nutzt seine geprüfte Kopie vom Start."
        : `${removed + modified} Anhänge wurden nach dem Start geändert oder entfernt. Dieser Lauf nutzt seine geprüften Kopien vom Start.`,
    );
  if (messages.length)
    logEvent({
      level: "info",
      event: "agent.ticket_assets.snapshot",
      component: "AgentTicketAssetReferences",
      message: messages.join(" "),
    });
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
      !/^(?:https?:)?\/\//iu.test(url) &&
      (node.type === "image" ||
        node.type === "imageReference" ||
        /\.(?:png|jpe?g|webp|svg|pdf|txt|md|json|html|css)(?:[?#]|$)/iu.test(
          url,
        ))
    )
      throw new AgentAssetReferenceError(url);
  });
  return [...references.values()];
}

/** External sources remain references; this scanner never authorizes a network request. */
export function externalAssetNotes(markdown: string): string {
  const tree = parseMarkdown(markdown);
  const definitions = new Map<string, string>();
  walkMarkdown(tree, (node) => {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
  });
  const sources = new Set<string>();
  walkMarkdown(tree, (node) => {
    let url: string | undefined;
    if (node.type === "image" || node.type === "link") url = node.url;
    if (node.type === "imageReference" || node.type === "linkReference")
      url = definitions.get(node.identifier);
    if (url && /^(?:https?:)?\/\//iu.test(url) && !ticketAssetReference(url))
      sources.add(url);
  });
  if (!sources.size) return "";
  return `\n\nPages external image sources (reference only; not downloaded, imported or viewed; use an authorized HTTP tool if required):\n${JSON.stringify([...sources].map((url) => ({ url, status: "not-fetched" })))}`;
}
