import { z } from "zod";

import {
  descriptionContentSchema,
  wikiSaveContentSchema,
} from "@/definition/BackgroundSave";
import { normalizeWikiTitle, WIKI_LIMITS } from "@/definition/Wiki";
import { WORK_ITEM_LIMITS } from "@/definition/Task";

import type {
  DescriptionContent,
  WikiSaveContent,
} from "@/definition/BackgroundSave";
import type { DraftAdapter, DraftAnswer, DraftEntry } from "./draft-queue";

async function postDraft<T>(
  url: string,
  input: DraftEntry<T>,
  schema: z.ZodType<T>,
): Promise<DraftAnswer<T>> {
  const response = await fetch(url, {
    body: JSON.stringify({
      base: input.base,
      draft: input.draft,
      streamId: input.streamId,
      sequence: input.sequence,
    }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status >= 500) return { error: "backend", ok: false };
  const result = z
    .discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), saved: schema }),
      z.object({
        ok: z.literal(false),
        error: z.string(),
        current: schema.optional(),
      }),
    ])
    .parse(await response.json());
  if (!response.ok && result.ok) throw new Error("Unconfirmed draft response.");
  return result;
}

/** Validates and writes existing wiki objects; creation is never retried here. */
export const wikiDraftAdapter: DraftAdapter<WikiSaveContent> = {
  delay: 1200,
  equal: (left, right) =>
    normalizeWikiTitle(left.title) === normalizeWikiTitle(right.title) &&
    left.content === right.content &&
    left.icon === right.icon,
  validate: (draft) => {
    const title = normalizeWikiTitle(draft.title);
    if (!title) return "titleRequired";
    if (
      Array.from(title).length > WIKI_LIMITS.titleLength ||
      new TextEncoder().encode(draft.content).byteLength >
        WIKI_LIMITS.contentLength
    ) {
      return "tooLong";
    }
    return null;
  },
  save: (entry) =>
    postDraft(`/wiki-api/drafts/${entry.id}`, entry, wikiSaveContentSchema),
};

/** Keeps the ticket's explicit Save action and its compare-and-set text base. */
export const descriptionDraftAdapter: DraftAdapter<DescriptionContent> = {
  delay: null,
  equal: (left, right) => left.description.trim() === right.description.trim(),
  validate: (draft) =>
    draft.description.trim().length > WORK_ITEM_LIMITS.descriptionLength
      ? "descriptionTooLong"
      : null,
  save: (entry) =>
    postDraft(
      `/ticket-api/drafts/${entry.id}`,
      entry,
      descriptionContentSchema,
    ),
};
