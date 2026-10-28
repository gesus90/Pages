import {
  ACTOR,
  formOf,
  outcomeOf,
  servicesOf,
} from "../../actions/action-fixtures";

import type { WikiActionContext } from "@/app/lib/wiki-actions/wiki-action-support.server";
import type { ActionOutcome, FormFields } from "../../actions/action-fixtures";
import type { WikiPage } from "@/definition/Wiki";

/** The page of the route every synthetic page action addresses. */
export const PAGE_ID = "page-1";

/**
 * Builds the context of a wiki action handler.
 *
 * @param services - Service fakes the handler may call.
 * @param fields - Form fields of the submission, including the intent.
 * @param pageId - The page of the route, or `null`.
 */
export function wikiContext(
  services: object,
  fields: FormFields,
  pageId: string | null = PAGE_ID,
): WikiActionContext {
  return {
    actor: ACTOR,
    formData: formOf(fields),
    pageId,
    services: servicesOf(services),
  };
}

/**
 * Runs a wiki action entry point and normalizes its answer.
 *
 * @param action - The entry point under test.
 * @param context - The submission.
 * @returns Status, body and redirect location of the answer.
 */
export async function runWikiHandler(
  action: (context: WikiActionContext) => Promise<unknown>,
  context: WikiActionContext,
): Promise<ActionOutcome> {
  return outcomeOf(await action(context));
}

/** A stored page as the wiki service returns it, with no database behind it. */
export function storedPage(id = PAGE_ID, title = "Synthetic Page"): WikiPage {
  return {
    id,
    title,
    content: "Text",
    icon: null,
    revision: 3,
    cover: null,
    scope: "instance",
    projectId: null,
    projectName: null,
    parentId: null,
    ownerId: "owner",
    ownerName: "Owner",
    currentUntil: null,
    updatedAt: "2026-10-15T10:00:00Z",
    createdAt: "2026-10-15T10:00:00Z",
    isTemplate: false,
    updatedByName: "Owner",
    anchors: [],
    breadcrumb: [],
  };
}
