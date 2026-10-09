import type { EditorReference } from "@/app/components/editor/block-editor-types";
import type { WikiReference } from "@/definition/Wiki";

function isReference(value: unknown): value is WikiReference {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }

  const { kind } = value;

  return kind === "page" || kind === "ticket" || kind === "person";
}

/**
 * Reads the answer of `/wiki-api/references`.
 *
 * @param body - The parsed JSON body.
 * @returns The references it holds; anything malformed is left out.
 */
export function readReferences(body: unknown): WikiReference[] {
  const references =
    typeof body === "object" && body !== null && "references" in body
      ? body.references
      : null;

  return Array.isArray(references) ? references.filter(isReference) : [];
}

/**
 * Turns a page, ticket or person into an entry of the editor's reference
 * menu, inserting the same markdown the former picker wrote.
 *
 * @param reference - What the server offered.
 * @param hintOf - Gives the translated kind of the entry.
 * @returns The menu entry.
 *
 * @remarks
 * Pages are linked by identifier, so the link survives a rename; tickets by
 * key; people are mentioned with `@user`.
 */
export function toEditorReference(
  reference: WikiReference,
  hintOf: (kind: WikiReference["kind"]) => string,
): EditorReference {
  const hint = hintOf(reference.kind);

  if (reference.kind === "page") {
    return {
      hint,
      insertion: {
        href: `/wiki/${reference.id}`,
        kind: "link",
        text: reference.title,
      },
      key: `page:${reference.id}`,
      label: `${reference.icon ?? ""} ${reference.title}`.trim(),
    };
  }

  if (reference.kind === "ticket") {
    return {
      hint,
      insertion: {
        href: `/aufgaben/${reference.key}`,
        kind: "link",
        text: reference.key,
      },
      key: `ticket:${reference.key}`,
      label: `${reference.key} ${reference.title}`,
    };
  }

  return {
    hint,
    insertion: { kind: "text", text: `@${reference.username} ` },
    key: `person:${reference.id}`,
    label: reference.displayName,
  };
}
