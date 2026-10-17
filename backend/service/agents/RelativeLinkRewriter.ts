import { logCaughtError } from "@/backend/logging/Logger";

import {
  isRelativeAssetLink,
  parseMarkdown,
  walkMarkdown,
} from "./RelativeLinkScanner";

import type { Definition, Image, Link, Nodes } from "mdast";
import type { AgentStructuredLinkOutcome } from "@/definition/AgentStructuredImportManifest";

/** The result of rewriting one Markdown source. */
export interface RewrittenMarkdown {
  /** The exact source, except for the destinations that now point to an asset. */
  readonly content: string;
  /** Every relative link of the source and what became of it, once per kind and target. */
  readonly links: readonly AgentStructuredLinkOutcome[];
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

type Outcome = Pick<AgentStructuredLinkOutcome, "assetId" | "reason">;

/** A destination found in the raw text of a link, as offsets into the whole source. */
interface RawDestination {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const INLINE_RESOURCE =
  /\(\s*(<(?:[^<>\n\\]|\\.)*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*)(?:\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?\s*\)$/d;
const DEFINITION_RESOURCE =
  /^\[(?:[^\]\\]|\\.)*\]:\s*(<(?:[^<>\n\\]|\\.)*>|\S+)/d;

/** The address the Pages file link of an asset uses; it stays valid after the page is linked. */
export function assetLink(assetId: string): string {
  return `/agent-assets/${assetId}`;
}

/**
 * Resolves a relative link target against the folder of its source.
 *
 * @param sourceKey - The relative path of the Markdown file that holds the link.
 * @param url - The parsed link target.
 * @returns The path below the manifest root and the untouched `?query#fragment`
 * suffix, or `null` when the target leaves the root or is not a clean path.
 */
export function resolveAssetPath(
  sourceKey: string,
  url: string,
): { readonly path: string; readonly suffix: string } | null {
  const cut = url.search(/[?#]/);
  const target = cut === -1 ? url : url.slice(0, cut);
  const suffix = cut === -1 ? "" : url.slice(cut);
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch (caughtError: unknown) {
    logCaughtError("RelativeLinkRewriter", caughtError);

    return null;
  }
  if (/[\\\u0000-\u001f]/u.test(decoded)) return null;
  const segments = sourceKey.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.length
    ? { path: segments.join("/").normalize("NFC"), suffix }
    : null;
}

/** Finds the destination of an inline link or image inside its raw text, anchored at its closing parenthesis. */
function inlineDestination(raw: string): { from: number; text: string } | null {
  const match = INLINE_RESOURCE.exec(raw);
  if (!match) return null;
  // Both /d patterns have a mandatory first capture, including its offsets.
  const group = (match.indices as [[number, number], [number, number]])[1];
  return { from: group[0], text: match[1] };
}

function definitionDestination(
  raw: string,
): { from: number; text: string } | null {
  const match = DEFINITION_RESOURCE.exec(raw);
  if (!match) return null;
  // Both /d patterns have a mandatory first capture, including its offsets.
  const group = (match.indices as [[number, number], [number, number]])[1];
  return { from: group[0], text: match[1] };
}

function locate(
  content: string,
  offset: number,
  node: Image | Link | Definition,
): RawDestination | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return null;
  const raw = content.slice(start + offset, end + offset);
  const found =
    node.type === "definition"
      ? definitionDestination(raw)
      : inlineDestination(raw);
  if (!found || !found.text) return null;
  const from = start + offset + found.from;
  return { start: from, end: from + found.text.length, text: found.text };
}

/**
 * Rewrites the relative image and file links of one Markdown source to the
 * authenticated link of the asset they name.
 *
 * @param sourceKey - The relative path of the source, which links resolve against.
 * @param content - The exact Markdown.
 * @param assets - Asset IDs by path below the manifest root.
 * @returns The Markdown with only those destinations replaced, and every relative link with its fate.
 *
 * @remarks
 * Links are found in the parsed tree, so code blocks, inline code and raw HTML
 * are never touched. A fragment or query after the path stays as written. A
 * destination is replaced only when its raw text holds no escape or entity and
 * equals the parsed address; anything else stays unchanged and is reported.
 */
export function rewriteRelativeLinks(
  sourceKey: string,
  content: string,
  assets: ReadonlyMap<string, string>,
): RewrittenMarkdown {
  const offset = content.startsWith("﻿") ? 1 : 0;
  const tree = parseMarkdown(content.slice(offset));
  const used = new Set<string>();
  const firstDefinition = new Map<string, Definition>();
  walkMarkdown(tree, (node) => {
    if (node.type === "linkReference" || node.type === "imageReference")
      used.add(node.identifier);
    if (node.type === "definition" && !firstDefinition.has(node.identifier))
      firstDefinition.set(node.identifier, node);
  });
  const edits: Edit[] = [];
  const links = new Map<string, AgentStructuredLinkOutcome>();
  const consider = (
    node: Image | Link | Definition,
    isImage: boolean,
  ): void => {
    if (!isRelativeAssetLink(node.url, isImage)) return;
    const kind = isImage ? "image" : "file";
    const outcome = rewriteOne(content, offset, node, { sourceKey, assets });
    if (outcome.edit) edits.push(outcome.edit);
    links.set(`${kind}:${node.url}`, {
      sourceKey,
      url: node.url,
      kind,
      ...outcome.result,
    });
  };
  walkMarkdown(tree, (node: Nodes) => {
    if (node.type === "link") consider(node, false);
    else if (node.type === "image") consider(node, true);
    else if (
      node.type === "definition" &&
      used.has(node.identifier) &&
      firstDefinition.get(node.identifier) === node
    )
      consider(node, isImageDefinition(tree, node.identifier));
  });
  let rewritten = content;
  for (const edit of [...edits].sort((left, right) => right.start - left.start))
    rewritten =
      rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
  return { content: rewritten, links: [...links.values()] };
}

/** A definition counts as an image target when any image reference uses it. */
function isImageDefinition(tree: Nodes, identifier: string): boolean {
  let isImage = false;
  walkMarkdown(tree, (node) => {
    if (node.type === "imageReference" && node.identifier === identifier)
      isImage = true;
  });
  return isImage;
}

function rewriteOne(
  content: string,
  offset: number,
  node: Image | Link | Definition,
  context: {
    readonly sourceKey: string;
    readonly assets: ReadonlyMap<string, string>;
  },
): { readonly edit: Edit | null; readonly result: Outcome } {
  const resolved = resolveAssetPath(context.sourceKey, node.url);
  if (!resolved)
    return { edit: null, result: { assetId: null, reason: "outside_root" } };
  const assetId = context.assets.get(resolved.path);
  if (assetId === undefined)
    return { edit: null, result: { assetId: null, reason: "no_asset" } };
  const destination = locate(content, offset, node);
  if (!destination)
    return {
      edit: null,
      result: { assetId: null, reason: "unsupported_syntax" },
    };
  const wrapped = destination.text.startsWith("<");
  const written = wrapped ? destination.text.slice(1, -1) : destination.text;
  // Anything with an escape or an entity could mean another address than it shows.
  if (/[\\&]/.test(written) || written !== node.url)
    return {
      edit: null,
      result: { assetId: null, reason: "unsupported_syntax" },
    };
  const target = `${assetLink(assetId)}${resolved.suffix}`;
  return {
    edit: {
      start: destination.start,
      end: destination.end,
      text: wrapped ? `<${target}>` : target,
    },
    result: { assetId, reason: null },
  };
}
