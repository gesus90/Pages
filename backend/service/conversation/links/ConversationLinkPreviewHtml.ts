import {
  MAXIMUM_LINK_DESCRIPTION_LENGTH,
  MAXIMUM_LINK_IMAGE_URL_LENGTH,
  MAXIMUM_LINK_TITLE_LENGTH,
} from "./ConversationLinkFetcher";

import type { ConversationLinkPreview } from "./ConversationLinkFetcher";

/** The undecoded texts found in a document; `null` until the first occurrence. */
interface PreviewFindings {
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  title: string | null;
  description: string | null;
}

interface AttributeValue {
  readonly text: string;
  readonly end: number;
}

interface TagAttributes {
  readonly attributes: ReadonlyMap<string, string>;
  readonly end: number;
}

// Sticky and without the `u` flag: with it, `i` would let U+017F match "s".
const TAG_START = /<(!--|(?:meta|title|script|style)(?=[\s/>]))/iy;

const META_FIELDS: ReadonlyMap<string, keyof PreviewFindings> = new Map([
  ["og:title", "ogTitle"],
  ["og:description", "ogDescription"],
  ["og:image", "ogImage"],
  ["description", "description"],
]);

const ENTITY = /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos|nbsp);/giu;

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

const GREATER_THAN = 62;
const SLASH = 47;
const EQUALS = 61;

function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
}

function isAttributeGap(code: number): boolean {
  return isWhitespace(code) || code === SLASH;
}

function isNamePart(code: number): boolean {
  return !isAttributeGap(code) && code !== GREATER_THAN && code !== EQUALS;
}

function isUnquotedPart(code: number): boolean {
  return !isWhitespace(code) && code !== GREATER_THAN;
}

function skipWhile(
  html: string,
  from: number,
  matches: (code: number) => boolean,
): number {
  let position = from;
  while (position < html.length && matches(html.charCodeAt(position)))
    position += 1;
  return position;
}

/** Returns the position behind the marker; the end of the document when it is missing, which ends the scan. */
function endOfMarker(html: string, marker: string, from: number): number {
  const start = html.indexOf(marker, from);
  return start === -1 ? html.length : start + marker.length;
}

function readAttributeValue(html: string, from: number): AttributeValue {
  let position = skipWhile(html, from, isWhitespace);
  if (html.charCodeAt(position) !== EQUALS) return { text: "", end: from };
  position = skipWhile(html, position + 1, isWhitespace);
  const quote = html.charAt(position);
  if (quote !== '"' && quote !== "'") {
    const end = skipWhile(html, position, isUnquotedPart);
    return { text: html.slice(position, end), end };
  }
  const close = html.indexOf(quote, position + 1);
  // An unclosed quote swallows the rest, so no later search repeats this one.
  if (close === -1) return { text: html.slice(position + 1), end: html.length };
  return { text: html.slice(position + 1, close), end: close + 1 };
}

/** Reads the attributes of a start tag; the first occurrence of a name wins, as in browsers. */
function readAttributes(html: string, from: number): TagAttributes {
  const attributes = new Map<string, string>();
  let position = skipWhile(html, from, isAttributeGap);
  while (position < html.length && html.charCodeAt(position) !== GREATER_THAN) {
    // The first character always belongs to the name, so every round advances.
    const nameEnd = skipWhile(html, position + 1, isNamePart);
    const name = html.slice(position, nameEnd).toLowerCase();
    const assigned = readAttributeValue(html, nameEnd);
    if (!attributes.has(name)) attributes.set(name, assigned.text);
    position = skipWhile(html, assigned.end, isAttributeGap);
  }
  return { attributes, end: Math.min(position + 1, html.length) };
}

function readMetaTag(
  html: string,
  from: number,
  findings: PreviewFindings,
): number {
  const { attributes, end } = readAttributes(html, from);
  const content = attributes.get("content");
  if (content === undefined || content.trim() === "") return end;
  for (const key of [attributes.get("property"), attributes.get("name")]) {
    const field = META_FIELDS.get((key ?? "").trim().toLowerCase());
    if (field !== undefined) {
      findings[field] ??= content;
      return end;
    }
  }
  return end;
}

/** Skips the text of `title`, `script` or `style`, keeping the first title. */
function readRawTextElement(
  html: string,
  element: string,
  from: number,
  findings: PreviewFindings,
): number {
  const contentStart = endOfMarker(html, ">", from);
  const closingTag = new RegExp(`</${element}`, "gi");
  closingTag.lastIndex = contentStart;
  const closing = closingTag.exec(html);
  const contentEnd = closing === null ? html.length : closing.index;
  if (element === "title")
    findings.title ??= html.slice(contentStart, contentEnd);
  return closing === null ? html.length : closingTag.lastIndex;
}

/** Handles the tag at `start` and returns where the scan continues, always behind `start`. */
function readTag(
  html: string,
  start: number,
  findings: PreviewFindings,
): number {
  TAG_START.lastIndex = start;
  const match = TAG_START.exec(html);
  if (match === null) return start + 1;
  const kind = match[1].toLowerCase();
  const afterName = start + match[0].length;
  if (kind === "!--") return endOfMarker(html, "-->", afterName);
  if (kind === "meta") return readMetaTag(html, afterName, findings);
  return readRawTextElement(html, kind, afterName, findings);
}

/**
 * Walks the document once. Every search either moves forward or, when its
 * closing marker is missing, ends the walk, so the time stays linear.
 */
function scanDocument(html: string): PreviewFindings {
  const findings: PreviewFindings = {
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    title: null,
    description: null,
  };
  let position = html.indexOf("<");
  while (position !== -1) {
    position = html.indexOf("<", readTag(html, position, findings));
  }
  return findings;
}

function decodeEntity(whole: string, body: string): string {
  const name = body.toLowerCase();
  if (!name.startsWith("#")) return NAMED_ENTITIES.get(name) ?? whole;
  const code = name.startsWith("#x")
    ? Number.parseInt(name.slice(2), 16)
    : Number.parseInt(name.slice(1), 10);
  const isScalar =
    code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
  return isScalar ? String.fromCodePoint(code) : "\ufffd";
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY, decodeEntity);
}

function cutText(text: string, maximum: number): string {
  if (text.length <= maximum) return text;
  const last = text.charCodeAt(maximum - 1);
  // Never end on half of a surrogate pair.
  const end = last >= 0xd800 && last <= 0xdbff ? maximum - 1 : maximum;
  return text.slice(0, end).trimEnd();
}

function cleanText(raw: string | null, maximum: number): string {
  if (raw === null) return "";
  const text = decodeEntities(raw).replace(/\s+/gu, " ").trim();
  return cutText(text, maximum);
}

function resolveImageUrl(raw: string | null, baseUrl: string): string | null {
  const reference = decodeEntities(raw ?? "").trim();
  if (reference === "") return null;
  try {
    const url = new URL(reference, baseUrl);
    const isWeb = url.protocol === "http:" || url.protocol === "https:";
    const isShort = url.href.length <= MAXIMUM_LINK_IMAGE_URL_LENGTH;
    return isWeb && isShort ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Reads the link card data from the HTML of a page without building a DOM.
 *
 * @remarks
 * Open Graph tags win over `<title>` and `<meta name="description">`. The
 * input is attacker-controlled; the scan is linear in its length.
 *
 * @param html - Document text, possibly cut off anywhere.
 * @param baseUrl - Final address of the page, against which the image address is resolved.
 * @returns The preview, or `null` when neither title nor description nor image was found.
 */
export function readLinkPreview(
  html: string,
  baseUrl: string,
): ConversationLinkPreview | null {
  const findings = scanDocument(html);
  const title =
    cleanText(findings.ogTitle, MAXIMUM_LINK_TITLE_LENGTH) ||
    cleanText(findings.title, MAXIMUM_LINK_TITLE_LENGTH);
  const description =
    cleanText(findings.ogDescription, MAXIMUM_LINK_DESCRIPTION_LENGTH) ||
    cleanText(findings.description, MAXIMUM_LINK_DESCRIPTION_LENGTH);
  const imageUrl = resolveImageUrl(findings.ogImage, baseUrl);
  if (title === "" && description === "" && imageUrl === null) return null;
  return { title, description, imageUrl };
}
