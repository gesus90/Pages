import type { WikiReference } from "@/definition/Wiki";

/**
 * Writes a reference as the markdown the editor inserts.
 *
 * @param reference - A page, ticket or person from the picker.
 * @returns A link to the page or ticket, or an `@` mention of the person.
 *
 * @remarks
 * Pages are linked by their identifier, so the link survives a rename.
 */
export function formatReference(reference: WikiReference): string {
  if (reference.kind === "page") {
    return `[${reference.title.replace(/([[\]\\])/g, "\\$1")}](/wiki/${reference.id})`;
  }

  if (reference.kind === "ticket") {
    return `[${reference.key}](/aufgaben/${reference.key})`;
  }

  return `@${reference.username} `;
}

/**
 * Gives a reference a key that is unique within the picker.
 *
 * @param reference - A page, ticket or person.
 * @returns The key.
 */
export function referenceKey(reference: WikiReference): string {
  if (reference.kind === "ticket") {
    return `ticket:${reference.key}`;
  }

  return `${reference.kind}:${reference.id}`;
}

/**
 * Names a reference for the picker.
 *
 * @param reference - A page, ticket or person.
 * @returns The main text and a short hint about the kind of reference.
 */
export function describeReference(reference: WikiReference): {
  readonly label: string;
  readonly kind: WikiReference["kind"];
} {
  if (reference.kind === "page") {
    return {
      kind: "page",
      label: `${reference.icon ?? ""} ${reference.title}`.trim(),
    };
  }

  if (reference.kind === "ticket") {
    return { kind: "ticket", label: `${reference.key} ${reference.title}` };
  }

  return { kind: "person", label: reference.displayName };
}
