import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import type { Nodes, Root } from "mdast";
import type { AgentImportAsset } from "@/definition/AgentImportManifest";

const parser = unified().use(remarkParse).use(remarkGfm);

/** Parses Markdown with the grammar of the wiki, so every import reader sees the same nodes. */
export function parseMarkdown(content: string): Root {
  return parser.parse(content);
}

/** Visits a node and all of its descendants, parents first. */
export function walkMarkdown(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ("children" in node)
    for (const child of node.children) walkMarkdown(child, visit);
}

/**
 * Tells whether a link target is a relative file or image reference.
 *
 * @param url - The parsed target of a link or image.
 * @param isImage - Whether the target belongs to an image.
 * @remarks
 * Absolute URLs, absolute paths, anchors and queries are not relative. A link
 * to another Markdown page is a page link and never an asset.
 */
export function isRelativeAssetLink(url: string, isImage: boolean): boolean {
  if (!url || /^(?:[a-z][a-z0-9+.-]*:|[/\\#?])/i.test(url)) return false;
  return isImage || !/\.md(?:[?#]|$)/i.test(url);
}

/** Lists used relative image/file links, including reference links; code, HTML and remote URLs are inert. */
export function scanRelativeLinks(
  sourceKey: string,
  content: string,
): AgentImportAsset[] {
  const tree = parseMarkdown(content);
  const definitions = new Map<string, string>();
  walkMarkdown(tree, (node) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  });
  const mentions = new Map<string, AgentImportAsset>();
  walkMarkdown(tree, (node) => {
    let url: string | undefined;
    if (node.type === "link" || node.type === "image") url = node.url;
    else if (node.type === "linkReference" || node.type === "imageReference")
      url = definitions.get(node.identifier);
    const isImage = node.type === "image" || node.type === "imageReference";
    if (url === undefined || !isRelativeAssetLink(url, isImage)) return;
    const kind = isImage ? "image" : "file";
    mentions.set(`${kind}:${url}`, { sourceKey, url, kind });
  });
  return [...mentions.values()];
}
