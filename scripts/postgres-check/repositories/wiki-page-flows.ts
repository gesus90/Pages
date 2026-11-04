import { WikiPageRepository } from "@/backend/database/repositories/wiki/WikiPageRepository";
import {
  readCount,
  readPageRecord,
  readScope,
  readSummary,
  WIKI_PAGE_COLUMNS,
  WIKI_PAGE_JOINS,
} from "@/backend/database/repositories/wiki/WikiPageRows";
import { WikiPageWriteRepository } from "@/backend/database/repositories/wiki/WikiPageWriteRepository";
import {
  createInCondition,
  createVisiblePagesQuery,
} from "@/backend/database/repositories/wiki/WikiVisibility";

import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  refusedWithoutTable,
  reversedInPostgres,
  stored,
} from "./world";

import type { NewWikiPage } from "@/backend/database/repositories/wiki/WikiPageWriteRepository";
import type { WikiVisibilityScope } from "@/definition/Wiki";
import type { RepositoryFlow, RepositoryStep } from "./world";

const ADMIN: WikiVisibilityScope = {
  userId: "user-admin",
  isAdmin: true,
  departmentIds: [],
  projectIds: ["project-a"],
};

const MEMBER: WikiVisibilityScope = {
  userId: "user-manager",
  isAdmin: false,
  departmentIds: ["department-a"],
  projectIds: ["project-a"],
};

const STRANGER: WikiVisibilityScope = {
  userId: "user-niemand",
  isAdmin: false,
  departmentIds: [],
  projectIds: [],
};

const SCOPES = [ADMIN, MEMBER, STRANGER] as const;

const PAGE: NewWikiPage = {
  id: "page-root",
  parentId: null,
  scope: "instance",
  projectId: null,
  ownerId: "user-admin",
  authorId: "user-admin",
  title: "Start",
  icon: null,
  content: "Inhalt",
  isTemplate: false,
};

const NEW_PAGES: readonly NewWikiPage[] = [
  PAGE,
  { ...PAGE, id: "page-z", parentId: "page-root", title: "Gleich", icon: "🌲" },
  { ...PAGE, id: "page-y", parentId: "page-root", title: "Gleich" },
  { ...PAGE, id: "page-x", parentId: "page-y", title: "Enkel" },
  { ...PAGE, id: "page-project", scope: "project", projectId: "project-a" },
  {
    ...PAGE,
    id: "page-project-child",
    parentId: "page-project",
    scope: "project",
    projectId: "project-a",
  },
  {
    ...PAGE,
    id: "page-private",
    scope: "private",
    ownerId: "user-manager",
    title: "Privat",
  },
  {
    ...PAGE,
    id: "page-private-admin",
    scope: "private",
    title: "Privat vom Administrator",
  },
  {
    ...PAGE,
    id: "page-private-employee",
    scope: "private",
    ownerId: "user-employee",
    title: "Privat von Bert",
  },
  { ...PAGE, id: "page-template", title: "Vorlage", isTemplate: true },
  { ...PAGE, id: "page-template-2", title: "Vorlage", isTemplate: true },
  { ...PAGE, id: "page-hidden", title: "Abteilung" },
  {
    ...PAGE,
    id: "page-hidden-child",
    parentId: "page-hidden",
    title: "Darunter",
  },
  { ...PAGE, id: "page-gone", title: "Ziel fehlt", ownerId: "user-manager" },
];

/** The page list ties everywhere, and `page-z` moves to the end in PostgreSQL only. */
const PIN_PAGE_TIMES = `
  UPDATE wiki_pages
  SET position = 1, created_at = '2026-01-01 00:00:00', updated_at = '2026-01-02 00:00:00'
  WHERE id LIKE 'page-%';
  UPDATE wiki_pages SET updated_by = 'user-manager' WHERE id = 'page-z';
`;

const ANCHOR_ROWS = `
  INSERT INTO wiki_page_anchors (page_id, kind, target_id)
  VALUES
      ('page-hidden', 'department', 'department-z'),
      ('page-gone', 'milestone', 'mile-gone');
`;

const WRITE_STEPS: readonly RepositoryStep[] = [
  call("WikiPageWriteRepository.nextPosition", ({ database }) =>
    new WikiPageWriteRepository(database).nextPosition(PAGE, "user-admin"),
  ),
  ...NEW_PAGES.map((page, index) =>
    call("WikiPageWriteRepository.insert", ({ database }) =>
      new WikiPageWriteRepository(database).insert(page, index + 1),
    ),
  ),
  refused("WikiPageWriteRepository.insert", ({ database }) =>
    new WikiPageWriteRepository(database).insert(PAGE, 1),
  ),
  refused("WikiPageWriteRepository.insert", ({ database }) =>
    new WikiPageWriteRepository(database).insert(
      { ...PAGE, id: "page-ohne", title: MISSING_TEXT },
      1,
    ),
  ),
  prepare(PIN_PAGE_TIMES),
  prepare(ANCHOR_ROWS),
  reversedInPostgres("wiki_pages"),
  call("WikiPageWriteRepository.nextPosition", ({ database }) =>
    new WikiPageWriteRepository(database).nextPosition(
      { parentId: "page-root", scope: "instance", projectId: null },
      "user-admin",
    ),
  ),
  call("WikiPageWriteRepository.nextPosition", ({ database }) =>
    new WikiPageWriteRepository(database).nextPosition(
      { parentId: null, scope: "project", projectId: "project-a" },
      "user-admin",
    ),
  ),
  call("WikiPageWriteRepository.findSiblingIds", ({ database }) =>
    new WikiPageWriteRepository(database).findSiblingIds(
      { parentId: "page-root", scope: "instance", projectId: null },
      "user-admin",
    ),
  ),
  call("WikiPageWriteRepository.findSiblingIds", ({ database }) =>
    new WikiPageWriteRepository(database).findSiblingIds(
      { parentId: null, scope: "private", projectId: null },
      "user-manager",
    ),
  ),
  call("WikiPageWriteRepository.saveEdit", ({ database }) =>
    new WikiPageWriteRepository(database).saveEdit("page-x", {
      title: "Enkel neu",
      content: "Neuer Inhalt",
      icon: "📄",
      editorId: "user-manager",
    }),
  ),
  call("WikiPageWriteRepository.saveEdit", ({ database }) =>
    new WikiPageWriteRepository(database).saveEdit("nicht-da", {
      title: "Keine",
      content: "",
      icon: null,
      editorId: "user-manager",
    }),
  ),
  call("WikiPageWriteRepository.place", ({ database }) =>
    new WikiPageWriteRepository(database).place(
      "page-project-child",
      { parentId: null, scope: "instance", projectId: null },
      4,
      "user-manager",
    ),
  ),
  call("WikiPageWriteRepository.place", ({ database }) =>
    new WikiPageWriteRepository(database).place(
      "page-project-child",
      { parentId: "page-project", scope: "project", projectId: "project-a" },
      1,
      "user-admin",
    ),
  ),
  call("WikiPageWriteRepository.applyScopeToDescendants", ({ database }) =>
    new WikiPageWriteRepository(database).applyScopeToDescendants("page-y", {
      parentId: null,
      scope: "project",
      projectId: "project-a",
    }),
  ),
  stored(
    "SELECT id, scope, project_id FROM wiki_pages WHERE id IN ('page-y', 'page-x') ORDER BY id;",
  ),
  call("WikiPageWriteRepository.applyScopeToDescendants", ({ database }) =>
    new WikiPageWriteRepository(database).applyScopeToDescendants("page-y", {
      parentId: null,
      scope: "instance",
      projectId: null,
    }),
  ),
  call("WikiPageWriteRepository.writePositions", ({ database }) =>
    new WikiPageWriteRepository(database).writePositions(["page-y", "page-z"]),
  ),
  call("WikiPageWriteRepository.findSiblingIds", ({ database }) =>
    new WikiPageWriteRepository(database).findSiblingIds(
      { parentId: "page-root", scope: "instance", projectId: null },
      "user-admin",
    ),
  ),
  call("WikiPageWriteRepository.setCurrentUntil", ({ database }) =>
    new WikiPageWriteRepository(database).setCurrentUntil(
      "page-root",
      "2026-12-31",
    ),
  ),
  call("WikiPageWriteRepository.setCover", ({ database }) =>
    new WikiPageWriteRepository(database).setCover("page-root", "preset:wald"),
  ),
  call("WikiPageWriteRepository.setOwner", ({ database }) =>
    new WikiPageWriteRepository(database).setOwner("page-root", "user-manager"),
  ),
  call("WikiPageWriteRepository.setOwner", ({ database }) =>
    new WikiPageWriteRepository(database).setOwner("page-root", "user-admin"),
  ),
  prepare(PIN_PAGE_TIMES),
];

const READ_STEPS: readonly RepositoryStep[] = [
  ...SCOPES.flatMap((scope) => [
    call("WikiPageRepository.listNodes", ({ database }) =>
      new WikiPageRepository(database).listNodes(scope),
    ),
    call("WikiPageRepository.listSummaries", ({ database }) =>
      new WikiPageRepository(database).listSummaries(scope),
    ),
    call("WikiPageRepository.listTemplates", ({ database }) =>
      new WikiPageRepository(database).listTemplates(scope),
    ),
    call("WikiPageRepository.findVisible", ({ database }) =>
      new WikiPageRepository(database).findVisible(scope, "page-hidden-child"),
    ),
    call("WikiPageRepository.findVisible", ({ database }) =>
      new WikiPageRepository(database).findVisible(scope, "page-private"),
    ),
    call("WikiPageRepository.findTitles", ({ database }) =>
      new WikiPageRepository(database).findTitles(scope, [
        "page-z",
        "page-hidden",
        "page-gone",
        "nicht-da",
      ]),
    ),
    call("WikiPageRepository.listChildren", ({ database }) =>
      new WikiPageRepository(database).listChildren(scope, "page-root"),
    ),
    call("WikiPageRepository.listProjectChildren", ({ database }) =>
      new WikiPageRepository(database).listProjectChildren(
        scope,
        "project-a",
        null,
      ),
    ),
    call("WikiPageRepository.listProjectChildren", ({ database }) =>
      new WikiPageRepository(database).listProjectChildren(
        scope,
        "project-a",
        "page-project",
      ),
    ),
  ]),
  call("WikiPageRepository.findTitles", ({ database }) =>
    new WikiPageRepository(database).findTitles(ADMIN, []),
  ),
  call("WikiPageRepository.findBreadcrumb", ({ database }) =>
    new WikiPageRepository(database).findBreadcrumb("page-x"),
  ),
  call("WikiPageRepository.findNode", ({ database }) =>
    new WikiPageRepository(database).findNode("page-x"),
  ),
  call("WikiPageRepository.findNode", ({ database }) =>
    new WikiPageRepository(database).findNode("nicht-da"),
  ),
  call("WikiPageRepository.countLevelsAbove", ({ database }) =>
    new WikiPageRepository(database).countLevelsAbove("page-x"),
  ),
  call("WikiPageRepository.countLevelsBelow", ({ database }) =>
    new WikiPageRepository(database).countLevelsBelow("page-root"),
  ),
  refused("WikiPageRepository.countLevelsBelow", ({ database }) =>
    new WikiPageRepository(database).countLevelsBelow("nicht-da"),
  ),
  call("WikiPageRepository.findSubtreeIds", ({ database }) =>
    new WikiPageRepository(database).findSubtreeIds("page-root"),
  ),
  call("WikiPageRepository.countPrivateByOwner", ({ database }) =>
    new WikiPageRepository(database).countPrivateByOwner(),
  ),
  call("WikiPageRepository.findPrivateIds", ({ database }) =>
    new WikiPageRepository(database).findPrivateIds("user-manager"),
  ),
  refusedWithoutTable(
    "WikiPageRepository.listNodes",
    "wiki_page_anchors",
    (transaction) => new WikiPageRepository(transaction).listNodes(ADMIN),
  ),
];

const TRASH_STEPS: readonly RepositoryStep[] = [
  call("WikiPageWriteRepository.markDeleted", ({ database }) =>
    new WikiPageWriteRepository(database).markDeleted("page-y", "user-manager"),
  ),
  call("WikiPageWriteRepository.markDeleted", ({ database }) =>
    new WikiPageWriteRepository(database).markDeleted("page-z", "user-admin"),
  ),
  prepare(`
    UPDATE wiki_pages SET deleted_at = '2026-01-01 00:00:00' WHERE id IN ('page-y', 'page-x', 'page-z');
    UPDATE wiki_pages SET deleted_by = 'user-admin' WHERE id = 'page-z';
  `),
  ...SCOPES.flatMap((scope) => [
    call("WikiPageRepository.listTrash", ({ database }) =>
      new WikiPageRepository(database).listTrash(scope, false),
    ),
    call("WikiPageRepository.listTrash", ({ database }) =>
      new WikiPageRepository(database).listTrash(scope, true),
    ),
    call("WikiPageRepository.findVisible", ({ database }) =>
      new WikiPageRepository(database).findVisible(scope, "page-x", {
        includeDeleted: true,
      }),
    ),
    call("WikiPageRepository.findVisible", ({ database }) =>
      new WikiPageRepository(database).findVisible(scope, "page-x"),
    ),
  ]),
  call("WikiPageRepository.findExpiredTrashRoots", ({ database }) =>
    new WikiPageRepository(database).findExpiredTrashRoots(30),
  ),
  prepare(
    "UPDATE wiki_pages SET deleted_at = utc_after(INTERVAL '-10 days') WHERE id = 'page-z';",
  ),
  call("WikiPageRepository.findExpiredTrashRoots", ({ database }) =>
    new WikiPageRepository(database).findExpiredTrashRoots(30),
  ),
  call("WikiPageRepository.findExpiredTrashRoots", ({ database }) =>
    new WikiPageRepository(database).findExpiredTrashRoots(5),
  ),
  call("WikiPageWriteRepository.clearDeleted", ({ database }) =>
    new WikiPageWriteRepository(database).clearDeleted("page-y"),
  ),
  call("WikiPageWriteRepository.clearDeleted", ({ database }) =>
    new WikiPageWriteRepository(database).clearDeleted("page-z"),
  ),
  stored(
    "SELECT id, deleted_at, deleted_by, deleted_root_id FROM wiki_pages WHERE id IN ('page-y', 'page-x', 'page-z') ORDER BY id;",
  ),
];

const FUNCTION_STEPS: readonly RepositoryStep[] = [
  call("createInCondition", () =>
    Promise.resolve(createInCondition("page.id", "page", ["a", "b"])),
  ),
  call("createInCondition", () =>
    Promise.resolve(createInCondition("page.id", "page", [])),
  ),
  call("createVisiblePagesQuery", () =>
    Promise.resolve(createVisiblePagesQuery(MEMBER, { includeDeleted: true })),
  ),
  call("readCount", () => Promise.resolve(readCount([BigInt(3)], 0, "count"))),
  refused("readCount", () => Promise.resolve(readCount(["3"], 0, "count"))),
  call("readScope", () => Promise.resolve(readScope(["project"], 0))),
  refused("readScope", () => Promise.resolve(readScope(["fremd"], 0))),
  call("readPageRecord", async ({ database }) => {
    const rows = await database.query(
      `
        SELECT ${WIKI_PAGE_COLUMNS}
        FROM wiki_pages AS page
        ${WIKI_PAGE_JOINS}
        WHERE page.id = 'page-root';
      `,
    );
    return rows.map(readPageRecord);
  }),
  call("readSummary", async ({ database }) => {
    const rows = await database.query(
      `
        SELECT ${WIKI_PAGE_COLUMNS}
        FROM wiki_pages AS page
        ${WIKI_PAGE_JOINS}
        WHERE page.id = 'page-x';
      `,
    );
    return rows.map(readSummary);
  }),
];

/** The page tree, what each viewer sees of it, and its trash. */
export const WIKI_PAGE_FLOW: RepositoryFlow = {
  title: "wiki pages",
  steps: [...WRITE_STEPS, ...READ_STEPS, ...TRASH_STEPS, ...FUNCTION_STEPS],
};
