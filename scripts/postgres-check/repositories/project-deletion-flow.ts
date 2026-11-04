import { deleteProjectAgentData } from "@/backend/database/repositories/project/ProjectAgentDeletion";
import { ProjectDeletionScopeRepository } from "@/backend/database/repositories/project/ProjectDeletionScopeRepository";
import { findReleasedBoardPreferences } from "@/backend/database/repositories/project/ProjectReferenceCleanup";
import { deleteProjectWiki } from "@/backend/database/repositories/project/ProjectWikiDeletion";
import { deleteProjectWorkItemData } from "@/backend/database/repositories/project/ProjectWorkItemDeletion";

import { call, prepare, refused, stored } from "./world";

import type { RepositoryFlow } from "./world";

const ATTACHMENT_COLUMNS = `
    file_name,
    content_type,
    kind,
    size,
    checksum,
    uploaded_by
`;

const ATTACHMENT_VALUES = "'datei', 'text/plain', 'file', 1, 'c', 'user-admin'";

/** Fills what a project owns through plain rows, so the deletion finds something in each area. */
const OWNED_ROWS = `
  INSERT INTO project_departments (project_id, department_id) VALUES ('project-gone', 'department-a');
  INSERT INTO project_goals (id, project_id, title) VALUES ('goal-gone', 'project-gone', 'Ziel');
  INSERT INTO project_tags (project_id, tag) VALUES ('project-gone', 'tag');
  INSERT INTO project_events (id, project_id, title, event_date) VALUES ('event-gone', 'project-gone', 'Termin', '2026-01-01');
  INSERT INTO project_activity (id, project_id, user_id, category, action, message)
  VALUES ('activity-gone', 'project-gone', 'user-admin', 'project', 'x', 'y');
  INSERT INTO project_integrations (project_id) VALUES ('project-gone');
  INSERT INTO project_templates (id, project_id, name, description, status)
  VALUES ('template-gone', 'project-gone', 'V', '', 'planned');
  INSERT INTO project_template_goals (template_id, position, title) VALUES ('template-gone', 0, 'Z');
  INSERT INTO project_template_tags (template_id, tag) VALUES ('template-gone', 't');
  INSERT INTO github_external_issues (id, project_id, issue_number, title, url)
  VALUES ('issue-gone', 'project-gone', 1, 'I', 'u');
  INSERT INTO github_pull_requests (id, project_id, number, title, url)
  VALUES ('pull-gone', 'project-gone', 1, 'P', 'u');
  INSERT INTO milestones (id, project_id, name) VALUES ('milestone-gone', 'project-gone', 'M');
  INSERT INTO milestones (id, project_id, name) VALUES ('milestone-other', 'project-other', 'M');
  INSERT INTO milestone_dependencies (id, project_id, source_id, target_id, link_type)
  VALUES ('dependency-gone', 'project-other', 'milestone-other', 'milestone-gone', 'blocks');
`;

const TICKET_ROWS = `
  INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by)
  VALUES
      ('item-gone', 'project-gone', 'gone-1', 1, 'epic', 'Epic', 'status-todo', 'user-admin'),
      ('item-other', 'project-other', 'OTHER-1', 1, 'task', 'Anderes', 'status-todo', 'user-admin');
  INSERT INTO work_items (id, project_id, key, number, type, parent_id, title, status_id, created_by)
  VALUES ('item-child', 'project-gone', 'gone-2', 2, 'task', 'item-gone', 'Kind', 'status-todo', 'user-admin');
  INSERT INTO work_item_checklist_items (id, work_item_id, title) VALUES ('check-gone', 'item-gone', 'C');
  INSERT INTO work_item_history (id, work_item_id, user_id, action) VALUES ('history-gone', 'item-gone', 'user-admin', 'x');
  INSERT INTO work_item_links (id, work_item_id, linked_work_item_id, link_type)
  VALUES ('link-gone', 'item-other', 'item-gone', 'relates_to');
  INSERT INTO work_item_attachments (id, work_item_id, storage_name, ${ATTACHMENT_COLUMNS})
  VALUES
      ('attachment-z', 'item-gone', 'z-datei', ${ATTACHMENT_VALUES}),
      ('attachment-a', 'item-gone', 'a-datei', ${ATTACHMENT_VALUES});
  UPDATE work_item_attachments SET size = 2 WHERE id = 'attachment-z';
`;

const WIKI_ROWS = `
  INSERT INTO wiki_pages (id, author_id, owner_id, title, scope, project_id)
  VALUES ('page-gone', 'user-admin', 'user-admin', 'Seite', 'project', 'project-gone');
  INSERT INTO wiki_pages (id, author_id, owner_id, title, scope)
  VALUES ('page-stays', 'user-admin', 'user-admin', 'Instanz', 'instance');
  INSERT INTO wiki_comments (id, page_id, author_id, body) VALUES ('comment-gone', 'page-gone', 'user-admin', 'K');
  INSERT INTO wiki_attachments (id, page_id, storage_name, ${ATTACHMENT_COLUMNS})
  VALUES ('wiki-attachment', 'page-gone', 'wiki-datei', ${ATTACHMENT_VALUES});
  INSERT INTO wiki_page_anchors (page_id, kind, target_id) VALUES ('page-stays', 'milestone', 'milestone-gone');
  INSERT INTO wiki_page_links (page_id, target_kind, target_id)
  VALUES
      ('page-stays', 'page', 'page-gone'),
      ('page-stays', 'ticket', 'GONE-1');
`;

const AGENT_ROWS = `
  INSERT INTO agent_workspaces (id, name, path, directory_identity, project_id, registered_by)
  VALUES ('workspace-gone', 'W', '/check/w', 'identity', 'project-gone', 'user-admin');
  INSERT INTO agent_plans (id, owner_id, project_id, workspace_id, name, usage, plan_json)
  VALUES ('plan-gone', 'user-admin', 'project-gone', 'workspace-gone', 'Plan', 'private', '{}');
  INSERT INTO agent_plan_runs (id, plan_id, user_id, project_id, workspace_id, started_at, status, view_json, snapshot_json)
  VALUES
      ('run-gone', 'plan-gone', 'user-admin', 'project-gone', 'workspace-gone', '2026-01-01 00:00:00', 'completed', '{}', '{}'),
      ('run-elsewhere', 'plan-gone', 'user-admin', 'project-other', 'workspace-gone', '2026-01-01 00:00:00', 'completed', '{}', '{}');
  INSERT INTO page_agent_run_records (agent_id, run_id, plan_run_id, user_id, started_at, finished_at, status, model, input, result)
  VALUES
      ('agent-b', 'record-b', 'run-gone', 'user-admin', 't', 't', 'succeeded', 'm', 'i', 'r'),
      ('agent-a', 'record-a', 'run-elsewhere', 'user-admin', 't', 't', 'succeeded', 'm', 'i', 'r');
  INSERT INTO agent_import_sources (project_id, source_key, target_kind, target_id, content_hash, target_revision, result_json, last_run_id, created_at, updated_at)
  VALUES ('project-gone', 'key', 'wiki', 't', 'h', 1, '{}', 'r', 1, 1);
`;

const COUNT_REMAINING = `
  SELECT
      (SELECT COUNT(*) FROM projects WHERE id = 'project-gone'),
      (SELECT COUNT(*) FROM project_members WHERE project_id = 'project-gone'),
      (SELECT COUNT(*) FROM project_goals WHERE project_id = 'project-gone'),
      (SELECT COUNT(*) FROM project_template_goals WHERE template_id = 'template-gone'),
      (SELECT COUNT(*) FROM work_items WHERE project_id = 'project-gone'),
      (SELECT COUNT(*) FROM work_item_links WHERE id = 'link-gone'),
      (SELECT COUNT(*) FROM work_items WHERE id = 'item-other'),
      (SELECT COUNT(*) FROM wiki_pages WHERE id = 'page-gone'),
      (SELECT COUNT(*) FROM wiki_pages WHERE id = 'page-stays'),
      (SELECT COUNT(*) FROM wiki_page_anchors),
      (SELECT COUNT(*) FROM wiki_page_links),
      (SELECT COUNT(*) FROM agent_plans WHERE id = 'plan-gone'),
      (SELECT COUNT(*) FROM agent_plan_runs WHERE plan_id = 'plan-gone'),
      (SELECT COUNT(*) FROM milestones WHERE id = 'milestone-other'),
      (SELECT COUNT(*) FROM milestone_dependencies);
`;

/** Permanent deletion of a project: preview, refusal, each part and the whole. */
export const PROJECT_DELETION_FLOW: RepositoryFlow = {
  title: "project deletion",
  steps: [
    call("ProjectRepository.describeDeletion", ({ projects }) =>
      projects.describeDeletion("nothing"),
    ),
    call("ProjectRepository.insert", ({ projects }) =>
      projects.insert({
        id: "project-gone",
        name: "Wird gelöscht",
        description: "",
        ownerId: "user-admin",
        placeholderColor: "#FCE3D3",
        status: "active",
      }),
    ),
    prepare(OWNED_ROWS),
    prepare(TICKET_ROWS),
    prepare(WIKI_ROWS),
    prepare(AGENT_ROWS),
    prepare(
      "UPDATE projects SET parent_id = 'project-gone' WHERE id = 'project-b';",
    ),
    call("UserBoardPreferencesRepository.upsert", ({ boards }) =>
      boards.upsert(
        "user-admin",
        '{"project":"project-gone","milestone":"milestone-gone"}',
      ),
    ),
    call("findReleasedBoardPreferences", ({ database }) =>
      findReleasedBoardPreferences(database, "project-gone"),
    ),
    call("ProjectRepository.describeDeletion", ({ projects }) =>
      projects.describeDeletion("project-gone"),
    ),
    // This repository only reads, so its failure is a table that cannot be read.
    refused("ProjectDeletionScopeRepository.count", ({ database }) =>
      database.transaction(async (transaction) => {
        await transaction.execute(
          "ALTER TABLE project_departments RENAME TO project_departments_hidden;",
        );
        await new ProjectDeletionScopeRepository(transaction).count(
          "project-gone",
        );
      }),
    ),
    stored(
      "SELECT COUNT(*) FROM project_departments WHERE project_id = 'project-gone';",
    ),
    prepare(`
      INSERT INTO acp_resource_leases (instance_id, user_id, provider, state, since, run_id)
      VALUES ('lease-1', 'user-admin', 'codex_cli', 'running', 't', 'run-gone');
    `),
    refused("deleteProjectAgentData", ({ projects }) =>
      projects.deletePermanently("project-gone"),
    ),
    stored("SELECT COUNT(*) FROM projects WHERE id = 'project-gone';"),
    stored("SELECT COUNT(*) FROM wiki_page_anchors;"),
    prepare("DELETE FROM acp_resource_leases;"),
    call("deleteProjectWiki", ({ database }) =>
      database
        .transaction(async (transaction) => {
          const files = await deleteProjectWiki(transaction, "project-gone");
          const records = await deleteProjectAgentData(
            transaction,
            "project-gone",
          );
          const attachments = await deleteProjectWorkItemData(
            transaction,
            "project-gone",
          );
          throw new Error(
            `Rolled back after ${JSON.stringify({ files, records, attachments })}`,
          );
        })
        .catch((error: unknown) => String(error)),
    ),
    call("deleteProjectWorkItemData", ({ projects }) =>
      projects.describeDeletion("project-gone"),
    ),
    call("clearProjectReferences", ({ projects }) =>
      projects.deletePermanently("project-gone"),
    ),
    stored(COUNT_REMAINING),
    stored("SELECT parent_id FROM projects WHERE id = 'project-b';"),
    call("UserBoardPreferencesRepository.findByUserId", ({ boards }) =>
      boards.findByUserId("user-admin"),
    ),
    call("ProjectRepository.deletePermanently", ({ projects }) =>
      projects.deletePermanently("project-gone"),
    ),
  ],
};
