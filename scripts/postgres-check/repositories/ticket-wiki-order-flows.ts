import { strict as assert } from "node:assert";

import { EligibleAssigneeRepository } from "@/backend/database/repositories/task/EligibleAssigneeRepository";
import { MilestoneDependencyRepository } from "@/backend/database/repositories/task/MilestoneDependencyRepository";
import { MilestoneRepository } from "@/backend/database/repositories/task/MilestoneRepository";
import { WorkItemChecklistRepository } from "@/backend/database/repositories/task/WorkItemChecklistRepository";
import { WorkItemHistoryRepository } from "@/backend/database/repositories/task/WorkItemHistoryRepository";
import { WorkItemLinkRepository } from "@/backend/database/repositories/task/WorkItemLinkRepository";
import { WorkItemQueryRepository } from "@/backend/database/repositories/task/WorkItemQueryRepository";
import { WikiCommentRepository } from "@/backend/database/repositories/wiki/WikiCommentRepository";
import { WikiFeedRepository } from "@/backend/database/repositories/wiki/WikiFeedRepository";
import { WikiLinkRepository } from "@/backend/database/repositories/wiki/WikiLinkRepository";
import { WikiVersionRepository } from "@/backend/database/repositories/wiki/WikiVersionRepository";

import { inOrder } from "./saved-order-flows";
import { call, prepare, reversedInPostgres } from "./world";

import type { WikiVisibilityScope } from "@/definition/Wiki";
import type { RepositoryFlow, RepositoryStep } from "./world";

const PROJECT = "project-a";
const SECOND = "2026-01-01 00:00:00";
const CREATED = ["order-z", "order-m", "order-a"];

const SCOPE: WikiVisibilityScope = {
  userId: "user-admin",
  isAdmin: true,
  departmentIds: [],
  projectIds: [PROJECT, "project-order-z", "project-order-m"],
};

const TICKET_ROWS = `
  INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by, sort_order, created_at, updated_at, due_at)
  VALUES
      ('order-z', 'project-a', 'ORD-1', 1, 'task', 'Gleich', 'status-todo', 'user-admin', 900, '${SECOND}', '${SECOND}', '2026-05-01'),
      ('order-m', 'project-a', 'ORD-2', 2, 'task', 'Gleich', 'status-todo', 'user-admin', 900, '${SECOND}', '${SECOND}', '2026-05-01'),
      ('order-a', 'project-a', 'ORD-3', 3, 'task', 'Gleich', 'status-todo', 'user-admin', 900, '${SECOND}', '${SECOND}', '2026-05-01');
`;

const LISTS = [undefined, "due_asc", "due_nulls_last", "updated_desc"] as const;

const TICKET_STEPS: readonly RepositoryStep[] = [
  prepare(TICKET_ROWS),
  reversedInPostgres("work_items"),
  ...LISTS.map((orderBy) =>
    call("WorkItemQueryRepository.findAll", async ({ database }) =>
      inOrder(
        await new WorkItemQueryRepository(database).findAll({
          projectIds: [PROJECT],
          ...(orderBy ? { orderBy } : {}),
        }),
        CREATED,
        ({ id }) => id,
      ),
    ),
  ),
];

const ROW_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO work_item_history (id, work_item_id, user_id, action, created_at)
    VALUES
        ('order-z', 'order-z', 'user-admin', 'updated', '${SECOND}'),
        ('order-m', 'order-z', 'user-admin', 'updated', '${SECOND}'),
        ('order-a', 'order-z', 'user-admin', 'updated', '${SECOND}');
    INSERT INTO work_item_links (id, work_item_id, linked_work_item_id, link_type, created_at)
    VALUES
        ('order-in', 'order-a', 'order-z', 'relates_to', '${SECOND}'),
        ('order-z', 'order-z', 'order-a', 'relates_to', '${SECOND}'),
        ('order-m', 'order-z', 'order-m', 'relates_to', '${SECOND}'),
        ('order-a', 'order-z', 'order-a', 'blocks', '${SECOND}');
    INSERT INTO work_item_checklist_items (id, work_item_id, title, sort_order, created_at, updated_at)
    VALUES
        ('order-z', 'order-z', 'Punkt', 1, '${SECOND}', '${SECOND}'),
        ('order-m', 'order-z', 'Punkt', 1, '${SECOND}', '${SECOND}'),
        ('order-a', 'order-z', 'Punkt', 1, '${SECOND}', '${SECOND}');
    INSERT INTO milestones (id, project_id, name, due_at)
    VALUES
        ('order-z', 'project-a', 'Gleich', '2026-01-01'),
        ('order-m', 'project-a', 'Gleich', '2026-01-01'),
        ('order-a', 'project-a', 'Gleich', '2026-01-01');
    INSERT INTO milestone_dependencies (id, project_id, source_id, target_id, link_type, created_at)
    VALUES
        ('order-z', 'project-a', 's', 'z', 'blocks', '${SECOND}'),
        ('order-m', 'project-a', 's', 'm', 'blocks', '${SECOND}'),
        ('order-a', 'project-a', 's', 'a', 'blocks', '${SECOND}');
    INSERT INTO users (id, username, display_name, password_hash, role, created_at)
    VALUES
        ('order-z', 'order-z', 'Gleicher Name', 'h', 'employee', '2026-01-01 00:00:00'),
        ('order-m', 'order-m', 'Gleicher Name', 'h', 'employee', '2026-01-01 00:00:01'),
        ('order-a', 'order-a', 'Gleicher Name', 'h', 'employee', '2026-01-01 00:00:02');
    INSERT INTO projects (id, name, description, owner_id, created_at)
    VALUES
        ('project-order-z', 'Gleiche Fundstelle', 'Auf /wiki/order', 'user-admin', '2026-01-01 00:00:00'),
        ('project-order-m', 'Gleiche Fundstelle', 'Auf /wiki/order', 'user-admin', '2026-01-01 00:00:01');
  `),
  reversedInPostgres("work_item_history"),
  reversedInPostgres("work_item_links"),
  reversedInPostgres("work_item_checklist_items"),
  reversedInPostgres("milestones"),
  reversedInPostgres("milestone_dependencies"),
  reversedInPostgres("users"),
  reversedInPostgres("projects"),
  call("WorkItemHistoryRepository.findByWorkItemId", async ({ database }) =>
    inOrder(
      await new WorkItemHistoryRepository(database).findByWorkItemId("order-z"),
      CREATED,
      ({ id }) => id,
    ),
  ),
  call("WorkItemHistoryRepository.findByProjectId", async ({ database }) =>
    inOrder(
      (
        await new WorkItemHistoryRepository(database).findByProjectId(PROJECT)
      ).filter(({ workItemId }) => workItemId === "order-z"),
      CREATED,
      ({ id }) => id,
    ),
  ),
  // Outgoing links come first, each direction as created.
  call("WorkItemLinkRepository.findByWorkItemId", async ({ database }) =>
    inOrder(
      await new WorkItemLinkRepository(database).findByWorkItemId("order-z"),
      [...CREATED, "order-in"],
      ({ id }) => id,
    ),
  ),
  call("WorkItemChecklistRepository.findByWorkItemId", async ({ database }) =>
    inOrder(
      await new WorkItemChecklistRepository(database).findByWorkItemId(
        "order-z",
      ),
      CREATED,
      ({ id }) => id,
    ),
  ),
  call("MilestoneRepository.findByProjectIds", async ({ database }) =>
    inOrder(
      await new MilestoneRepository(database).findByProjectIds([PROJECT]),
      CREATED,
      ({ id }) => id,
    ),
  ),
  call("MilestoneDependencyRepository.findByProjectIds", async ({ database }) =>
    inOrder(
      await new MilestoneDependencyRepository(database).findByProjectIds([
        PROJECT,
      ]),
      CREATED,
      ({ id }) => id,
    ),
  ),
  call("EligibleAssigneeRepository.findCandidates", async ({ database }) =>
    inOrder(
      (await new EligibleAssigneeRepository(database).findCandidates()).filter(
        ({ displayName }) => displayName === "Gleicher Name",
      ),
      CREATED,
      ({ id }) => id,
    ),
  ),
  call("WikiLinkRepository.findProjectsMentioning", async ({ database }) =>
    inOrder(
      await new WikiLinkRepository(database).findProjectsMentioning(
        SCOPE,
        "/wiki/order",
      ),
      ["project-order-z", "project-order-m"],
      ({ id }) => id,
    ),
  ),
];

const WIKI_STEPS: readonly RepositoryStep[] = [
  call("WikiCommentRepository.insert", async ({ database }) => {
    const comments = new WikiCommentRepository(database);
    const comment = {
      pageId: "page-order",
      parentId: null,
      authorId: "user-admin",
      quote: null,
      quotePrefix: null,
      quoteSuffix: null,
    };
    const id = await comments.insert({ ...comment, body: "Zuerst" });
    await comments.insert({ ...comment, body: "Danach" });
    await comments.insert({ ...comment, body: "Zuletzt" });
    // An identifier stays random: nothing about it may tell the order.
    assert.equal(id[14], "4");
  }),
  prepare(`UPDATE wiki_comments SET created_at = '${SECOND}';`),
  reversedInPostgres("wiki_comments"),
  call(
    "WikiCommentRepository.listByPage",
    async ({ database }) =>
      inOrder(
        await new WikiCommentRepository(database).listByPage("page-order"),
        ["Zuerst", "Danach", "Zuletzt"],
        ({ body }) => body,
      ).length,
  ),
  prepare(`
    INSERT INTO wiki_page_versions (id, page_id, revision, title, content, author_id, created_at)
    VALUES
        ('order-z', 'page-order', 1, 'Gleich', 'Inhalt', 'user-admin', '${SECOND}'),
        ('order-m', 'page-order', 1, 'Gleich', 'Inhalt', 'user-admin', '${SECOND}'),
        ('order-a', 'page-order', 1, 'Gleich', 'Inhalt', 'user-admin', '${SECOND}');
    UPDATE wiki_page_versions SET created_at = utc_now() WHERE page_id = 'page-order';
  `),
  reversedInPostgres("wiki_page_versions"),
  call(
    "WikiVersionRepository.list",
    async ({ database }) =>
      inOrder(
        await new WikiVersionRepository(database).list("page-order"),
        CREATED,
        ({ id }) => id,
      ).length,
  ),
  // The first version created of those that tie is the one that is refreshed and kept.
  call("WikiVersionRepository.save", ({ database }) =>
    new WikiVersionRepository(database).save(
      {
        pageId: "page-order",
        revision: 1,
        title: "Aufgefrischt",
        content: "Inhalt",
        authorId: "user-admin",
      },
      10,
    ),
  ),
  call("stored", async ({ database }) => {
    const [row] = await database.query(
      "SELECT id FROM wiki_page_versions WHERE title = 'Aufgefrischt';",
    );
    assert.deepEqual(row, ["order-z"]);
  }),
  prepare("UPDATE wiki_page_versions SET created_at = '2020-01-01 00:00:00';"),
  reversedInPostgres("wiki_page_versions"),
  call("WikiVersionRepository.prune", ({ database }) =>
    new WikiVersionRepository(database).prune(30, 1),
  ),
  call("stored", async ({ database }) => {
    const rows = await database.query(
      "SELECT id FROM wiki_page_versions WHERE page_id = 'page-order';",
    );
    assert.deepEqual(rows, [["order-z"]]);
  }),
];

/** "For me" within one second and page: mentions, replies, comments, then what expired. */
const FEED_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO wiki_pages (id, scope, owner_id, author_id, title, current_until)
    VALUES ('page-feed', 'instance', 'user-admin', 'user-admin', 'Für mich', '2026-01-01');
    INSERT INTO wiki_comments (id, page_id, parent_id, author_id, body, created_at)
    VALUES
        ('feed-z', 'page-feed', NULL, 'user-manager', 'Zuerst', '${SECOND}'),
        ('feed-m', 'page-feed', NULL, 'user-manager', 'Danach', '${SECOND}'),
        ('feed-parent', 'page-feed', NULL, 'user-admin', 'Eigen', '${SECOND}'),
        ('feed-a', 'page-feed', 'feed-parent', 'user-manager', 'Antwort', '${SECOND}');
    INSERT INTO wiki_mentions (page_id, comment_id, user_id, created_by, created_at)
    VALUES ('page-feed', '', 'user-admin', 'user-manager', '${SECOND}');
  `),
  ...[1, 2].flatMap((): RepositoryStep[] => [
    reversedInPostgres("wiki_comments"),
    call(
      "WikiFeedRepository.collect",
      async ({ database }) =>
        inOrder(
          (
            await new WikiFeedRepository(database).collect(SCOPE, "2026-06-01")
          ).filter(({ pageId }) => pageId === "page-feed"),
          [
            "mention:",
            "reply:Antwort",
            "comment:Zuerst",
            "comment:Danach",
            "expired:",
          ],
          ({ reason, excerpt }) => `${reason}:${excerpt}`,
        ).length,
    ),
  ]),
  prepare(`
    DELETE FROM wiki_mentions WHERE page_id = 'page-feed';
    DELETE FROM wiki_comments WHERE page_id = 'page-feed';
    DELETE FROM wiki_pages WHERE id = 'page-feed';
  `),
];

/** Rows of one second, in the order they were created; both databases could agree on another. */
export const CREATION_ORDER_FLOW: RepositoryFlow = {
  title: "creation order",
  steps: [
    ...TICKET_STEPS,
    ...ROW_STEPS,
    ...WIKI_STEPS,
    ...FEED_STEPS,
    prepare(`
      DELETE FROM work_item_history;
      DELETE FROM work_item_links;
      DELETE FROM work_item_checklist_items;
      DELETE FROM milestone_dependencies;
      DELETE FROM milestones WHERE id LIKE 'order-%';
      DELETE FROM work_items WHERE id LIKE 'order-%';
      DELETE FROM users WHERE id LIKE 'order-%';
      DELETE FROM projects WHERE id LIKE 'project-order-%';
      DELETE FROM wiki_comments WHERE page_id = 'page-order';
      DELETE FROM wiki_page_versions WHERE page_id = 'page-order';
    `),
  ],
};
