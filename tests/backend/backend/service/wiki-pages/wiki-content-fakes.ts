import { vi } from "vitest";

import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { ProjectActivityRepository } from "@/backend/database/repositories/project/ProjectActivityRepository";
import { WikiAttachmentRepository } from "@/backend/database/repositories/wiki/WikiAttachmentRepository";
import { WikiCommentRepository } from "@/backend/database/repositories/wiki/WikiCommentRepository";
import { WikiLinkRepository } from "@/backend/database/repositories/wiki/WikiLinkRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { WikiMentionRepository } from "@/backend/database/repositories/wiki/WikiMentionRepository";
import { WikiSettingsRepository } from "@/backend/database/repositories/wiki/WikiSettingsRepository";
import { WikiVersionRepository } from "@/backend/database/repositories/wiki/WikiVersionRepository";

import { WIKI_NOW } from "./wiki-page-fakes";

import type { WikiState } from "./wiki-state";

/** Replaces the comment repository. */
function installComments(state: WikiState): void {
  const proto = WikiCommentRepository.prototype;
  vi.spyOn(proto, "insert").mockImplementation(async (comment) => {
    const id = `comment-${state.next()}`;
    state.data.comments.set(id, {
      ...comment,
      authorName: state.users.get(comment.authorId)?.displayName ?? "",
      createdAt: WIKI_NOW,
      id,
      resolvedAt: null,
      resolvedByName: null,
      updatedAt: WIKI_NOW,
    });
    return id;
  });
  vi.spyOn(proto, "listByPage").mockImplementation(async (pageId) =>
    [...state.data.comments.values()].filter(
      (comment) => comment.pageId === pageId,
    ),
  );
  vi.spyOn(proto, "find").mockImplementation(
    async (id) => state.data.comments.get(id) ?? null,
  );
  vi.spyOn(proto, "updateBody").mockImplementation(async (id, body) => {
    const comment = state.data.comments.get(id);
    if (comment !== undefined)
      state.data.comments.set(id, { ...comment, body });
  });
  vi.spyOn(proto, "setResolved").mockImplementation(async (id, resolvedBy) => {
    const comment = state.data.comments.get(id);
    if (comment === undefined) return;
    state.data.comments.set(id, {
      ...comment,
      resolvedAt: resolvedBy === null ? null : WIKI_NOW,
      resolvedByName:
        resolvedBy === null
          ? null
          : (state.users.get(resolvedBy)?.displayName ?? null),
    });
  });
  vi.spyOn(proto, "delete").mockImplementation(async (id) => {
    for (const [commentId, comment] of state.data.comments) {
      if (commentId === id || comment.parentId === id)
        state.data.comments.delete(commentId);
    }
  });
}

/** Replaces the attachment repository. */
function installAttachments(state: WikiState): void {
  const proto = WikiAttachmentRepository.prototype;
  vi.spyOn(proto, "insert").mockImplementation(async (attachment) => {
    const id = `attachment-${state.next()}`;
    state.data.attachments.set(id, {
      ...attachment,
      createdAt: WIKI_NOW,
      id,
      uploadedByName: state.users.get(attachment.uploadedBy)?.displayName ?? "",
    });
    return { createdAt: WIKI_NOW, id };
  });
  vi.spyOn(proto, "listByPage").mockImplementation(async (pageId) =>
    [...state.data.attachments.values()].filter(
      (attachment) => attachment.pageId === pageId,
    ),
  );
  vi.spyOn(proto, "find").mockImplementation(
    async (id) => state.data.attachments.get(id) ?? null,
  );
  vi.spyOn(proto, "delete").mockImplementation(async (id) => {
    state.data.attachments.delete(id);
  });
  vi.spyOn(proto, "listStorageNames").mockImplementation(async () =>
    [...state.data.attachments.values()].map(
      (attachment) => attachment.storageName,
    ),
  );
}

/** Replaces the version repository: a save by the same author may refresh the newest version. */
function installVersions(state: WikiState): void {
  const proto = WikiVersionRepository.prototype;
  vi.spyOn(proto, "save").mockImplementation(
    async (version, coalesceMinutes) => {
      const newest = state.data.versions.findLast(
        (row) => row.pageId === version.pageId,
      );
      const index =
        newest === undefined ? -1 : state.data.versions.indexOf(newest);
      if (newest?.authorId === version.authorId && coalesceMinutes > 0) {
        state.data.versions[index] = {
          ...newest,
          content: version.content,
          revision: version.revision,
          title: version.title,
        };
        return;
      }
      state.data.versions.push({
        authorId: version.authorId,
        authorName: state.users.get(version.authorId)?.displayName ?? "",
        content: version.content,
        createdAt: WIKI_NOW,
        id: `version-${state.next()}`,
        pageId: version.pageId,
        revision: version.revision,
        title: version.title,
        updatedAt: WIKI_NOW,
      });
    },
  );
  vi.spyOn(proto, "prune").mockImplementation(
    async (retentionDays, keepLast) => {
      state.prunes.push({ keepLast, retentionDays });
    },
  );
  vi.spyOn(proto, "list").mockImplementation(async (pageId) =>
    state.data.versions
      .filter((row) => row.pageId === pageId)
      .map(({ content, pageId: owner, ...summary }) => {
        void [content, owner];
        return summary;
      })
      .reverse(),
  );
  vi.spyOn(proto, "find").mockImplementation(
    async (pageId, versionId) =>
      state.data.versions.find(
        (row) => row.pageId === pageId && row.id === versionId,
      ) ?? null,
  );
}

/** Replaces account lookups, mentions, links, settings and activity. */
function installSideTables(state: WikiState): void {
  vi.spyOn(WikiLookupRepository.prototype, "isActiveUser").mockImplementation(
    async (userId) => state.users.get(userId)?.isActive === true,
  );
  vi.spyOn(WikiLookupRepository.prototype, "findUserName").mockImplementation(
    async (userId) => state.users.get(userId)?.displayName ?? "",
  );
  vi.spyOn(
    WikiLookupRepository.prototype,
    "findActiveUsersByUsernames",
  ).mockImplementation(async (usernames) =>
    [...state.users.entries()]
      .filter(
        ([, user]) =>
          user.isActive &&
          usernames.some((name) => name.toLowerCase() === user.username),
      )
      .map(([id, user]) => ({ id, username: user.username })),
  );
  vi.spyOn(WikiMentionRepository.prototype, "replace").mockImplementation(
    async (source, userIds) => {
      state.data.mentions = state.data.mentions.filter(
        (row) =>
          row.pageId !== source.pageId || row.commentId !== source.commentId,
      );
      state.data.mentions.push({
        commentId: source.commentId,
        pageId: source.pageId,
        userIds,
      });
    },
  );
  vi.spyOn(WikiLinkRepository.prototype, "replace").mockImplementation(
    async (pageId, targets) => {
      state.data.links.set(pageId, targets);
    },
  );
  vi.spyOn(WikiSettingsRepository.prototype, "find").mockImplementation(
    async () => state.data.settings,
  );
  vi.spyOn(WikiSettingsRepository.prototype, "save").mockImplementation(
    async (settings) => {
      state.data.settings = settings;
    },
  );
  vi.spyOn(ProjectActivityRepository.prototype, "insert").mockImplementation(
    async (entry) => {
      state.data.activity.push(entry);
    },
  );
}

/** Replaces the permanent deletion: the selection names a trash root. */
function installDeletion(state: WikiState): void {
  vi.spyOn(WikiRepository.prototype, "deletePages").mockImplementation(
    async (selection) => {
      const rootId = String(selection.parameters.root_id);
      const doomed = [...state.data.pages.entries()]
        .filter(([, row]) => row.deletedRootId === rootId)
        .map(([id]) => id);
      const files: string[] = [];
      for (const [id, attachment] of state.data.attachments) {
        if (!doomed.includes(attachment.pageId)) continue;
        files.push(attachment.storageName);
        state.data.attachments.delete(id);
      }
      for (const [id, comment] of state.data.comments) {
        if (doomed.includes(comment.pageId)) state.data.comments.delete(id);
      }
      state.data.versions = state.data.versions.filter(
        (row) => !doomed.includes(row.pageId),
      );
      for (const id of doomed) {
        state.data.pages.delete(id);
        state.data.anchors.delete(id);
      }
      return files;
    },
  );
}

/**
 * Installs the in-memory comment, attachment, version and side-table repositories.
 *
 * @param state - The rows they read and change.
 */
export function installContentFakes(state: WikiState): void {
  installComments(state);
  installAttachments(state);
  installVersions(state);
  installSideTables(state);
  installDeletion(state);
}
