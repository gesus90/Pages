import { randomUUID } from "node:crypto";

import type {
  WikiPageRecord,
  WikiRepository,
} from "@/backend/database/repositories/WikiRepository";

/** Records project wiki activity without persisting document text or hidden subtree names. */
export async function recordWikiActivity(
  repository: WikiRepository,
  page: Pick<WikiPageRecord, "id" | "projectId">,
  userId: string,
  action: string,
): Promise<void> {
  if (page.projectId === null) return;
  await repository.activity.insert({
    id: randomUUID(),
    projectId: page.projectId,
    userId,
    category: "wiki",
    action,
    message: "Wiki activity.",
    wikiPageId: page.id,
  });
}
