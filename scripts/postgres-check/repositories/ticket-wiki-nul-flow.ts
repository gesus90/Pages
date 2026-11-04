import { strict as assert } from "node:assert";

import { MilestoneRepository } from "@/backend/database/repositories/task/MilestoneRepository";
import { TaskLabelRepository } from "@/backend/database/repositories/task/TaskLabelRepository";
import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import { WorkItemChecklistRepository } from "@/backend/database/repositories/task/WorkItemChecklistRepository";
import { WorkItemHistoryRepository } from "@/backend/database/repositories/task/WorkItemHistoryRepository";
import { WorkItemQueryRepository } from "@/backend/database/repositories/task/WorkItemQueryRepository";
import { WorkItemTemplateRepository } from "@/backend/database/repositories/task/WorkItemTemplateRepository";
import { WorkItemWriteRepository } from "@/backend/database/repositories/task/WorkItemWriteRepository";
import { WikiAttachmentRepository } from "@/backend/database/repositories/wiki/WikiAttachmentRepository";
import { WikiCommentRepository } from "@/backend/database/repositories/wiki/WikiCommentRepository";
import { WikiLinkRepository } from "@/backend/database/repositories/wiki/WikiLinkRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { WikiPageWriteRepository } from "@/backend/database/repositories/wiki/WikiPageWriteRepository";
import { WikiSearchRepository } from "@/backend/database/repositories/wiki/WikiSearchRepository";
import { WikiStateRepository } from "@/backend/database/repositories/wiki/WikiStateRepository";
import { WikiVersionRepository } from "@/backend/database/repositories/wiki/WikiVersionRepository";

import { keptOnlyByDuckdb } from "./nul-text-flow";
import { REPEAT_SAVE_STEPS } from "./ticket-repeat-save-flow";
import { keyRefusedOnPostgres, withoutNul } from "./saved-order-flows";
import { call, prepare, stored } from "./world";

import type { WikiSearchFilters } from "@/backend/database/repositories/wiki/WikiSearchRepository";
import type { WikiVisibilityScope } from "@/definition/Wiki";
import type { RepositoryFlow, RepositoryStep } from "./world";

const PROJECT = "project-a";
const NUL = "\u0000";
/** The escape of six characters; it is text like any other. */
const JSON_ESCAPE = "\\u0000";

const SCOPE: WikiVisibilityScope = {
  userId: "user-admin",
  isAdmin: true,
  departmentIds: [],
  projectIds: [PROJECT],
};

const SEARCH: WikiSearchFilters = {
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

/** A text that reaches a row, in both databases; only PostgreSQL loses the character. */
const WRITE_STEPS: readonly RepositoryStep[] = [
  call("WorkItemWriteRepository.insert", ({ database }) =>
    new WorkItemWriteRepository(database).insert({
      id: "nul-ticket",
      projectId: PROJECT,
      departmentId: null,
      key: "NUL-1",
      number: 1,
      type: "task",
      parentId: null,
      title: `Ti${NUL}tel`,
      description: `Te${NUL}xt`,
      statusId: "status-todo",
      priority: "normal",
      assigneeId: null,
      assigneeGroupId: null,
      createdBy: "user-admin",
      milestoneId: null,
      dueAt: null,
      startAt: null,
      sortOrder: 0,
    }),
  ),
  keptOnlyByDuckdb(
    "SELECT title, description FROM work_items WHERE id = 'nul-ticket';",
  ),
  call("WorkItemQueryRepository.findById", async ({ database }) =>
    withoutNul(
      await new WorkItemQueryRepository(database).findById("nul-ticket"),
    ),
  ),
  prepare(
    "UPDATE work_items SET description = 'Text' WHERE id = 'nul-ticket';",
  ),
  call("WorkItemWriteRepository.updateDescription", async ({ database }) => {
    const writes = new WorkItemWriteRepository(database);
    await writes.updateDescription(
      "nul-ticket",
      `{"a":"${JSON_ESCAPE}"}`,
      "Text",
    );
    const rows = await database.query(
      "SELECT description FROM work_items WHERE id = 'nul-ticket';",
    );
    assert.deepEqual(rows, [[`{"a":"${JSON_ESCAPE}"}`]]);
  }),
  prepare(
    "UPDATE work_items SET title = 'plain', description = 'plain' WHERE id = 'nul-ticket';",
  ),
  call("WikiPageWriteRepository.insert", ({ database }) =>
    new WikiPageWriteRepository(database).insert(
      {
        id: "nul-page",
        parentId: null,
        scope: "instance",
        projectId: null,
        ownerId: "user-admin",
        authorId: "user-admin",
        title: `Sei${NUL}te`,
        icon: null,
        content: `Inh${NUL}alt`,
        isTemplate: false,
      },
      1,
    ),
  ),
  keptOnlyByDuckdb(
    "SELECT title, content FROM wiki_pages WHERE id = 'nul-page';",
  ),
  call("WikiCommentRepository.insert", async ({ database }) => {
    const comments = new WikiCommentRepository(database);
    await comments.insert({
      pageId: "nul-page",
      parentId: null,
      authorId: "user-admin",
      body: `Kom${NUL}mentar`,
      quote: null,
      quotePrefix: null,
      quoteSuffix: null,
    });
    return withoutNul(
      (await comments.listByPage("nul-page")).map(({ body }) => body),
    );
  }),
  keptOnlyByDuckdb(
    "SELECT body FROM wiki_comments WHERE page_id = 'nul-page';",
  ),
  call("WikiVersionRepository.save", ({ database }) =>
    new WikiVersionRepository(database).save(
      {
        pageId: "nul-page",
        revision: 1,
        title: `Ti${NUL}tel`,
        content: JSON_ESCAPE,
        authorId: "user-admin",
      },
      0,
    ),
  ),
  stored("SELECT content FROM wiki_page_versions WHERE page_id = 'nul-page';"),
  prepare(
    "UPDATE wiki_pages SET title = 'plain', content = 'plain' WHERE id = 'nul-page';",
  ),
];

const TEXT = `mit${NUL}Zeichen`;

/** Every other path that saves a text of a person or of GitHub. */
const WRITE_PATHS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by)
    VALUES ('nul-other', 'project-a', 'NUL-2', 2, 'task', 'Ziel', 'status-todo', 'user-admin');
    INSERT INTO wiki_pages (id, scope, owner_id, author_id, title)
    VALUES ('nul-other-page', 'instance', 'user-admin', 'user-admin', 'Ziel');
  `),
  ...(
    [
      [
        "WorkItemWriteRepository.update",
        ({ database }) =>
          new WorkItemWriteRepository(database).update("nul-other", {
            title: TEXT,
            description: TEXT,
            statusId: "status-todo",
            priority: "normal",
            assigneeId: null,
            assigneeGroupId: null,
            reporterId: "user-admin",
            parentId: null,
            milestoneId: null,
            dueAt: null,
            startAt: null,
          }),
      ],
      [
        "WorkItemWriteRepository.updateTitle",
        async ({ database }) => {
          await database.execute(
            "UPDATE work_items SET title = 'Ziel' WHERE id = 'nul-other';",
          );
          return new WorkItemWriteRepository(database).updateTitle(
            "nul-other",
            TEXT,
            "Ziel",
          );
        },
      ],
      [
        "WorkItemWriteRepository.updateDescription",
        async ({ database }) => {
          await database.execute(
            "UPDATE work_items SET description = 'Ziel' WHERE id = 'nul-other';",
          );
          return new WorkItemWriteRepository(database).updateDescription(
            "nul-other",
            TEXT,
            "Ziel",
          );
        },
      ],
      [
        "WorkItemWriteRepository.updateFromGitHub",
        ({ database }) =>
          new WorkItemWriteRepository(database).updateFromGitHub("nul-other", {
            title: TEXT,
            description: TEXT,
            statusId: "status-todo",
          }),
      ],
      [
        "WorkItemWriteRepository.setGitHubError",
        ({ database }) =>
          new WorkItemWriteRepository(database).setGitHubError(
            "nul-other",
            TEXT,
          ),
      ],
      [
        "MilestoneRepository.insert",
        ({ database }) =>
          new MilestoneRepository(database).insert({
            id: "nul-mile",
            projectId: PROJECT,
            name: TEXT,
            description: TEXT,
            dueAt: null,
          }),
      ],
      [
        "MilestoneRepository.update",
        ({ database }) =>
          new MilestoneRepository(database).update("nul-mile", {
            name: TEXT,
            description: TEXT,
            status: "open",
            dueAt: null,
          }),
      ],
      [
        "MilestoneRepository.updateField",
        ({ database }) =>
          new MilestoneRepository(database).updateField("nul-mile", {
            field: "description",
            base: "nicht mehr",
            value: TEXT,
          }),
      ],
      [
        "TaskLabelRepository.insert",
        ({ database }) =>
          new TaskLabelRepository(database).insert({
            id: "nul-label",
            name: TEXT,
            color: "#000000",
          }),
      ],
      [
        "TaskLabelRepository.update",
        ({ database }) =>
          new TaskLabelRepository(database).update("nul-label", {
            name: TEXT,
            color: "#000000",
          }),
      ],
      [
        "WorkItemChecklistRepository.insert",
        ({ database }) =>
          new WorkItemChecklistRepository(database).insert({
            id: "nul-check",
            workItemId: "nul-other",
            title: TEXT,
          }),
      ],
      [
        "WorkItemChecklistRepository.update",
        ({ database }) =>
          new WorkItemChecklistRepository(database).update("nul-check", {
            title: TEXT,
            isDone: true,
          }),
      ],
      [
        "WorkItemHistoryRepository.insert",
        ({ database }) =>
          new WorkItemHistoryRepository(database).insert({
            id: "nul-history",
            workItemId: "nul-other",
            userId: "user-admin",
            action: "updated",
            field: "title",
            oldValue: TEXT,
            newValue: TEXT,
          }),
      ],
      [
        "WorkItemAttachmentRepository.insert",
        async ({ database }) => {
          await new WorkItemAttachmentRepository(database).insert(
            {
              workItemId: "nul-other",
              fileName: TEXT,
              contentType: "text/plain",
              kind: "file",
              size: 1,
              checksum: "c",
              storageName: "nul-storage",
              uploadedBy: "user-admin",
            },
            "nul-attachment",
          );
        },
      ],
      [
        "WorkItemTemplateRepository.save",
        ({ database }) =>
          new WorkItemTemplateRepository(database).save({
            id: "nul-template",
            name: TEXT,
            ownerId: "user-admin",
            type: "task",
            title: TEXT,
            description: TEXT,
            priority: "normal",
            scope: "private",
            departmentIds: [],
            projectIds: [],
            labelIds: [],
            checklist: [TEXT],
          }),
      ],
      [
        "WikiPageWriteRepository.saveEdit",
        ({ database }) =>
          new WikiPageWriteRepository(database).saveEdit("nul-other-page", {
            title: TEXT,
            content: TEXT,
            icon: null,
            editorId: "user-admin",
          }),
      ],
      [
        "WikiPageWriteRepository.setCover",
        ({ database }) =>
          new WikiPageWriteRepository(database).setCover(
            "nul-other-page",
            TEXT,
          ),
      ],
      [
        "WikiPageWriteRepository.setCurrentUntil",
        ({ database }) =>
          new WikiPageWriteRepository(database).setCurrentUntil(
            "nul-other-page",
            TEXT,
          ),
      ],
      [
        "WikiCommentRepository.updateBody",
        async ({ database }) => {
          const comments = new WikiCommentRepository(database);
          const id = await comments.insert({
            pageId: "nul-other-page",
            parentId: null,
            authorId: "user-admin",
            body: TEXT,
            quote: TEXT,
            quotePrefix: TEXT,
            quoteSuffix: TEXT,
          });
          await comments.updateBody(id, TEXT);
        },
      ],
      [
        "WikiVersionRepository.save",
        ({ database }) =>
          new WikiVersionRepository(database).save(
            {
              pageId: "nul-other-page",
              revision: 1,
              title: TEXT,
              content: TEXT,
              authorId: "user-admin",
            },
            10,
          ),
      ],
      [
        "WikiVersionRepository.save",
        ({ database }) =>
          new WikiVersionRepository(database).save(
            {
              pageId: "nul-other-page",
              revision: 2,
              title: TEXT,
              content: TEXT,
              authorId: "user-admin",
            },
            10,
          ),
      ],
      [
        "WikiAttachmentRepository.insert",
        async ({ database }) => {
          await new WikiAttachmentRepository(database).insert({
            pageId: "nul-other-page",
            fileName: TEXT,
            contentType: "text/plain",
            kind: "file",
            size: 1,
            checksum: "c",
            storageName: "nul-storage",
            uploadedBy: "user-admin",
          });
        },
      ],
    ] as const satisfies readonly (readonly [string, RepositoryStep["run"]])[]
  ).map(([name, run]) => call(name, run)),
  keptOnlyByDuckdb("SELECT description FROM milestones WHERE id = 'nul-mile';"),
  keptOnlyByDuckdb(
    "SELECT title FROM work_item_checklist_items WHERE id = 'nul-check';",
  ),
  keptOnlyByDuckdb(
    "SELECT old_value, new_value FROM work_item_history WHERE id = 'nul-history';",
  ),
  keptOnlyByDuckdb(
    "SELECT file_name FROM work_item_attachments WHERE id = 'nul-attachment';",
  ),
  keptOnlyByDuckdb(
    "SELECT name, title, description FROM work_item_templates WHERE id = 'nul-template';",
  ),
  keptOnlyByDuckdb(
    "SELECT title, content, cover FROM wiki_pages WHERE id = 'nul-other-page';",
  ),
  keptOnlyByDuckdb(
    "SELECT body, quote FROM wiki_comments WHERE page_id = 'nul-other-page';",
  ),
  keptOnlyByDuckdb(
    "SELECT title, content FROM wiki_page_versions WHERE page_id = 'nul-other-page';",
  ),
  keptOnlyByDuckdb(
    "SELECT file_name FROM wiki_attachments WHERE page_id = 'nul-other-page';",
  ),
  keptOnlyByDuckdb(
    "SELECT title, description FROM work_items WHERE id = 'nul-other';",
  ),
];

/** `pl\0ain` is another text than `plain`: it finds and changes nothing, in both databases. */
const COMPARE_STEPS: readonly RepositoryStep[] = [
  call("WorkItemQueryRepository.findByKey", ({ database }) =>
    new WorkItemQueryRepository(database).findByKey(`NUL${NUL}-1`),
  ),
  call("WorkItemQueryRepository.findById", ({ database }) =>
    new WorkItemQueryRepository(database).findById(`nul${NUL}-ticket`),
  ),
  call("WorkItemQueryRepository.findAll", ({ database }) =>
    new WorkItemQueryRepository(database).findAll({
      projectIds: [PROJECT],
      search: `pl${NUL}ain`,
    }),
  ),
  call("WorkItemQueryRepository.findAll", ({ database }) =>
    new WorkItemQueryRepository(database).findAll({
      projectIds: [PROJECT],
      search: `pl${NUL}ain`,
      searchDescription: true,
    }),
  ),
  call("TaskLabelRepository.findByName", ({ database }) =>
    new TaskLabelRepository(database).findByName(`pl${NUL}ain`),
  ),
  call("WorkItemWriteRepository.updateTitle", ({ database }) =>
    new WorkItemWriteRepository(database).updateTitle(
      "nul-ticket",
      "Abgelehnt",
      `pl${NUL}ain`,
    ),
  ),
  call("WorkItemWriteRepository.updateDescription", ({ database }) =>
    new WorkItemWriteRepository(database).updateDescription(
      "nul-ticket",
      "Abgelehnt",
      `pl${NUL}ain`,
    ),
  ),
  stored("SELECT title, description FROM work_items WHERE id = 'nul-ticket';"),
  call("WikiSearchRepository.search", async ({ database }) => {
    const { hits, total } = await new WikiSearchRepository(database).search(
      SCOPE,
      { ...SEARCH, terms: [`pl${NUL}ain`] },
    );
    return { hits: hits.length, total };
  }),
  call("WikiSearchRepository.searchTitles", ({ database }) =>
    new WikiSearchRepository(database).searchTitles(SCOPE, `pl${NUL}ain`, 5),
  ),
  call("WikiLinkRepository.findTicketsMentioning", ({ database }) =>
    new WikiLinkRepository(database).findTicketsMentioning(
      SCOPE,
      `pl${NUL}ain`,
    ),
  ),
  call("WikiLinkRepository.searchTickets", ({ database }) =>
    new WikiLinkRepository(database).searchTickets(SCOPE, `pl${NUL}ain`, 5),
  ),
  call("WikiLookupRepository.searchUsers", ({ database }) =>
    new WikiLookupRepository(database).searchUsers(`adm${NUL}in`, 5),
  ),
  call("WikiLookupRepository.isActiveUser", ({ database }) =>
    new WikiLookupRepository(database).isActiveUser(`user-admin${NUL}`),
  ),
  call("WikiLookupRepository.findActiveUsersByUsernames", ({ database }) =>
    new WikiLookupRepository(database).findActiveUsersByUsernames([
      `admin${NUL}`,
    ]),
  ),
  // A key with the character is its own key: DuckDB stores it, PostgreSQL refuses it.
  keyRefusedOnPostgres("WikiStateRepository.setFavorite", ({ database }) =>
    new WikiStateRepository(database).setFavorite(
      "user-admin",
      `nul${NUL}-page`,
      true,
    ),
  ),
  stored("SELECT COUNT(*) FROM wiki_favorites WHERE page_id = 'nul-page';"),
];

/** U+0000 in tickets and the wiki after the approval: gone when written, kept when compared. */
export const TICKET_WIKI_NUL_FLOW: RepositoryFlow = {
  title: "U+0000 in tickets and wiki",
  steps: [
    ...WRITE_STEPS,
    ...WRITE_PATHS,
    ...REPEAT_SAVE_STEPS,
    ...COMPARE_STEPS,
    prepare(`
      DELETE FROM wiki_favorites;
      DELETE FROM work_item_templates WHERE id = 'nul-template';
      DELETE FROM work_item_template_checklist_items WHERE template_id = 'nul-template';
      DELETE FROM labels WHERE id = 'nul-label';
      DELETE FROM milestones WHERE id = 'nul-mile';
      DELETE FROM work_item_checklist_items WHERE id = 'nul-check';
      DELETE FROM work_item_history WHERE id = 'nul-history';
      DELETE FROM work_item_attachments WHERE id = 'nul-attachment';
      DELETE FROM wiki_attachments WHERE page_id = 'nul-other-page';
      DELETE FROM wiki_comments WHERE page_id = 'nul-other-page';
      DELETE FROM wiki_page_versions WHERE page_id = 'nul-other-page';
      DELETE FROM wiki_pages WHERE id = 'nul-other-page';
      DELETE FROM work_items WHERE id = 'nul-other';
      DELETE FROM wiki_page_versions WHERE page_id = 'nul-page';
      DELETE FROM wiki_comments WHERE page_id = 'nul-page';
      DELETE FROM wiki_pages WHERE id = 'nul-page';
      DELETE FROM work_items WHERE id = 'nul-ticket';
    `),
  ],
};
