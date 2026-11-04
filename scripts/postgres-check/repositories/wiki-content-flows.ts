import { WikiAnchorRepository } from "@/backend/database/repositories/wiki/WikiAnchorRepository";
import { WikiCommentRepository } from "@/backend/database/repositories/wiki/WikiCommentRepository";
import { WikiFeedRepository } from "@/backend/database/repositories/wiki/WikiFeedRepository";
import {
  escapeLike,
  WikiLinkRepository,
} from "@/backend/database/repositories/wiki/WikiLinkRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { WikiMentionRepository } from "@/backend/database/repositories/wiki/WikiMentionRepository";
import { WikiSearchRepository } from "@/backend/database/repositories/wiki/WikiSearchRepository";

import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  refusedWithoutTable,
  reversedInPostgres,
  stored,
} from "./world";

import type { NewWikiComment } from "@/backend/database/repositories/wiki/WikiCommentRepository";
import type { WikiSearchFilters } from "@/backend/database/repositories/wiki/WikiSearchRepository";
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

const FILTERS: WikiSearchFilters = {
  terms: [],
  phrases: [],
  titleOnly: false,
  area: null,
  underPageId: null,
  creatorId: null,
  editedFrom: null,
  editedTo: null,
  sort: "relevance",
  limit: 50,
};

const SEARCHES: readonly WikiSearchFilters[] = [
  FILTERS,
  { ...FILTERS, terms: ["äpfel"] },
  { ...FILTERS, terms: ["ÄPFEL"], titleOnly: true },
  { ...FILTERS, terms: ["äpfel", "birnen"] },
  { ...FILTERS, phrases: ["50%"] },
  { ...FILTERS, phrases: ["5_%"] },
  { ...FILTERS, phrases: ["c:\\temp"] },
  { ...FILTERS, area: { scope: "instance" } },
  { ...FILTERS, area: { scope: "project", projectId: "project-a" } },
  { ...FILTERS, underPageId: "search-a" },
  { ...FILTERS, creatorId: "user-manager" },
  { ...FILTERS, editedFrom: "2026-03-01" },
  { ...FILTERS, editedTo: "2026-02-01" },
  { ...FILTERS, sort: "edited" },
  { ...FILTERS, sort: "created" },
  { ...FILTERS, limit: 1 },
];

const COMMENT: NewWikiComment = {
  pageId: "page-root",
  parentId: null,
  authorId: "user-manager",
  body: "Erster",
  quote: null,
  quotePrefix: null,
  quoteSuffix: null,
};

const ANCHOR_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO milestones (id, project_id, name) VALUES ('mile-wiki', 'project-a', 'Meilenstein');
    INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by, department_id, description)
    VALUES
        ('epic-wiki', 'project-a', 'WIKI-2', 2, 'epic', 'Epos', 'status-todo', 'user-admin', 'department-z', 'Siehe /wiki/page-root'),
        ('ticket-wiki', 'project-a', 'WIKI-1', 1, 'task', 'Äpfel 100%', 'status-todo', 'user-admin', NULL, 'Siehe /wiki/page-root und 100%');
    UPDATE projects SET description = 'Siehe /wiki/page-root' WHERE id = 'project-a';
  `),
  call("WikiAnchorRepository.replaceAnchors", ({ database }) =>
    new WikiAnchorRepository(database).replaceAnchors("page-y", [
      { kind: "milestone", targetId: "mile-wiki" },
      { kind: "epic", targetId: "epic-wiki" },
      { kind: "department", targetId: "department-z" },
      { kind: "department", targetId: "department-weg" },
    ]),
  ),
  refused("WikiAnchorRepository.replaceAnchors", ({ database }) =>
    new WikiAnchorRepository(database).replaceAnchors("page-x", [
      { kind: "epic", targetId: "epic-wiki" },
      { kind: "epic", targetId: "epic-wiki" },
    ]),
  ),
  call("WikiAnchorRepository.findAnchors", ({ database }) =>
    new WikiAnchorRepository(database).findAnchors("page-y"),
  ),
  call("WikiAnchorRepository.findPageIdsByTargets", ({ database }) =>
    new WikiAnchorRepository(database).findPageIdsByTargets("epic", [
      "epic-wiki",
      "nicht-da",
    ]),
  ),
  ...(
    [
      ["department", "department-a"],
      ["milestone", "mile-wiki"],
      ["epic", "epic-wiki"],
      ["epic", "ticket-wiki"],
    ] as const
  ).map(([kind, target]) =>
    call("WikiAnchorRepository.findAnchorTarget", ({ database }) =>
      new WikiAnchorRepository(database).findAnchorTarget(kind, target),
    ),
  ),
  call("WikiAnchorRepository.removeAnchorsOfSubtree", ({ database }) =>
    new WikiAnchorRepository(database).removeAnchorsOfSubtree("page-root", [
      "department",
      "milestone",
    ]),
  ),
  call("WikiAnchorRepository.findAnchors", ({ database }) =>
    new WikiAnchorRepository(database).findAnchors("page-y"),
  ),
];

const COMMENT_STEPS: readonly RepositoryStep[] = [
  call("WikiCommentRepository.insert", async ({ database }) => {
    const comments = new WikiCommentRepository(database);
    const first = await comments.insert(COMMENT);
    await comments.insert({
      ...COMMENT,
      parentId: first,
      authorId: "user-admin",
      body: "Antwort",
      quote: "Zitat",
      quotePrefix: "vor",
      quoteSuffix: "nach",
    });
    await comments.insert({ ...COMMENT, body: "Dritter" });
    return comments.listByPage("nicht-da");
  }),
  // Three comments of one second keep the order they were written in.
  prepare(`
    UPDATE wiki_comments SET created_at = '2026-01-01 00:00:00', updated_at = '2026-01-01 00:00:00';
  `),
  reversedInPostgres("wiki_comments"),
  call("WikiCommentRepository.listByPage", ({ database }) =>
    new WikiCommentRepository(database).listByPage("page-root"),
  ),
  refused("WikiCommentRepository.insert", ({ database }) =>
    new WikiCommentRepository(database).insert({
      ...COMMENT,
      body: MISSING_TEXT,
    }),
  ),
  call("WikiCommentRepository.setResolved", async ({ database }) => {
    const comments = new WikiCommentRepository(database);
    const [first] = await comments.listByPage("page-root");
    await comments.setResolved(first?.id ?? "", "user-admin");
    const resolved = await comments.find(first?.id ?? "");
    await comments.setResolved(first?.id ?? "", null);
    return {
      resolved,
      reopened: await comments.find(first?.id ?? ""),
      missing: await comments.find("nicht-da"),
    };
  }),
  call("WikiCommentRepository.updateBody", async ({ database }) => {
    const comments = new WikiCommentRepository(database);
    const [, , third] = await comments.listByPage("page-root");
    await comments.updateBody(third?.id ?? "", "Dritter neu");
    return comments.find(third?.id ?? "");
  }),
];

const FEED_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO wiki_mentions (page_id, comment_id, user_id, created_by, created_at)
    VALUES
        ('page-root', '', 'user-admin', 'user-manager', '2026-01-01 00:00:00'),
        ('page-z', '', 'user-admin', 'user-manager', '2026-01-01 00:00:00'),
        ('page-private', '', 'user-admin', 'user-manager', '2026-01-01 00:00:00');
    UPDATE wiki_pages SET current_until = '2025-12-31' WHERE id = 'page-y';
  `),
  // Read in both physical orders: DuckDB may hand out equal keys either way round.
  ...[1, 2].flatMap((): RepositoryStep[] => [
    reversedInPostgres("wiki_mentions"),
    reversedInPostgres("wiki_comments"),
    call("WikiFeedRepository.collect", ({ database }) =>
      new WikiFeedRepository(database).collect(ADMIN, "2026-01-01"),
    ),
  ]),
  call("WikiFeedRepository.collect", ({ database }) =>
    new WikiFeedRepository(database).collect(MEMBER, "2026-01-01"),
  ),
  call("WikiFeedRepository.findReadTime", ({ database }) =>
    new WikiFeedRepository(database).findReadTime("user-admin"),
  ),
  call("WikiFeedRepository.markRead", ({ database }) =>
    new WikiFeedRepository(database).markRead("user-admin"),
  ),
  call("WikiFeedRepository.markRead", ({ database }) =>
    new WikiFeedRepository(database).markRead("user-admin"),
  ),
  call("WikiFeedRepository.findReadTime", ({ database }) =>
    new WikiFeedRepository(database).findReadTime("user-admin"),
  ),
  refusedWithoutTable(
    "WikiFeedRepository.collect",
    "wiki_mentions",
    (transaction) =>
      new WikiFeedRepository(transaction).collect(ADMIN, "2026-01-01"),
  ),
  call("WikiCommentRepository.delete", async ({ database }) => {
    const comments = new WikiCommentRepository(database);
    const [first] = await comments.listByPage("page-root");
    await comments.delete(first?.id ?? "");
    return (await comments.listByPage("page-root")).map(({ body }) => body);
  }),
];

const LINK_STEPS: readonly RepositoryStep[] = [
  call("WikiLinkRepository.replace", ({ database }) =>
    new WikiLinkRepository(database).replace("page-z", {
      pageIds: ["page-root", "page-z"],
      ticketKeys: ["WIKI-1"],
    }),
  ),
  call("WikiLinkRepository.replace", ({ database }) =>
    new WikiLinkRepository(database).replace("page-y", {
      pageIds: ["page-root"],
      ticketKeys: [],
    }),
  ),
  refused("WikiLinkRepository.replace", ({ database }) =>
    new WikiLinkRepository(database).replace("page-x", {
      pageIds: ["page-root", "page-root"],
      ticketKeys: [],
    }),
  ),
  call("WikiLinkRepository.findLinkingPages", ({ database }) =>
    new WikiLinkRepository(database).findLinkingPages(ADMIN, "page-root"),
  ),
  call("WikiLinkRepository.findTicketsMentioning", ({ database }) =>
    new WikiLinkRepository(database).findTicketsMentioning(
      ADMIN,
      "/wiki/page-root",
    ),
  ),
  call("WikiLinkRepository.findTicketsMentioning", ({ database }) =>
    new WikiLinkRepository(database).findTicketsMentioning(MEMBER, "100%"),
  ),
  prepare(`
    INSERT INTO projects (id, name, description, owner_id, updated_at)
    VALUES
        ('project-tie-z', 'Gleich', 'Auf /wiki/page-root', 'user-admin', '2026-01-01 00:00:00'),
        ('project-tie-a', 'Gleich', 'Auf /wiki/page-root', 'user-admin', '2026-01-01 00:00:00');
  `),
  reversedInPostgres("projects"),
  call("WikiLinkRepository.findProjectsMentioning", ({ database }) =>
    new WikiLinkRepository(database).findProjectsMentioning(
      { ...ADMIN, projectIds: ["project-a", "project-tie-z", "project-tie-a"] },
      "/wiki/page-root",
    ),
  ),
  prepare("DELETE FROM projects WHERE id LIKE 'project-tie-%';"),
  call("WikiLinkRepository.findProjectsMentioning", ({ database }) =>
    new WikiLinkRepository(database).findProjectsMentioning(
      { ...ADMIN, projectIds: [] },
      "/wiki/",
    ),
  ),
  call("WikiLinkRepository.searchTickets", ({ database }) =>
    new WikiLinkRepository(database).searchTickets(ADMIN, "wiki-", 10),
  ),
  call("WikiLinkRepository.searchTickets", ({ database }) =>
    new WikiLinkRepository(database).searchTickets(MEMBER, "ÄPFEL", 1),
  ),
  call("escapeLike", () => Promise.resolve(escapeLike("a%b_c\\d"))),
];

const LOOKUP_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO users (id, username, display_name, password_hash, role)
    VALUES
        ('user-frei', 'frei.name-1', 'Ähnlich Gleich', 'h', 'employee'),
        ('user-raum', 'mit raum', 'Ähnlich Gleich', 'h', 'employee'),
        ('user-tab', 'mit' || chr(9) || 'tab', 'Ähnlich Gleich', 'h', 'employee'),
        ('user-mail', 'a@b', 'Ähnlich Gleich', 'h', 'employee'),
        ('user-klammer', 'k[1]', 'Ähnlich Gleich', 'h', 'employee'),
        ('user-zitat', 'o''neil', 'Ähnlich Gleich', 'h', 'employee'),
        ('user-zwei', 'zweiter', 'Ähnlich Gleich', 'h', 'employee');
  `),
  call("WikiLookupRepository.searchUsers", ({ database }) =>
    new WikiLookupRepository(database).searchUsers("ähnlich", 10),
  ),
  call("WikiLookupRepository.searchUsers", ({ database }) =>
    new WikiLookupRepository(database).searchUsers("%", 10),
  ),
  call("WikiLookupRepository.searchUsers", ({ database }) =>
    new WikiLookupRepository(database).searchUsers("", 1),
  ),
  call("WikiLookupRepository.isActiveUser", ({ database }) =>
    new WikiLookupRepository(database).isActiveUser("user-frei"),
  ),
  call("WikiLookupRepository.isActiveUser", ({ database }) =>
    new WikiLookupRepository(database).isActiveUser("nicht-da"),
  ),
  call("WikiLookupRepository.findUserName", ({ database }) =>
    new WikiLookupRepository(database).findUserName("user-frei"),
  ),
  call("WikiLookupRepository.findUserName", ({ database }) =>
    new WikiLookupRepository(database).findUserName("nicht-da"),
  ),
  call("WikiLookupRepository.findProjectNames", ({ database }) =>
    new WikiLookupRepository(database).findProjectNames([
      "project-b",
      "project-a",
    ]),
  ),
  call("WikiLookupRepository.findProjectNames", ({ database }) =>
    new WikiLookupRepository(database).findProjectNames([]),
  ),
  call("WikiLookupRepository.listActiveUsers", ({ database }) =>
    new WikiLookupRepository(database).listActiveUsers(),
  ),
  call("WikiLookupRepository.listDepartments", ({ database }) =>
    new WikiLookupRepository(database).listDepartments(),
  ),
  call("WikiLookupRepository.listMilestones", ({ database }) =>
    new WikiLookupRepository(database).listMilestones(["project-a"]),
  ),
  call("WikiLookupRepository.listEpics", ({ database }) =>
    new WikiLookupRepository(database).listEpics(["project-a"]),
  ),
  call("WikiLookupRepository.findActiveUsersByUsernames", ({ database }) =>
    new WikiLookupRepository(database).findActiveUsersByUsernames([
      "FREI.NAME-1",
      "ZWEITER",
    ]),
  ),
  refused("WikiLookupRepository.searchUsers", ({ database }) =>
    new WikiLookupRepository(database).searchUsers("", -1),
  ),
  prepare("DELETE FROM users WHERE password_hash = 'h';"),
  call("WikiMentionRepository.replace", ({ database }) =>
    new WikiMentionRepository(database).replace(
      { pageId: "page-x", commentId: "", authorId: "user-admin" },
      ["user-admin", "user-manager"],
    ),
  ),
  call("WikiMentionRepository.replace", ({ database }) =>
    new WikiMentionRepository(database).replace(
      { pageId: "page-x", commentId: "", authorId: "user-admin" },
      ["user-manager"],
    ),
  ),
  stored(
    "SELECT user_id, created_by FROM wiki_mentions WHERE page_id = 'page-x' ORDER BY user_id;",
  ),
  call("WikiMentionRepository.replace", ({ database }) =>
    new WikiMentionRepository(database).replace(
      { pageId: "page-x", commentId: "", authorId: "user-admin" },
      [],
    ),
  ),
  refused("WikiMentionRepository.replace", ({ database }) =>
    new WikiMentionRepository(database).replace(
      { pageId: "page-x", commentId: "", authorId: "user-admin" },
      [MISSING_TEXT],
    ),
  ),
];

const SEARCH_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO wiki_pages (id, scope, project_id, parent_id, position, owner_id, author_id, title, content, created_at, updated_at)
    VALUES
        ('search-c', 'instance', NULL, NULL, 1, 'user-admin', 'user-admin', 'Gleich Äpfel', 'nichts', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
        ('search-a', 'instance', NULL, NULL, 1, 'user-admin', 'user-manager', 'Gleich Äpfel', 'Birnen 50%', '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
        ('search-b', 'instance', NULL, 'search-a', 1, 'user-admin', 'user-admin', 'Unterseite', 'äpfel und c:\\temp', '2026-04-01 00:00:00', '2026-04-02 00:00:00'),
        ('search-p', 'project', 'project-a', NULL, 1, 'user-admin', 'user-admin', 'Projekt', '500 Äpfel', '2026-01-01 00:00:00', '2026-01-02 00:00:00');
    UPDATE wiki_pages SET updated_by = 'user-admin' WHERE id = 'search-c';
  `),
  ...SEARCHES.map((filters) =>
    call("WikiSearchRepository.search", async ({ database }) => {
      const { hits, total } = await new WikiSearchRepository(database).search(
        ADMIN,
        filters,
      );
      return {
        total,
        hits: hits
          .filter(({ id }) => id.startsWith("search-"))
          .map(({ id, title, content }) => ({ id, title, content })),
      };
    }),
  ),
  call("WikiSearchRepository.searchTitles", ({ database }) =>
    new WikiSearchRepository(database).searchTitles(MEMBER, " äpfel ", 10),
  ),
  call("WikiSearchRepository.searchTitles", ({ database }) =>
    new WikiSearchRepository(database).searchTitles(MEMBER, "", 2),
  ),
  refused("WikiSearchRepository.search", ({ database }) =>
    new WikiSearchRepository(database).search(ADMIN, {
      ...FILTERS,
      limit: -1,
    }),
  ),
];

/** What hangs off a page: anchors, comments, the feed, links, lookups and search. */
export const WIKI_CONTENT_FLOW: RepositoryFlow = {
  title: "wiki content",
  steps: [
    ...ANCHOR_STEPS,
    ...COMMENT_STEPS,
    ...FEED_STEPS,
    ...LINK_STEPS,
    ...LOOKUP_STEPS,
    ...SEARCH_STEPS,
  ],
};
