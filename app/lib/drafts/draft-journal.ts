import { z } from "zod";

import {
  DRAFT_ROUTE_PREFIX,
  localState,
} from "@/app/lib/local-state/local-state-store";

import type { LocalStateKind } from "@/app/lib/local-state/local-state-store";
import type { DraftJournal, KeptDraft } from "./draft-queue";

/**
 * Keeps an account's unconfirmed edits of one area in the browser's local state.
 *
 * @param ownerId - The signed-in account, or `null` without one.
 * @param area - The kind of object, such as `wiki`; part of the key.
 * @param schema - The shape of the edited fields.
 * @returns The journal, or `null` without an account, which keeps nothing.
 *
 * @remarks
 * The entries share the store of the route answers and with it the account
 * fencing: an entry is written and read only while its account is the one
 * signed in to the document, so another account never sees it.
 */
export function createDraftJournal<T>(
  ownerId: string | null,
  area: string,
  schema: z.ZodType<T>,
): DraftJournal<T> | null {
  if (!ownerId) return null;
  const keptSchema = z.object({
    href: z.string(),
    label: z.string(),
    base: schema,
    draft: schema,
    pending: z
      .object({ operationId: z.uuid(), base: schema, draft: schema })
      .nullable(),
  });
  const kind: LocalStateKind<KeptDraft<T>> = {
    schemaVersion: 1,
    isPayload: (value): value is KeptDraft<T> =>
      keptSchema.safeParse(value).success,
  };
  const routeOf = (id: string): string => `${DRAFT_ROUTE_PREFIX}${area}/${id}`;

  return {
    read: async (id) => {
      await localState.whenClaimed();
      if (localState.currentOwner() !== ownerId) return null;
      const entry = await localState.read(routeOf(id), kind);
      return entry?.payload ?? null;
    },
    keep: (id, kept) => {
      void localState.save(ownerId, routeOf(id), kind, kept);
    },
    drop: (id) => {
      if (localState.currentOwner() === ownerId)
        void localState.remove(routeOf(id));
    },
  };
}
