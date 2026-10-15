import { vi } from "vitest";

import { WikiAnchorRepository } from "@/backend/database/repositories/wiki/WikiAnchorRepository";
import { WikiLinkRepository } from "@/backend/database/repositories/wiki/WikiLinkRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { WikiMentionRepository } from "@/backend/database/repositories/wiki/WikiMentionRepository";
import { WikiPageRepository } from "@/backend/database/repositories/wiki/WikiPageRepository";
import { WikiPageWriteRepository } from "@/backend/database/repositories/wiki/WikiPageWriteRepository";
import { WikiVersionRepository } from "@/backend/database/repositories/wiki/WikiVersionRepository";

import type { WikiPageRecord } from "@/backend/database/repositories/WikiRepository";
import type { TextWorld } from "./page59-text-world";

/** Stored metadata includes values that a text-only edit must preserve. */
export function textWikiPage(): WikiPageRecord {
  return {
    id: "page-59",
    title: "Range page",
    content: "Synthetic text",
    icon: "📖",
    cover: { kind: "preset", preset: "ocean" },
    revision: 7,
    scope: "project",
    projectId: "engineering",
    projectName: "engineering",
    parentId: "parent-page",
    ownerId: "writer",
    ownerName: "Writer",
    currentUntil: "2026-12-31",
    updatedAt: "2026-01-01 00:00:00",
    createdAt: "2026-01-01 00:00:00",
    isTemplate: false,
    updatedByName: "Writer",
  };
}

/** Replaces wiki storage only; the access, reader and page mutation services remain real. */
export function mockTextWiki(world: TextWorld): void {
  vi.spyOn(WikiPageRepository.prototype, "findVisible").mockImplementation(
    async (scope, id) =>
      id === world.page.id &&
      (scope.isAdmin || scope.projectIds.includes("engineering"))
        ? world.page
        : null,
  );
  vi.spyOn(WikiPageRepository.prototype, "findBreadcrumb").mockResolvedValue(
    [],
  );
  vi.spyOn(WikiAnchorRepository.prototype, "findAnchors").mockResolvedValue([]);
  vi.spyOn(WikiPageWriteRepository.prototype, "saveEdit").mockImplementation(
    async (id, edit) => {
      if (id !== world.page.id) throw new Error("Unexpected page write");
      world.page = {
        ...world.page,
        title: edit.title,
        content: edit.content,
        icon: edit.icon,
        revision: world.page.revision + 1,
      };
      return world.page.revision;
    },
  );
  vi.spyOn(WikiVersionRepository.prototype, "save").mockImplementation(
    async (version, coalesceMinutes) => {
      if (world.isHistoryFailing) throw new Error("Synthetic history failure");
      world.versions.push({ version, coalesceMinutes });
    },
  );
  vi.spyOn(WikiLinkRepository.prototype, "replace").mockImplementation(
    async (id, links) => {
      world.links.push({ id, links });
    },
  );
  vi.spyOn(
    WikiLookupRepository.prototype,
    "findActiveUsersByUsernames",
  ).mockResolvedValue([]);
  vi.spyOn(WikiMentionRepository.prototype, "replace").mockImplementation(
    async (source, users) => {
      world.mentions.push({ source, users });
    },
  );
}
