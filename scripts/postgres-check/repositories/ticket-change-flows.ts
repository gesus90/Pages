import { TicketAssetAuditRepository } from "@/backend/database/repositories/task/TicketAssetAuditRepository";
import { TicketAssetMigrationRepository } from "@/backend/database/repositories/task/TicketAssetMigrationRepository";
import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import { WorkItemChecklistRepository } from "@/backend/database/repositories/task/WorkItemChecklistRepository";
import { WorkItemChecklistRevisionRepository } from "@/backend/database/repositories/task/WorkItemChecklistRevisionRepository";
import { WorkItemHistoryRepository } from "@/backend/database/repositories/task/WorkItemHistoryRepository";
import { WorkItemKeyRepository } from "@/backend/database/repositories/task/WorkItemKeyRepository";
import { WorkItemLifecycleRepository } from "@/backend/database/repositories/task/WorkItemLifecycleRepository";
import { WorkItemLinkRepository } from "@/backend/database/repositories/task/WorkItemLinkRepository";
import { WorkItemProjectMoveRepository } from "@/backend/database/repositories/task/WorkItemProjectMoveRepository";
import { WorkItemQueryRepository } from "@/backend/database/repositories/task/WorkItemQueryRepository";
import { WorkItemTemplateRepository } from "@/backend/database/repositories/task/WorkItemTemplateRepository";
import { WorkItemTreeRepository } from "@/backend/database/repositories/task/WorkItemTreeRepository";
import { WorkItemWriteRepository } from "@/backend/database/repositories/task/WorkItemWriteRepository";

import { agentTransactionScope } from "@/backend/service/agents/AgentTransactionScope";

import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  refusedWithoutTable,
  reversedInPostgres,
  stored,
} from "./world";

import type { NewWorkItemAttachment } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import type { NewWorkItemTemplate } from "@/backend/database/repositories/task/WorkItemTemplateRepository";
import type { WorkItemUpdate } from "@/backend/database/repositories/task/WorkItemWriteRepository";
import type { TaskUpdateSnapshot } from "@/definition/TaskUpdateSnapshot";
import type { RepositoryFlow, RepositoryStep } from "./world";

const PROJECT = "project-a";

const ROWS = `
  INSERT INTO work_items (id, project_id, key, number, type, parent_id, title, description, status_id, created_by, created_at)
  VALUES
      ('change-root', 'project-a', 'CHG-1', 1, 'epic', NULL, 'Wurzel', 'Text', 'status-todo', 'user-admin', '2026-01-01 00:00:00'),
      ('change-b', 'project-a', 'CHG-2', 2, 'task', 'change-root', 'Zweig', 'Text', 'status-todo', 'user-admin', '2026-01-01 00:00:00'),
      ('change-a', 'project-a', 'CHG-3', 3, 'task', 'change-root', 'Zweig', 'Text', 'status-todo', 'user-admin', '2026-01-01 00:00:00'),
      ('change-leaf', 'project-a', 'CHG-4', 4, 'subtask', 'change-b', 'Blatt', 'Text', 'status-todo', 'user-admin', '2026-01-01 00:00:00');
`;

const UPDATE: WorkItemUpdate = {
  title: "Zweig",
  description: "Geändert",
  statusId: "status-todo",
  priority: "normal",
  assigneeId: null,
  assigneeGroupId: null,
  reporterId: "user-admin",
  parentId: "change-root",
  milestoneId: null,
  dueAt: null,
  startAt: null,
};

const SNAPSHOT: TaskUpdateSnapshot = {
  title: "Zweig",
  statusId: "status-todo",
  priority: "normal",
  assigneeId: null,
  assigneeGroupId: null,
  reporterId: "user-admin",
  parentId: "change-root",
  milestoneId: null,
  dueAt: null,
  startAt: null,
};

const ATTACHMENT: NewWorkItemAttachment = {
  workItemId: "change-a",
  fileName: "datei.txt",
  contentType: "text/plain",
  kind: "file",
  size: 12,
  checksum: "prüfsumme",
  storageName: "z-datei",
  uploadedBy: "user-admin",
};

const TEMPLATE: NewWorkItemTemplate = {
  id: "template-b",
  name: "bericht",
  ownerId: "user-admin",
  type: "task",
  title: "Titel",
  description: "Text",
  priority: "normal",
  scope: "projects",
  departmentIds: ["department-z", "department-a", "department-a"],
  projectIds: ["project-b", "project-a"],
  labelIds: ["label-b", "label-a", "label-weg"],
  checklist: ["Zweiter Punkt", "Erster Punkt"],
};

const WRITE_STEPS: readonly RepositoryStep[] = [
  prepare(ROWS),
  ...(
    [
      { ...UPDATE },
      { ...UPDATE, description: "Nicht gespeichert", baseDescription: "alt" },
      { ...UPDATE, description: "Geändert", baseDescription: "alt" },
      { ...UPDATE, description: "Neu", baseDescription: "Geändert" },
      { ...UPDATE, description: "Bleibt", shouldPreserveDescription: true },
      { ...UPDATE, expected: SNAPSHOT },
      {
        ...UPDATE,
        title: "Abgelehnt",
        expected: { ...SNAPSHOT, title: "Veraltet" },
      },
      {
        ...UPDATE,
        title: "Abgelehnt",
        expected: { ...SNAPSHOT, dueAt: "2026-01-01" },
      },
    ] satisfies readonly WorkItemUpdate[]
  ).map((update) =>
    call("WorkItemWriteRepository.update", ({ database }) =>
      new WorkItemWriteRepository(database).update("change-a", update),
    ),
  ),
  stored(
    "SELECT title, description, status_id FROM work_items WHERE id = 'change-a';",
  ),
  refused("WorkItemWriteRepository.update", ({ database }) =>
    new WorkItemWriteRepository(database).update("change-a", {
      ...UPDATE,
      title: MISSING_TEXT,
    }),
  ),
  call("WorkItemWriteRepository.replaceParent", ({ database }) =>
    new WorkItemWriteRepository(database).replaceParent(
      "change-leaf",
      null,
      "falsch",
    ),
  ),
  call("WorkItemWriteRepository.replaceParent", ({ database }) =>
    new WorkItemWriteRepository(database).replaceParent(
      "change-root",
      "change-a",
      null,
    ),
  ),
  call("WorkItemWriteRepository.replaceParent", ({ database }) =>
    new WorkItemWriteRepository(database).replaceParent(
      "change-root",
      null,
      "change-a",
    ),
  ),
  call("WorkItemWriteRepository.setDepartmentIfCurrent", ({ database }) =>
    new WorkItemWriteRepository(database).setDepartmentIfCurrent(
      "change-a",
      "department-a",
      null,
    ),
  ),
  call("WorkItemWriteRepository.setDepartmentIfCurrent", ({ database }) =>
    new WorkItemWriteRepository(database).setDepartmentIfCurrent(
      "change-a",
      null,
      "falsch",
    ),
  ),
  call("WorkItemWriteRepository.updateStatus", ({ database }) =>
    new WorkItemWriteRepository(database).updateStatus(
      "change-a",
      { id: "status-done", isDone: true },
      "status-todo",
    ),
  ),
  stored(
    "SELECT status_id, completed_at IS NULL FROM work_items WHERE id = 'change-a';",
  ),
  call("WorkItemWriteRepository.updateStatusAndOrder", ({ database }) =>
    new WorkItemWriteRepository(database).updateStatusAndOrder(
      "change-a",
      "status-todo",
      9,
      false,
    ),
  ),
  stored(
    "SELECT status_id, sort_order, completed_at IS NULL FROM work_items WHERE id = 'change-a';",
  ),
  // The board posts the number as typed, and DuckDB rounds a fraction to the even number.
  ...[2.5, 3.5, -2.5, 1.4].flatMap((sortOrder): RepositoryStep[] => [
    call("WorkItemWriteRepository.updateStatusAndOrder", ({ database }) =>
      new WorkItemWriteRepository(database).updateStatusAndOrder(
        "change-a",
        "status-todo",
        sortOrder,
        false,
      ),
    ),
    stored("SELECT sort_order FROM work_items WHERE id = 'change-a';"),
  ]),
  refused("WorkItemWriteRepository.updateStatusAndOrder", ({ database }) =>
    new WorkItemWriteRepository(database).updateStatusAndOrder(
      "change-a",
      "status-todo",
      Number.NaN,
      false,
    ),
  ),
];

const KEY_STEPS: readonly RepositoryStep[] = [
  refused("WorkItemKeyRepository.reserveNumbers", ({ database }) =>
    new WorkItemKeyRepository(database).reserveNumbers("project-ohne", 1),
  ),
  call("WorkItemKeyRepository.findOrCreateProjectKey", ({ database }) =>
    new WorkItemKeyRepository(database).findOrCreateProjectKey(PROJECT, "NEU"),
  ),
  call("WorkItemKeyRepository.reserveNumbers", ({ database }) =>
    new WorkItemKeyRepository(database).reserveNumbers(PROJECT, 2),
  ),
];

const CHILD_ROW_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO work_item_history (id, work_item_id, user_id, action, created_at)
    VALUES
        ('history-tie-c', 'change-a', 'user-admin', 'updated', '2026-01-01 00:00:00'),
        ('history-tie-a', 'change-a', 'user-admin', 'updated', '2026-01-01 00:00:00');
  `),
  // Read in both physical orders: DuckDB may hand out equal keys either way round.
  ...[1, 2].flatMap((): RepositoryStep[] => [
    reversedInPostgres("work_item_history"),
    call("WorkItemHistoryRepository.findByWorkItemId", ({ database }) =>
      new WorkItemHistoryRepository(database).findByWorkItemId("change-a"),
    ),
    call("WorkItemHistoryRepository.findByProjectId", ({ database }) =>
      new WorkItemHistoryRepository(database).findByProjectId(PROJECT),
    ),
  ]),
  refused("WorkItemHistoryRepository.insert", ({ database }) =>
    new WorkItemHistoryRepository(database).insert({
      id: "history-x",
      workItemId: "change-a",
      userId: "user-admin",
      action: MISSING_TEXT,
      field: null,
      oldValue: null,
      newValue: null,
    }),
  ),
  prepare(`
    INSERT INTO work_item_checklist_items (id, work_item_id, title, sort_order, created_at, updated_at)
    VALUES
        ('item-c', 'change-a', 'Gleich', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
        ('item-a', 'change-a', 'Gleich', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00');
    UPDATE work_item_checklist_items SET updated_at = '2026-01-02 00:00:00' WHERE id = 'item-c';
  `),
  call("WorkItemChecklistRepository.findByWorkItemId", ({ database }) =>
    new WorkItemChecklistRepository(database).findByWorkItemId("change-a"),
  ),
  refused("WorkItemChecklistRepository.insert", ({ database }) =>
    new WorkItemChecklistRepository(database).insert({
      id: "item-x",
      workItemId: "change-a",
      title: MISSING_TEXT,
    }),
  ),
  call("WorkItemChecklistRevisionRepository.current", ({ database }) =>
    new WorkItemChecklistRevisionRepository(database).current("change-a", "h1"),
  ),
  call("WorkItemChecklistRevisionRepository.current", ({ database }) =>
    new WorkItemChecklistRevisionRepository(database).current("change-a", "h1"),
  ),
  call("WorkItemChecklistRevisionRepository.current", ({ database }) =>
    new WorkItemChecklistRevisionRepository(database).current("change-a", "h2"),
  ),
  call("WorkItemChecklistRevisionRepository.advance", ({ database }) =>
    new WorkItemChecklistRevisionRepository(database).advance("change-a", "h2"),
  ),
  call("WorkItemChecklistRevisionRepository.advance", ({ database }) =>
    new WorkItemChecklistRevisionRepository(database).advance("change-b", "h1"),
  ),
  refused("WorkItemChecklistRevisionRepository.advance", ({ database }) =>
    new WorkItemChecklistRevisionRepository(database).advance(
      "change-a",
      MISSING_TEXT,
    ),
  ),
  prepare(`
    INSERT INTO work_item_links (id, work_item_id, linked_work_item_id, link_type, created_at)
    VALUES
        ('link-z', 'change-b', 'change-a', 'relates_to', '2026-01-02 00:00:00'),
        ('link-y', 'change-a', 'change-root', 'relates_to', '2026-01-01 00:00:00'),
        ('link-x', 'change-a', 'change-leaf', 'relates_to', '2026-01-01 00:00:00');
    UPDATE work_item_links SET link_type = 'relates_to' WHERE id = 'link-y';
  `),
  call("WorkItemLinkRepository.findByWorkItemId", ({ database }) =>
    new WorkItemLinkRepository(database).findByWorkItemId("change-a"),
  ),
  call("WorkItemLinkRepository.findByWorkItemId", ({ database }) =>
    new WorkItemLinkRepository(database).findByWorkItemId("change-a", {
      departmentIds: ["department-a"],
      projectIds: [PROJECT],
    }),
  ),
  call("WorkItemLinkRepository.insert", ({ database }) =>
    new WorkItemLinkRepository(database).insert({
      id: "link-doppelt",
      workItemId: "change-b",
      linkedWorkItemId: "change-a",
      linkType: "relates_to",
    }),
  ),
  stored("SELECT id FROM work_item_links ORDER BY id;"),
  refused("WorkItemLinkRepository.insert", ({ database }) =>
    new WorkItemLinkRepository(database).insert({
      id: "link-z",
      workItemId: "change-leaf",
      linkedWorkItemId: "change-a",
      linkType: "relates_to",
    }),
  ),
];

const ATTACHMENT_STEPS: readonly RepositoryStep[] = [
  call("WorkItemAttachmentRepository.insert", async ({ database }) => {
    const { id, createdAt } = await new WorkItemAttachmentRepository(
      database,
    ).insert(ATTACHMENT, "attachment-b", { requiresActiveTicket: true });
    return { id, createdAt };
  }),
  call("WorkItemAttachmentRepository.insert", ({ database }) =>
    new WorkItemAttachmentRepository(database).insert(
      { ...ATTACHMENT, storageName: "a-datei", uploadedBy: "user-weg" },
      "attachment-a",
    ),
  ),
  refused("WorkItemAttachmentRepository.insert", ({ database }) =>
    new WorkItemAttachmentRepository(database).insert(
      ATTACHMENT,
      "attachment-a",
    ),
  ),
  refused("WorkItemAttachmentRepository.insert", ({ database }) =>
    new WorkItemAttachmentRepository(database).insert(
      { ...ATTACHMENT, workItemId: "nicht-da" },
      "attachment-c",
      { requiresActiveTicket: true },
    ),
  ),
  prepare(`
    UPDATE work_item_attachments SET created_at = '2026-01-01 00:00:00';
    UPDATE work_item_attachments SET kind = 'file' WHERE id = 'attachment-b';
  `),
  call("WorkItemAttachmentRepository.listAll", ({ database }) =>
    new WorkItemAttachmentRepository(database).listAll(),
  ),
  call("WorkItemAttachmentRepository.listByWorkItem", ({ database }) =>
    new WorkItemAttachmentRepository(database).listByWorkItem("change-a"),
  ),
  call("WorkItemAttachmentRepository.find", ({ database }) =>
    new WorkItemAttachmentRepository(database).find("attachment-a"),
  ),
  call("WorkItemAttachmentRepository.find", ({ database }) =>
    new WorkItemAttachmentRepository(database).find("nicht-da"),
  ),
  call("WorkItemAttachmentRepository.findStorageNames", ({ database }) =>
    new WorkItemAttachmentRepository(database).findStorageNames(["change-a"]),
  ),
  call("WorkItemAttachmentRepository.findStorageNames", ({ database }) =>
    new WorkItemAttachmentRepository(database).findStorageNames([]),
  ),
  call("WorkItemAttachmentRepository.listStorageNames", ({ database }) =>
    new WorkItemAttachmentRepository(database).listStorageNames(),
  ),
  call("TicketAssetMigrationRepository.attachments", ({ database }) =>
    new TicketAssetMigrationRepository(database).attachments(),
  ),
  // The check runs as a superuser, so CHECKPOINT would pass here and fail for Pages.
  call("TicketAssetMigrationRepository.checkpoint", async ({ database }) => {
    const statements: string[] = [];
    const counting = new Proxy(database, {
      get: (target, property): unknown =>
        property === "execute"
          ? (statement: string) => statements.push(statement)
          : Reflect.get(target, property),
    });
    await new TicketAssetMigrationRepository(counting).checkpoint();
    return statements.length === 0;
  }),
  refused("TicketAssetMigrationRepository.relocate", ({ database }) =>
    new TicketAssetMigrationRepository(database).relocate([
      {
        id: "attachment-a",
        storageName: "verschoben",
        contentType: "text/plain",
        kind: "file",
      },
      {
        id: "attachment-b",
        storageName: MISSING_TEXT,
        contentType: "text/plain",
        kind: "file",
      },
    ]),
  ),
  stored("SELECT id, storage_name FROM work_item_attachments ORDER BY id;"),
  call("TicketAssetMigrationRepository.relocate", ({ database }) =>
    new TicketAssetMigrationRepository(database).relocate([
      {
        id: "attachment-a",
        storageName: "verschoben",
        contentType: "image/png",
        kind: "media",
      },
    ]),
  ),
  call("WorkItemAttachmentRepository.updateStorage", ({ database }) =>
    new WorkItemAttachmentRepository(database).updateStorage({
      id: "attachment-b",
      storageName: "m-datei",
      contentType: "text/plain",
      kind: "file",
    }),
  ),
  call("WorkItemAttachmentRepository.listStorageNames", ({ database }) =>
    new WorkItemAttachmentRepository(database).listStorageNames(),
  ),
  call("WorkItemAttachmentRepository.delete", ({ database }) =>
    new WorkItemAttachmentRepository(database).delete("attachment-b"),
  ),
  call("TicketAssetAuditRepository.tickets", ({ database }) =>
    new TicketAssetAuditRepository(database).tickets(),
  ),
  refusedWithoutTable(
    "TicketAssetAuditRepository.tickets",
    "work_items",
    (transaction) => new TicketAssetAuditRepository(transaction).tickets(),
  ),
];

const TEMPLATE_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO labels (id, name, color)
    VALUES ('label-b', 'alpha', '#000000'), ('label-a', 'BETA', '#000000');
  `),
  call("WorkItemTemplateRepository.save", ({ database }) =>
    new WorkItemTemplateRepository(database).save(TEMPLATE),
  ),
  call("WorkItemTemplateRepository.save", ({ database }) =>
    new WorkItemTemplateRepository(database).save({
      ...TEMPLATE,
      id: "template-a",
      name: "Bericht",
      scope: "private",
      departmentIds: [],
      projectIds: [],
      labelIds: [],
      checklist: [],
    }),
  ),
  call("WorkItemTemplateRepository.findAll", ({ database }) =>
    new WorkItemTemplateRepository(database).findAll(),
  ),
  call("WorkItemTemplateRepository.save", ({ database }) =>
    new WorkItemTemplateRepository(database).save({
      ...TEMPLATE,
      name: "Geändert",
      labelIds: ["label-a"],
    }),
  ),
  call("WorkItemTemplateRepository.findById", ({ database }) =>
    new WorkItemTemplateRepository(database).findById("template-b"),
  ),
  call("WorkItemTemplateRepository.findById", ({ database }) =>
    new WorkItemTemplateRepository(database).findById("nicht-da"),
  ),
  refused("WorkItemTemplateRepository.save", ({ database }) =>
    new WorkItemTemplateRepository(database).save({
      ...TEMPLATE,
      checklist: ["Bleibt nicht", MISSING_TEXT],
    }),
  ),
  call("WorkItemTemplateRepository.findById", ({ database }) =>
    new WorkItemTemplateRepository(database).findById("template-b"),
  ),
  call("WorkItemTemplateRepository.delete", ({ database }) =>
    new WorkItemTemplateRepository(database).delete("template-a"),
  ),
  call("WorkItemTemplateRepository.delete", ({ database }) =>
    new WorkItemTemplateRepository(database).delete("template-b"),
  ),
  stored("SELECT COUNT(*) FROM work_item_template_labels;"),
  prepare("DELETE FROM labels;"),
  call("WorkItemTreeRepository.setExpanded", ({ database }) =>
    new WorkItemTreeRepository(database).setExpanded("user-admin", "z", true),
  ),
  call("WorkItemTreeRepository.setExpanded", ({ database }) =>
    new WorkItemTreeRepository(database).setExpanded("user-admin", "a", true),
  ),
  call("WorkItemTreeRepository.setExpanded", ({ database }) =>
    new WorkItemTreeRepository(database).setExpanded("user-admin", "a", true),
  ),
  call("WorkItemTreeRepository.findExpandedKeys", ({ database }) =>
    new WorkItemTreeRepository(database).findExpandedKeys("user-admin"),
  ),
  call("WorkItemTreeRepository.countExpanded", ({ database }) =>
    new WorkItemTreeRepository(database).countExpanded("user-admin"),
  ),
  call("WorkItemTreeRepository.setExpanded", ({ database }) =>
    new WorkItemTreeRepository(database).setExpanded("user-admin", "a", false),
  ),
  refused("WorkItemTreeRepository.setExpanded", ({ database }) =>
    new WorkItemTreeRepository(database).setExpanded(
      "user-admin",
      MISSING_TEXT,
      true,
    ),
  ),
  prepare("DELETE FROM work_item_tree_expansions;"),
];

const LIFECYCLE_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO work_items (id, project_id, key, number, type, parent_id, title, status_id, created_by, archived_at)
    VALUES ('change-old', 'project-a', 'CHG-5', 5, 'task', 'change-root', 'Archiviert', 'status-todo', 'user-admin', '2026-02-01 00:00:00');
  `),
  call("WorkItemLifecycleRepository.findSubtreeIds", ({ database }) =>
    new WorkItemLifecycleRepository(database).findSubtreeIds("change-root"),
  ),
  call("WorkItemLifecycleRepository.findSubtreeIds", ({ database }) =>
    new WorkItemLifecycleRepository(database).findSubtreeIds("change-root", {
      departmentIds: ["department-a"],
    }),
  ),
  call("WorkItemLifecycleRepository.countDescendants", ({ database }) =>
    new WorkItemLifecycleRepository(database).countDescendants("change-root"),
  ),
  call("WorkItemLifecycleRepository.findSubtreeStorageNames", ({ database }) =>
    new WorkItemLifecycleRepository(database).findSubtreeStorageNames(
      "change-root",
    ),
  ),
  call("WorkItemLifecycleRepository.archiveMany", ({ database }) =>
    new WorkItemLifecycleRepository(database).archiveMany([]),
  ),
  call("WorkItemLifecycleRepository.detachChildren", ({ database }) =>
    new WorkItemLifecycleRepository(database).detachChildren(
      "change-root",
      "all",
    ),
  ),
  call("WorkItemProjectMoveRepository.moveSubtreeIfCurrent", ({ database }) =>
    new WorkItemProjectMoveRepository(database).moveSubtreeIfCurrent(
      "change-root",
      [],
    ),
  ),
  stored(
    "SELECT id, parent_id FROM work_items WHERE key LIKE 'CHG-%' ORDER BY id;",
  ),
  refused("WorkItemProjectMoveRepository.moveToProject", ({ database }) =>
    new WorkItemProjectMoveRepository(database).moveToProject("change-a", {
      projectId: "project-b",
      key: MISSING_TEXT,
      number: 1,
      parentId: null,
      milestoneId: null,
      assigneeId: null,
    }),
  ),
  refusedWithoutTable(
    "WorkItemLifecycleRepository.deleteSubtree",
    "work_item_tree_expansions",
    async (transaction) => {
      await new WorkItemLifecycleRepository(
        agentTransactionScope(transaction),
      ).deleteSubtree("change-a");
    },
  ),
  call("WorkItemQueryRepository.findById", ({ database }) =>
    new WorkItemQueryRepository(database).findById("change-a"),
  ),
  call("WorkItemLifecycleRepository.deleteSubtree", ({ database }) =>
    new WorkItemLifecycleRepository(database).deleteSubtree("change-a"),
  ),
  call("WorkItemLifecycleRepository.deleteSubtree", ({ database }) =>
    new WorkItemLifecycleRepository(database).deleteSubtree("nicht-da"),
  ),
  stored("SELECT COUNT(*) FROM work_item_checklist_items;"),
  prepare(`
    DELETE FROM work_item_checklist_revisions;
    DELETE FROM work_item_history;
    DELETE FROM work_item_links;
    DELETE FROM work_item_attachments;
    DELETE FROM work_item_checklist_items;
    DELETE FROM work_items WHERE project_id IN ('project-a', 'project-b');
  `),
];

/** Conditional changes, the rows below a ticket, its files and its templates. */
export const TICKET_CHANGE_FLOW: RepositoryFlow = {
  title: "ticket changes",
  steps: [
    ...WRITE_STEPS,
    ...KEY_STEPS,
    ...CHILD_ROW_STEPS,
    ...ATTACHMENT_STEPS,
    ...TEMPLATE_STEPS,
    ...LIFECYCLE_STEPS,
  ],
};
