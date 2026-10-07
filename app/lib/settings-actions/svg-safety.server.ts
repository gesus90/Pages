/**
 * Elements an SVG logo may not contain: scripts, embedded documents and
 * media, and elements that rewrite attributes while the image runs. A
 * namespace prefix such as `svg:script` does not hide them.
 */
const FORBIDDEN_ELEMENTS = [
  "script",
  "foreignObject",
  "iframe",
  "embed",
  "object",
  "audio",
  "video",
  "animate",
  "set",
  "handler",
  "listener",
].map((name) => new RegExp(`<(?:[\\w-]+:)?${name}(?=[\\s/>])`, "iu"));

/** Other markup that has no place in a logo. */
const FORBIDDEN_PATTERNS = [
  // A document type can define entities that blow up or read files.
  /<!doctype/iu,
  /<!entity/iu,
  // Processing instructions such as `xml-stylesheet`; only the XML declaration stays.
  /<\?(?!xml\s)/iu,
  /\son[\w:-]+\s*=/iu,
  /javascript:/iu,
  /@import/iu,
  // Text that is not UTF-8 would hide all of the above from these checks.
  /\u0000/u,
  /<\?xml[^>]*encoding\s*=\s*["'](?!utf-8["'])/iu,
];

const SVG_ROOT = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/iu;
const REFERENCE_ATTRIBUTE = /(?:href|src)\s*=\s*(["'])([\s\S]*?)\1/giu;
const CSS_URL = /url\(\s*(["']?)([\s\S]*?)\1\s*\)/giu;
const INLINE_RASTER_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,/iu;

/** A reference may point inside the image or embed a raster image, never elsewhere. */
function isInternalReference(reference: string): boolean {
  const trimmed = reference.trim();

  return trimmed.startsWith("#") || INLINE_RASTER_IMAGE.test(trimmed);
}

function readReferences(markup: string): string[] {
  return [
    ...[...markup.matchAll(REFERENCE_ATTRIBUTE)].map((match) => match[2]),
    ...[...markup.matchAll(CSS_URL)].map((match) => match[2]),
  ];
}

/**
 * Tells whether an SVG file is plain artwork that is safe to serve.
 *
 * @param fileBytes - The uploaded file.
 * @returns Whether the file is UTF-8 text with an `svg` root, without active
 * content and without references to anything outside the image.
 *
 * @remarks
 * The check rejects instead of rewriting, so no difference between this
 * check and a browser's parser can slip markup through. The logo is shown in
 * an `img` element, which runs no scripts and loads no resources, and is
 * served with a restrictive content security policy on top.
 */
export function isSafeSvg(fileBytes: Buffer): boolean {
  let markup: string;

  try {
    markup = new TextDecoder("utf-8", { fatal: true }).decode(fileBytes);
  } catch {
    return false;
  }

  return (
    SVG_ROOT.test(markup) &&
    !FORBIDDEN_ELEMENTS.some((pattern) => pattern.test(markup)) &&
    !FORBIDDEN_PATTERNS.some((pattern) => pattern.test(markup)) &&
    readReferences(markup).every(isInternalReference)
  );
}
