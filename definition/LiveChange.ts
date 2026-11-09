/**
 * What kind of object a live notice names; `project` stands for the tickets
 * of a project, `conversation` for a stored conversation of the chat page.
 */
export type LiveChangeKind =
  "ticket" | "milestone" | "wiki" | "project" | "conversation";

/**
 * One live notice: which object changed, never what it now contains.
 *
 * @remarks
 * The browser reads the object again through the regular rights-checked
 * loaders, so a notice never carries a title, a role or any other content.
 */
export interface LiveChange {
  readonly kind: LiveChangeKind;
  readonly id: string;
}

/** The SSE event names of the live channel. */
export const LIVE_CHANGE_EVENT = {
  /** One object changed; the data is a {@link LiveChange}. */
  CHANGE: "change",
  /** Anything may have changed, such as the account's rights; read everything again. */
  RESYNC: "resync",
} as const;

const LIVE_CHANGE_KINDS: ReadonlySet<string> = new Set([
  "ticket",
  "milestone",
  "wiki",
  "project",
  "conversation",
]);

function isLiveChangeKind(value: unknown): value is LiveChangeKind {
  return typeof value === "string" && LIVE_CHANGE_KINDS.has(value);
}

/** Reads the data of a `change` event; anything else is no notice. */
export function readLiveChange(eventData: string): LiveChange | null {
  let value: unknown;
  try {
    value = JSON.parse(eventData);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  if (!("kind" in value) || !("id" in value)) return null;
  if (!isLiveChangeKind(value.kind) || typeof value.id !== "string")
    return null;

  return { kind: value.kind, id: value.id };
}
