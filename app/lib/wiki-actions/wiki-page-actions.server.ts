import {
  readOptionalText,
  readRequiredText,
} from "@/app/lib/form-fields.server";
import { isWikiAnchorKind } from "@/definition/Wiki";

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
import type { WikiAnchor } from "@/definition/Wiki";

function readRevision(formData: FormData): number | null {
  const revision = Number(formData.get("expectedRevision"));

  return Number.isInteger(revision) ? revision : null;
}

function readAnchors(formData: FormData): WikiAnchor[] | null {
  const anchors: WikiAnchor[] = [];

  for (const entry of formData.getAll("anchor")) {
    const [kind = "", ...rest] = String(entry).split(":");
    const targetId = rest.join(":");

    if (!isWikiAnchorKind(kind) || targetId === "") {
      return null;
    }

    anchors.push({ kind, targetId });
  }

  return anchors;
}

async function savePage({
  actor,
  formData,
  pageId,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const expectedRevision = readRevision(formData);

  if (pageId === null || expectedRevision === null) {
    return invalidInput();
  }

  const page = await services.wikiService.update(actor, pageId, {
    content: formData.get("content")?.toString() ?? "",
    expectedRevision,
    icon: readOptionalText(formData, "icon"),
    title: formData.get("title")?.toString() ?? "",
  });

  return succeededWith({ page });
}

async function restoreVersion({
  actor,
  formData,
  pageId,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const versionId = readRequiredText(formData, "versionId");

  if (pageId === null || versionId === null) {
    return invalidInput();
  }

  return succeededWith({
    page: await services.wikiService.restoreVersion(actor, pageId, versionId),
  });
}

async function getVersion({
  actor,
  formData,
  pageId,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const versionId = readRequiredText(formData, "versionId");

  if (pageId === null || versionId === null) {
    return invalidInput();
  }

  const version = await services.wikiService.getVersion(
    actor,
    pageId,
    versionId,
  );

  return succeededWith({ version });
}

async function setCurrentUntil({
  actor,
  formData,
  pageId,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  if (pageId === null) {
    return invalidInput();
  }

  await services.wikiService.setCurrentUntil(
    actor,
    pageId,
    readOptionalText(formData, "currentUntil"),
  );

  return succeeded();
}

async function setAnchors({
  actor,
  formData,
  pageId,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const anchors = readAnchors(formData);

  if (pageId === null || anchors === null) {
    return invalidInput();
  }

  await services.wikiService.setAnchors(actor, pageId, anchors);

  return succeeded();
}

async function setOwner({
  actor,
  formData,
  pageId,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const ownerId = readRequiredText(formData, "ownerId");

  if (pageId === null || ownerId === null) {
    return invalidInput();
  }

  await services.wikiService.setOwner(actor, pageId, ownerId);

  return succeeded();
}

async function deleteAttachment({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const attachmentId = readRequiredText(formData, "attachmentId");

  if (attachmentId === null) {
    return invalidInput();
  }

  await services.wikiService.removeAttachment(actor, attachmentId);

  return succeeded();
}

async function addComment({
  actor,
  formData,
  pageId,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  if (pageId === null) {
    return invalidInput();
  }

  const comment = await services.wikiService.addComment(actor, pageId, {
    body: formData.get("body")?.toString() ?? "",
    parentId: readOptionalText(formData, "parentId"),
    quote: readOptionalText(formData, "quote"),
    quotePrefix: readOptionalText(formData, "quotePrefix"),
    quoteSuffix: readOptionalText(formData, "quoteSuffix"),
  });

  return succeededWith({ comment });
}

async function editComment({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const commentId = readRequiredText(formData, "commentId");

  if (commentId === null) {
    return invalidInput();
  }

  await services.wikiService.editComment(
    actor,
    commentId,
    formData.get("body")?.toString() ?? "",
  );

  return succeeded();
}

async function deleteComment({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const commentId = readRequiredText(formData, "commentId");

  if (commentId === null) {
    return invalidInput();
  }

  await services.wikiService.removeComment(actor, commentId);

  return succeeded();
}

async function resolveComment({
  actor,
  formData,
  services,
}: WikiActionContext): Promise<WikiActionOutcome> {
  const commentId = readRequiredText(formData, "commentId");

  if (commentId === null) {
    return invalidInput();
  }

  await services.wikiService.resolveComment(
    actor,
    commentId,
    formData.get("resolved") === "1",
  );

  return succeeded();
}

const PAGE_HANDLERS: Readonly<Record<string, WikiActionHandler>> = {
  "add-comment": addComment,
  "delete-comment": deleteComment,
  "edit-comment": editComment,
  "resolve-comment": resolveComment,
  "delete-attachment": deleteAttachment,
  "get-version": getVersion,
  "restore-version": restoreVersion,
  save: savePage,
  "set-anchors": setAnchors,
  "set-current-until": setCurrentUntil,
  "set-owner": setOwner,
};

/**
 * Handles the actions that change one page.
 *
 * @param context - The submission, with the page of the route.
 * @returns The response for the client.
 */
export function handleWikiPageAction(
  context: WikiActionContext,
): Promise<WikiActionOutcome> {
  return runWikiAction(PAGE_HANDLERS, context);
}
