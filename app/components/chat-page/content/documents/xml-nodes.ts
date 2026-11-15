/**
 * Small helpers over the XML of Office and OpenDocument files (PAGE-385).
 * The browser's own parser reads the XML as data: it runs no script and
 * loads no external entity, and nothing of it becomes markup of the page.
 */

/**
 * Parses an XML part.
 *
 * @param text - The XML.
 * @returns The document element, or `null` for text that is no XML.
 */
export function parseXml(text: string): Element | null {
  const document = new DOMParser().parseFromString(text, "application/xml");
  const root = document.documentElement;
  if (
    root.localName === "parsererror" ||
    root.getElementsByTagName("parsererror").length > 0
  )
    return null;
  return root;
}

/** The child elements of an element with one of the local names, in order. */
export function childrenNamed(
  element: Element,
  ...names: readonly string[]
): Element[] {
  return [...element.children].filter((child) =>
    names.includes(child.localName),
  );
}

/** The first child element with the local name, or `null`. */
export function childNamed(element: Element, name: string): Element | null {
  return (
    [...element.children].find((child) => child.localName === name) ?? null
  );
}

/** Every descendant element with the local name, in document order. */
export function descendantsNamed(element: Element, name: string): Element[] {
  return [...element.getElementsByTagName("*")].filter(
    (child) => child.localName === name,
  );
}

/** The first descendant element with the local name, or `null`. */
export function descendantNamed(
  element: Element,
  name: string,
): Element | null {
  return descendantsNamed(element, name)[0] ?? null;
}

/**
 * The value of an attribute by its local name, whatever prefix the file
 * gave its namespace.
 *
 * @param element - The element, or `null`.
 * @param name - The local name, such as `val` for `w:val`.
 * @returns The value, or `null` without the attribute.
 */
export function attributeOf(
  element: Element | null,
  name: string,
): string | null {
  if (!element) return null;
  for (const attribute of element.attributes)
    if (attribute.localName === name) return attribute.value;
  return null;
}

/** The text of all descendants, as the file stores it. */
export function textOf(element: Element | null): string {
  return element?.textContent ?? "";
}

/**
 * Resolves the target of a relation against the folder of the part that
 * names it, as Office packages do.
 *
 * @param base - The path of the part, such as `word/document.xml`.
 * @param target - The target, such as `media/image1.png` or `/xl/x.xml`.
 */
export function resolvePartPath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const folders = base.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") folders.pop();
    else if (segment !== "." && segment !== "") folders.push(segment);
  }
  return folders.join("/");
}

/**
 * The relation ID of an element (`r:id`), which some elements hold next to
 * an `id` of their own namespace, such as `<p:sldId id="256" r:id="rId2"/>`.
 *
 * @param element - The element, or `null`.
 * @returns The ID, or `null` without one.
 */
export function relationIdOf(element: Element | null): string | null {
  if (!element) return null;
  for (const attribute of element.attributes)
    if (
      attribute.localName === "id" &&
      (attribute.namespaceURI ?? "").endsWith("/relationships")
    )
      return attribute.value;
  return null;
}
