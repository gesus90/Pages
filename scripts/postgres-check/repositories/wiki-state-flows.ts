import { WikiAttachmentRepository } from "@/backend/database/repositories/wiki/WikiAttachmentRepository";
import { deleteWikiPages } from "@/backend/database/repositories/wiki/WikiPageDeletion";
import { WikiSettingsRepository } from "@/backend/database/repositories/wiki/WikiSettingsRepository";
import { WikiStateRepository } from "@/backend/database/repositories/wiki/WikiStateRepository";
import { WikiVersionRepository } from "@/backend/database/repositories/wiki/WikiVersionRepository";

import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  refusedWithoutTable,
  reversedInPostgres,
  stored,
} from "./world";

import type { RepositoryFlow, RepositoryStep } from "./world";

const STATE_STEPS: readonly RepositoryStep[] = [
  call("WikiSettingsRepository.find", ({ database }) =>
    new WikiSettingsRepository(database).find(),
  ),
  call("WikiSettingsRepository.save", ({ database }) =>
    new WikiSettingsRepository(database).save({
      trashRetentionDays: 30,
      versionRetentionDays: 90,
      versionKeepLast: 5,
      mediaLimitBytes: 5_000_000_000,
      fileLimitBytes: 1,
    }),
  ),
  call("WikiSettingsRepository.save", ({ database }) =>
    new WikiSettingsRepository(database).save({
      trashRetentionDays: 31,
      versionRetentionDays: 91,
      versionKeepLast: 6,
      mediaLimitBytes: 7,
      fileLimitBytes: 8,
    }),
  ),
  call("WikiSettingsRepository.find", ({ database }) =>
    new WikiSettingsRepository(database).find(),
  ),
  refusedWithoutTable(
    "WikiSettingsRepository.find",
    "wiki_settings",
    (transaction) => new WikiSettingsRepository(transaction).find(),
  ),
  ...["page-z", "page-y", "page-x", "page-y"].flatMap((pageId, index) => [
    call("WikiStateRepository.setFavorite", ({ database }) =>
      new WikiStateRepository(database).setFavorite(
        "user-admin",
        pageId,
        index < 3,
      ),
    ),
    call("WikiStateRepository.setExpanded", ({ database }) =>
      new WikiStateRepository(database).setExpanded(
        "user-admin",
        pageId,
        index < 3,
      ),
    ),
  ]),
  prepare("UPDATE wiki_favorites SET created_at = '2026-01-01 00:00:00';"),
  call("WikiStateRepository.listFavoriteIds", ({ database }) =>
    new WikiStateRepository(database).listFavoriteIds("user-admin"),
  ),
  call("WikiStateRepository.listExpandedIds", ({ database }) =>
    new WikiStateRepository(database).listExpandedIds("user-admin"),
  ),
  prepare(`
    INSERT INTO wiki_recent_pages (user_id, page_id, visited_at)
    SELECT 'user-admin', 'page-' || CAST(number AS TEXT), '2026-01-01 00:00:00'
    FROM generate_series(11, 30) AS numbers (number);
  `),
  call("WikiStateRepository.recordVisit", ({ database }) =>
    new WikiStateRepository(database).recordVisit("user-admin", "page-root"),
  ),
  call("WikiStateRepository.recordVisit", ({ database }) =>
    new WikiStateRepository(database).recordVisit("user-admin", "page-root"),
  ),
  call("WikiStateRepository.listRecentIds", ({ database }) =>
    new WikiStateRepository(database).listRecentIds("user-admin"),
  ),
  refused("WikiStateRepository.recordVisit", ({ database }) =>
    new WikiStateRepository(database).recordVisit("user-admin", MISSING_TEXT),
  ),
];

const VERSION = {
  pageId: "page-root",
  title: "Stand",
  content: "Inhalt",
  authorId: "user-admin",
};

const VERSION_STEPS: readonly RepositoryStep[] = [
  call("WikiVersionRepository.save", ({ database }) =>
    new WikiVersionRepository(database).save({ ...VERSION, revision: 1 }, 0),
  ),
  // A second save inside the time window refreshes the newest version.
  call("WikiVersionRepository.save", ({ database }) =>
    new WikiVersionRepository(database).save(
      { ...VERSION, revision: 2, content: "Zusammengefasst" },
      10,
    ),
  ),
  call("WikiVersionRepository.list", async ({ database }) =>
    (await new WikiVersionRepository(database).list("page-root")).map(
      ({ revision, title, authorName }) => ({ revision, title, authorName }),
    ),
  ),
  prepare("UPDATE wiki_page_versions SET created_at = '2020-01-01 00:00:00';"),
  // Outside the window a save adds a version.
  call("WikiVersionRepository.save", ({ database }) =>
    new WikiVersionRepository(database).save({ ...VERSION, revision: 3 }, 10),
  ),
  call("WikiVersionRepository.save", ({ database }) =>
    new WikiVersionRepository(database).save(
      { ...VERSION, revision: 4, authorId: "user-manager" },
      0,
    ),
  ),
  prepare(
    "UPDATE wiki_page_versions SET created_at = utc_after(INTERVAL '-40 days') WHERE revision = 3;",
  ),
  call("WikiVersionRepository.list", async ({ database }) =>
    (await new WikiVersionRepository(database).list("page-root")).map(
      ({ revision, title, authorName }) => ({ revision, title, authorName }),
    ),
  ),
  call("WikiVersionRepository.find", async ({ database }) => {
    const versions = new WikiVersionRepository(database);
    const [newest] = await versions.list("page-root");
    return versions.find("page-root", newest?.id ?? "");
  }),
  call("WikiVersionRepository.find", ({ database }) =>
    new WikiVersionRepository(database).find("page-root", "nicht-da"),
  ),
  refused("WikiVersionRepository.save", ({ database }) =>
    new WikiVersionRepository(database).save(
      { ...VERSION, revision: 5, title: MISSING_TEXT },
      0,
    ),
  ),
  prepare(`
    INSERT INTO wiki_page_versions (id, page_id, revision, title, content, author_id, created_at)
    VALUES
        ('version-z', 'page-x', 1, 'Gleich', 'Inhalt', 'user-admin', '2020-01-01 00:00:00'),
        ('version-a', 'page-x', 1, 'Gleich', 'Inhalt', 'user-admin', '2020-01-01 00:00:00'),
        ('version-now-z', 'page-y', 1, 'Gleich', 'Inhalt', 'user-admin', utc_now()),
        ('version-now-a', 'page-y', 1, 'Gleich', 'Inhalt', 'user-admin', utc_now());
    UPDATE wiki_page_versions SET created_at = utc_after(INTERVAL '-1 minute') WHERE page_id = 'page-y';
  `),
  reversedInPostgres("wiki_page_versions"),
  call("WikiVersionRepository.list", ({ database }) =>
    new WikiVersionRepository(database).list("page-x"),
  ),
  prepare(`
    INSERT INTO wiki_page_versions (id, page_id, revision, title, content, author_id, created_at)
    VALUES
        ('version-2-z', 'page-z', 1, 'Gleich', 'Inhalt', 'user-admin', '2020-01-01 00:00:00'),
        ('version-2-a', 'page-z', 1, 'Gleich', 'Inhalt', 'user-admin', '2020-01-01 00:00:00');
  `),
  // Two versions tie as the newest one, and only one of them is refreshed.
  call("WikiVersionRepository.save", ({ database }) =>
    new WikiVersionRepository(database).save(
      { ...VERSION, pageId: "page-y", revision: 2, content: "Aufgefrischt" },
      10,
    ),
  ),
  stored(
    "SELECT id, revision FROM wiki_page_versions WHERE page_id = 'page-y' ORDER BY id;",
  ),
  call("WikiVersionRepository.prune", ({ database }) =>
    new WikiVersionRepository(database).prune(30, 1),
  ),
  stored(
    "SELECT id FROM wiki_page_versions WHERE page_id IN ('page-x', 'page-z') ORDER BY id;",
  ),
  stored(
    "SELECT revision FROM wiki_page_versions WHERE page_id = 'page-root' ORDER BY revision;",
  ),
  call("WikiVersionRepository.prune", ({ database }) =>
    new WikiVersionRepository(database).prune(0, 1),
  ),
  stored(
    "SELECT revision FROM wiki_page_versions WHERE page_id = 'page-root' ORDER BY revision;",
  ),
];

const ATTACHMENT = {
  pageId: "page-root",
  fileName: "gleich.txt",
  contentType: "text/plain",
  kind: "file",
  size: 5_000_000_000,
  checksum: "prüfsumme",
  storageName: "z-datei",
  uploadedBy: "user-admin",
} as const;

const ATTACHMENT_STEPS: readonly RepositoryStep[] = [
  call("WikiAttachmentRepository.insert", async ({ database }) => {
    const attachments = new WikiAttachmentRepository(database);
    await attachments.insert({ ...ATTACHMENT, fileName: "b.txt" });
    await attachments.insert({
      ...ATTACHMENT,
      fileName: "a.txt",
      storageName: "m-datei",
      uploadedBy: "user-weg",
    });
    await attachments.insert({ ...ATTACHMENT, storageName: "a-datei" });
    return (await attachments.listByPage("nicht-da")).length;
  }),
  refused("WikiAttachmentRepository.insert", ({ database }) =>
    new WikiAttachmentRepository(database).insert({
      ...ATTACHMENT,
      fileName: MISSING_TEXT,
    }),
  ),
  prepare(`
    UPDATE wiki_attachments SET created_at = '2026-01-01 00:00:00';
    UPDATE wiki_attachments SET kind = 'media' WHERE file_name = 'b.txt';
  `),
  call("WikiAttachmentRepository.listByPage", ({ database }) =>
    new WikiAttachmentRepository(database).listByPage("page-root"),
  ),
  call("WikiAttachmentRepository.listStorageNames", ({ database }) =>
    new WikiAttachmentRepository(database).listStorageNames(),
  ),
  call("WikiAttachmentRepository.find", async ({ database }) => {
    const attachments = new WikiAttachmentRepository(database);
    const [first] = await attachments.listByPage("page-root");
    return {
      found: await attachments.find(first?.id ?? ""),
      missing: await attachments.find("nicht-da"),
    };
  }),
  call("WikiAttachmentRepository.delete", async ({ database }) => {
    const attachments = new WikiAttachmentRepository(database);
    const [first] = await attachments.listByPage("page-root");
    await attachments.delete(first?.id ?? "");
    return attachments.listStorageNames();
  }),
];

const DELETION_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO wiki_attachments (id, page_id, file_name, content_type, kind, size, checksum, storage_name, uploaded_by)
    VALUES
        ('delete-z', 'page-x', 'z', 'text/plain', 'file', 1, 'c', 'datei-z', 'user-admin'),
        ('delete-m', 'page-x', 'm', 'text/plain', 'file', 1, 'c', 'datei-m', 'user-admin'),
        ('delete-a', 'page-x', 'a', 'text/plain', 'file', 1, 'c', 'datei-a', 'user-admin');
  `),
  reversedInPostgres("wiki_attachments"),
  call("deleteWikiPages", ({ database }) =>
    database.transaction((transaction) =>
      deleteWikiPages(transaction, {
        sql: "SELECT id FROM wiki_pages WHERE id = $page_id",
        parameters: { page_id: "page-x" },
      }),
    ),
  ),
  refused("deleteWikiPages", ({ database }) =>
    database.transaction(async (transaction) => {
      await deleteWikiPages(transaction, {
        sql: "SELECT id FROM wiki_pages WHERE id LIKE $page_id",
        parameters: { page_id: "page-root" },
      });
      throw new Error("The flow ends this transaction.");
    }),
  ),
  stored("SELECT COUNT(*) FROM wiki_attachments;"),
  call("deleteWikiPages", ({ database }) =>
    database.transaction((transaction) =>
      deleteWikiPages(transaction, {
        sql: "SELECT id FROM wiki_pages WHERE id LIKE $page_id OR id LIKE 'search-%'",
        parameters: { page_id: "page-%" },
      }),
    ),
  ),
  ...[
    "wiki_page_anchors",
    "wiki_page_versions",
    "wiki_page_links",
    "wiki_attachments",
    "wiki_comments",
    "wiki_mentions",
    "wiki_favorites",
    "wiki_expanded_pages",
    "wiki_pages",
  ].map((table) => stored(`SELECT COUNT(*) FROM ${table};`)),
  prepare(`
    DELETE FROM wiki_recent_pages;
    DELETE FROM wiki_settings;
    DELETE FROM wiki_user_state;
    DELETE FROM work_items WHERE id IN ('epic-wiki', 'ticket-wiki');
    DELETE FROM milestones WHERE id = 'mile-wiki';
    UPDATE projects SET description = '' WHERE id = 'project-a';
  `),
];

/** Settings, personal state, versions and files of pages, and their final deletion. */
export const WIKI_STATE_FLOW: RepositoryFlow = {
  title: "wiki state",
  steps: [
    ...STATE_STEPS,
    ...VERSION_STEPS,
    ...ATTACHMENT_STEPS,
    ...DELETION_STEPS,
  ],
};
