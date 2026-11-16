import { useSyncExternalStore } from "react";

import type {
  ConversationAttachment,
  ConversationMediaFacts,
} from "@/definition/ConversationContent";

/**
 * Facts the browser read during this visit, by attachment ID, so
 * every card of the file shows them at once, before the server answers again.
 */
const known = new Map<string, ConversationMediaFacts>();
/** Files whose facts were sent to the server during this visit. */
const reported = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Usable facts only: whole positive sizes together, a positive length. */
function cleaned(facts: ConversationMediaFacts): ConversationMediaFacts {
  const width = facts.width !== undefined ? Math.round(facts.width) : 0;
  const height = facts.height !== undefined ? Math.round(facts.height) : 0;
  const duration = facts.durationSeconds ?? 0;
  return {
    ...(width > 0 && height > 0 ? { width, height } : {}),
    ...(Number.isFinite(duration) && duration > 0
      ? { durationSeconds: duration }
      : {}),
  };
}

/**
 * The query of facts as the files interface takes them.
 * @param facts - Width, height and length.
 * @returns For example `&width=1920&height=1080&durationSeconds=112.4`; empty without facts.
 */
export function mediaFactsQuery(facts: ConversationMediaFacts): string {
  const usable = cleaned(facts);
  const parameters = new URLSearchParams();
  if (usable.width !== undefined && usable.height !== undefined) {
    parameters.set("width", String(usable.width));
    parameters.set("height", String(usable.height));
  }
  if (usable.durationSeconds !== undefined)
    parameters.set("durationSeconds", usable.durationSeconds.toFixed(3));
  const query = parameters.toString();
  return query === "" ? "" : `&${query}`;
}

/** Notes facts for the cards of this visit. */
export function rememberMediaFacts(
  attachmentId: string,
  facts: ConversationMediaFacts,
): void {
  const usable = cleaned(facts);
  if (Object.keys(usable).length === 0) return;
  known.set(attachmentId, { ...known.get(attachmentId), ...usable });
  for (const listener of listeners) listener();
}

function hasStoredFacts(attachment: ConversationAttachment): boolean {
  const hasLength = attachment.durationSeconds !== undefined;
  return attachment.kind === "video"
    ? hasLength && attachment.width !== undefined
    : hasLength;
}

/**
 * Notes what a player read of a video or a sound and stores it once on the
 * server, for everyone who sees the message later. A file whose
 * facts the server knows already sends nothing.
 *
 * @param attachment - The attachment that was played.
 * @param facts - What the element read.
 */
export function reportMediaFacts(
  attachment: ConversationAttachment,
  facts: ConversationMediaFacts,
): void {
  rememberMediaFacts(attachment.id, facts);
  if (hasStoredFacts(attachment) || reported.has(attachment.id)) return;
  const query = mediaFactsQuery(facts);
  if (query === "") return;
  reported.add(attachment.id);
  void fetch(
    `/chat-page-api/files?attachmentId=${encodeURIComponent(attachment.id)}${query}`,
    { method: "PATCH" },
  ).catch(() => undefined);
}

/**
 * The resolution and the length of a video or a sound as a card shows them
 * Stored with the attachment, or read during this visit.
 *
 * @param attachment - The attachment of the card.
 */
export function useMediaFacts(
  attachment: ConversationAttachment,
): ConversationMediaFacts {
  const read = useSyncExternalStore(
    subscribe,
    () => known.get(attachment.id),
    () => undefined,
  );
  const width = attachment.width ?? read?.width;
  const height = attachment.height ?? read?.height;
  const durationSeconds = attachment.durationSeconds ?? read?.durationSeconds;
  return {
    ...(width !== undefined && height !== undefined ? { width, height } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
  };
}

/**
 * The resolution of a video as a card names it.
 *
 * @param facts - The facts of the video.
 * @returns For example `1080p`, `4K` or `720 × 1280`; `null` without a size.
 */
export function formatResolution(facts: ConversationMediaFacts): string | null {
  const { width, height } = facts;
  if (width === undefined || height === undefined) return null;
  const shorter = Math.min(width, height);
  if (width < height) return `${String(width)} × ${String(height)}`;
  if (shorter >= 2160) return "4K";
  if ([1440, 1080, 720, 480, 360].includes(shorter))
    return `${String(shorter)}p`;
  return `${String(width)} × ${String(height)}`;
}

/** Forgets every noted fact; for tests. */
export function resetMediaFacts(): void {
  known.clear();
  reported.clear();
}
