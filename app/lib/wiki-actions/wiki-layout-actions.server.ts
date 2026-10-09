import { redirect } from "react-router";

import {
  readOptionalText,
  readRequiredText,
} from "@/app/lib/form-fields.server";
import { wikiPagePath } from "@/app/lib/wiki-tree";
import { isWikiScope } from "@/definition/Wiki";

import {
  invalidInput,
  runWikiAction,
  succeeded,
  succeededWith,
} from "./wiki-action-support.server";

import type {
  WikiActionContext,
  WikiActionHandler,
  WikiActionOutcome,
} from "./wiki-action-support.server";
import type { MoveWikiPageInput } from "@/backend/service/WikiService";

function readFlag(formData: FormData, key: string): boolean {
  return formData.get(key) === "1";
}

function readMove(formData: FormData): MoveWikiPageInput | null {
  const scope = readOptionalText(formData, "scope");

  if (scope !== null && !isWikiScope(scope)) {
    return null;
  }

  return {
    beforeId: readOptionalText(formData, "beforeId"),
    parentId: readOptionalText(formData, "parentId"),
    projectId: readOptionalText(formData, "projectId"),
    scope,
  };
}

async function createPage({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const scope = readOptionalText(formData, "scope");

  if (scope !== null && !isWikiScope(scope)) {
    return invalidInput();
  }

  const page = await services.wikiService.create(actor, {
    anchors: [],
    content: formData.get("content")?.toString() ?? "",
    icon: readOptionalText(formData, "icon"),
    isTemplate: false,
    parentId: readOptionalText(formData, "parentId"),
    projectId: readOptionalText(formData, "projectId"),
    scope,
    templateId: readOptionalText(formData, "templateId"),
    title: formData.get("title")?.toString() ?? "",
  });

  // `/page` in the editor stays on the parent page and links the new one.
  return readFlag(formData, "stay")
    ? succeededWith({ page })
    : redirect(wikiPagePath(page.id, page.title));
}

async function setExpanded({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const pageId = readRequiredText(formData, "pageId");

  if (pageId === null) {
    return invalidInput();
  }

  await services.wikiService.setExpanded(
    actor,
    pageId,
    readFlag(formData, "expanded"),
  );

  return succeeded();
}

async function setFavorite({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const pageId = readRequiredText(formData, "pageId");

  if (pageId === null) {
    return invalidInput();
  }

  await services.wikiService.setFavorite(
    actor,
    pageId,
    readFlag(formData, "favorite"),
  );

  return succeeded();
}

async function movePage({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const pageId = readRequiredText(formData, "pageId");
  const move = readMove(formData);

  if (pageId === null || move === null) {
    return invalidInput();
  }

  await services.wikiService.move(actor, pageId, move);

  return succeeded();
}

async function previewMove({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const pageId = readRequiredText(formData, "pageId");
  const move = readMove(formData);

  if (pageId === null || move === null) {
    return invalidInput();
  }

  return succeededWith({
    change: await services.wikiService.previewMove(actor, pageId, move),
  });
}

async function deletePage({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const pageId = readRequiredText(formData, "pageId");

  if (pageId === null) {
    return invalidInput();
  }

  await services.wikiService.delete(actor, pageId);

  return redirect("/wiki");
}

async function duplicatePage({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const pageId = readRequiredText(formData, "pageId");

  if (pageId === null) {
    return invalidInput();
  }

  const page = await services.wikiService.duplicate(actor, pageId, {
    isTemplate: readFlag(formData, "template"),
    title: formData.get("title")?.toString() ?? "",
    withChildren: readFlag(formData, "withChildren"),
  });

  return redirect(wikiPagePath(page.id, page.title));
}

async function restorePage({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const pageId = readRequiredText(formData, "pageId");

  if (pageId === null) {
    return invalidInput();
  }

  await services.wikiService.restore(actor, pageId);

  return succeeded();
}

async function purgePage({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const pageId = readRequiredText(formData, "pageId");

  if (pageId === null) {
    return invalidInput();
  }

  await services.wikiService.purge(actor, pageId);

  return succeeded();
}

async function deletePrivatePage({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const pageId = readRequiredText(formData, "pageId");

  if (pageId === null) {
    return invalidInput();
  }

  await services.wikiService.deletePrivateAsAdministrator(actor, pageId);

  return formData.get("stay") === "1" ? succeeded() : redirect("/wiki");
}

async function markFeedRead({
  actor,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  await services.wikiService.markFeedRead(actor);

  return succeeded();
}

const LAYOUT_HANDLERS: Readonly<Record<string, WikiActionHandler>> = {
  "mark-feed-read": markFeedRead,
  "create-page": createPage,
  "delete-page": deletePage,
  "delete-private-page": deletePrivatePage,
  "duplicate-page": duplicatePage,
  "move-page": movePage,
  "preview-move": previewMove,
  "purge-page": purgePage,
  "restore-page": restorePage,
  "set-expanded": setExpanded,
  "set-favorite": setFavorite,
};

/**
 * Handles the actions that change the structure of the wiki.
 *
 * @param context - The submission.
 * @returns The response for the client.
 */
export function handleWikiLayoutAction(
  context: WikiActionContext,
): Promise<WikiActionOutcome> {
  return runWikiAction(LAYOUT_HANDLERS, context);
}
