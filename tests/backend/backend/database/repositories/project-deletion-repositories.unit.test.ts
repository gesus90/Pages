import { describe, expect, it, vi } from "vitest";

import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { ProjectLifecycleRepository } from "@/backend/database/repositories/project/ProjectLifecycleRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";

import { parseMigrationSchema } from "./migration-schema";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

type Rows = readonly DatabaseValue[][];
type Responses = readonly (readonly [RegExp, Rows])[];

interface Recorder {
  connection: DatabaseTransaction;
  parameters: Record<string, unknown>[];
  statements: string[];
}

interface RepositoryFixture {
  connection: DatabaseTransaction;
  repository: ProjectRepository;
}

const BOARD_FILTERS = JSON.stringify({
  view: "list",
  project: "p1",
  milestone: "milestone-1",
});

/** Answers the reads of the deletion by the table they name; every other read is empty. */
const RESPONSES: Responses = [
  [/FROM page_agent_run_records/, [["agent-1", "run-1"]]],
  [/FROM work_item_attachments/, [["ticket-file-1"], ["ticket-file-2"]]],
  [/FROM wiki_attachments/, [["wiki-file-1"]]],
  [/^SELECT id FROM milestones/, [["milestone-1"]]],
  [
    /FROM user_board_preferences/,
    [
      ["person-1", BOARD_FILTERS],
      ["person-2", JSON.stringify({ project: "other", milestone: "other" })],
      ["person-3", "this is not json"],
      ["person-4", "[]"],
      [
        "person-5",
        JSON.stringify({ milestone: "milestone-1", project: "all" }),
      ],
    ],
  ],
];

/** A mocked transaction that remembers every statement, whitespace folded. */
function recorder(responses: Responses = RESPONSES): Recorder {
  const statements: string[] = [];
  const parameters: Record<string, unknown>[] = [];
  const connection: DatabaseTransaction = {
    query: vi.fn<DatabaseTransaction["query"]>(async (statement) => {
      const folded = statement.replace(/\s+/g, " ").trim();
      return responses.find(([marker]) => marker.test(folded))?.[1] ?? [];
    }),
    execute: vi.fn<DatabaseTransaction["execute"]>(
      async (statement, values) => {
        statements.push(statement.replace(/\s+/g, " ").trim());
        parameters.push({ ...values });
      },
    ),
  };
  return { connection, parameters, statements };
}

/** Tables of people, groups, agents, templates and records that outlive a project. */
const SHARED_TABLES = [
  "users",
  "user_authorization",
  "departments",
  "department_members",
  "user_groups",
  "user_group_members",
  "labels",
  "work_item_templates",
  "agent_execution_profiles",
  "agent_connections",
  "roles",
  "role_permissions",
  "administration_activity",
  "agent_operation_keys",
  "sessions",
];

describe("ProjectLifecycleRepository.delete", () => {
  it("returns the files whose rows went, to be removed after the commit", async () => {
    const { connection } = recorder();
    await expect(
      new ProjectLifecycleRepository(connection).delete("p1"),
    ).resolves.toEqual({
      agentRunRecords: [{ agentId: "agent-1", runId: "run-1" }],
      ticketAttachments: ["ticket-file-1", "ticket-file-2"],
      wikiAttachments: ["wiki-file-1"],
    });
  });

  it("deletes for good: no archive step and no move to the trash", async () => {
    const { connection, statements } = recorder();
    await new ProjectLifecycleRepository(connection).delete("p1");
    for (const statement of statements) {
      expect(statement).not.toMatch(/archived_at|deleted_at|deleted_root_id/);
      expect(statement).not.toMatch(
        /^UPDATE (work_items|wiki_pages|milestones)/,
      );
    }
    expect(statements.at(-1)).toBe(
      "DELETE FROM projects WHERE id = $project_id;",
    );
  });

  it("binds every statement to the project and never interpolates its id", async () => {
    const { connection, parameters, statements } = recorder();
    await new ProjectLifecycleRepository(connection).delete("p1");
    statements.forEach((statement, index) => {
      expect(statement).not.toContain("p1");
      if (statement.includes("$project_id"))
        expect(parameters[index]).toEqual({ project_id: "p1" });
    });
  });

  it("clears the references to the project before the rows they select through go", async () => {
    const { connection, statements } = recorder();
    await new ProjectLifecycleRepository(connection).delete("p1");
    const position = (fragment: string): number =>
      statements.findIndex((statement) => statement.includes(fragment));
    const templates = position("DELETE FROM work_item_template_projects");
    const anchors = position("DELETE FROM wiki_page_anchors");
    const ticketLinks = position(
      "DELETE FROM wiki_page_links WHERE target_kind = 'ticket'",
    );
    const plans = position("DELETE FROM agent_plans");
    const milestones = position("DELETE FROM milestones WHERE project_id");
    const tickets = position("DELETE FROM work_items WHERE project_id");
    expect(
      Math.min(templates, anchors, ticketLinks, plans),
    ).toBeGreaterThanOrEqual(0);
    expect(Math.max(templates, anchors, ticketLinks)).toBeLessThan(plans);
    expect(plans).toBeLessThan(milestones);
    expect(milestones).toBeLessThan(tickets);
    expect(tickets).toBeLessThan(
      position("UPDATE projects SET parent_id = NULL"),
    );
  });

  it("only cuts the links of shared objects and keeps the objects", async () => {
    const { connection, statements } = recorder();
    await new ProjectLifecycleRepository(connection).delete("p1");
    for (const table of SHARED_TABLES)
      expect(statements.join("\n")).not.toMatch(
        new RegExp(`DELETE FROM ${table}\\b`),
      );
    expect(statements).toContain(
      "DELETE FROM work_item_template_projects WHERE project_id = $project_id;",
    );
    expect(statements).toContain(
      "UPDATE projects SET parent_id = NULL, updated_at = utc_now() WHERE parent_id = $project_id;",
    );
  });
});

describe("ProjectLifecycleRepository.delete leftovers", () => {
  it("lets saved board filters that name the project or its milestones show everything again", async () => {
    const { connection, parameters, statements } = recorder();
    await new ProjectLifecycleRepository(connection).delete("p1");
    const updates = statements.flatMap((statement, index) =>
      statement.startsWith("UPDATE user_board_preferences")
        ? [parameters[index]]
        : [],
    );
    expect(updates).toEqual([
      {
        preferences: JSON.stringify({
          view: "list",
          project: "all",
          milestone: "all",
        }),
        user_id: "person-1",
      },
      {
        preferences: JSON.stringify({ milestone: "all", project: "all" }),
        user_id: "person-5",
      },
    ]);
  });

  it("finds nothing left to delete when a lost response is repeated", async () => {
    const { connection, statements } = recorder([]);
    await expect(
      new ProjectLifecycleRepository(connection).delete("p1"),
    ).resolves.toEqual({
      agentRunRecords: [],
      ticketAttachments: [],
      wikiAttachments: [],
    });
    expect(
      statements.every((statement) => /^(DELETE|UPDATE) /.test(statement)),
    ).toBe(true);
    expect(
      statements.some((statement) => statement.startsWith("UPDATE user_board")),
    ).toBe(false);
  });
});

describe("every project relation of the schema is part of the deletion", () => {
  /** Columns through which a table hangs on a project, a ticket, a milestone, a page, a plan or a run. */
  const RELATION_COLUMNS = [
    "project_id",
    "work_item_id",
    "linked_work_item_id",
    "imported_work_item_id",
    "milestone_id",
    "initiative_id",
    "page_id",
    "plan_id",
    "plan_run_id",
    "run_id",
    "workspace_id",
  ];
  const schema = parseMigrationSchema(DATABASE_MIGRATIONS);

  it("reads the layout of the shipped migrations", () => {
    expect(schema.get("work_items")).toContain("project_id");
    expect(schema.get("wiki_pages")).toContain("project_id");
    expect(schema.get("agent_plan_runs")).toContain("workspace_id");
    expect(schema.get("work_item_labels")).toEqual([
      "work_item_id",
      "label_id",
      "assigned_at",
    ]);
    expect(schema.has("project_role_permissions")).toBe(false);
  });

  it("deletes from every table that refers to a project or to something that belongs to one", async () => {
    const { connection, statements } = recorder();
    await new ProjectLifecycleRepository(connection).delete("p1");
    const text = statements.join("\n");
    const related = [...schema]
      .filter(([, columns]) =>
        columns.some((column) => RELATION_COLUMNS.includes(column)),
      )
      .map(([table]) => table);
    // A table added by a later migration that points at a project, a ticket or
    // a plan has to be handled by the deletion, or this list names it.
    expect(
      related.filter(
        (table) => !new RegExp(`DELETE FROM ${table}\\b`).test(text),
      ),
    ).toEqual([]);
    expect(related.length).toBeGreaterThan(40);
  });

  it("leaves the tables of shared objects out of the deletion", () => {
    for (const table of SHARED_TABLES) expect(schema.has(table)).toBe(true);
  });
});

describe("ProjectRepository.describeDeletion", () => {
  function repositoryWith(responses: Responses): RepositoryFixture {
    const { connection } = recorder(responses);
    const repository = new ProjectRepository({
      ...connection,
      transaction: async (work) => work(connection),
    });
    return { connection, repository };
  }

  it("reports no project for an unknown identifier", async () => {
    const { repository } = repositoryWith([]);
    await expect(repository.describeDeletion("gone")).resolves.toBeNull();
  });

  it("names the project and counts every kind of data in a fixed order", async () => {
    const { repository } = repositoryWith([
      [/archived_at IS NOT NULL FROM projects/, [["Apollo", "active", 1]]],
      [/^SELECT COUNT\(\*\) FROM project_departments/, [[2n]]],
      [/^SELECT user_id FROM project_members/, [["person-1"], ["person-2"]]],
      [/^SELECT COUNT\(\*\) FROM work_items WHERE project_id/, [[7n]]],
      [/FROM user_board_preferences/, [["person-1", BOARD_FILTERS]]],
    ]);
    const details = await repository.describeDeletion("p1");
    expect(details?.memberIds).toEqual(["person-1", "person-2"]);
    expect(details?.scope.project).toMatchObject({
      id: "p1",
      name: "Apollo",
      status: "active",
      isArchived: true,
    });
    expect(details?.scope.counts.tickets).toBe(7);
    expect(details?.scope.counts.departmentAssignments).toBe(2);
    expect(Object.keys(details?.scope.counts ?? {})).toEqual([
      "tickets",
      "subtickets",
      "ticketAttachments",
      "ticketChecklistItems",
      "ticketLinks",
      "ticketHistoryEntries",
      "milestones",
      "milestoneDependencies",
      "wikiPages",
      "wikiComments",
      "wikiAttachments",
      "plans",
      "planRuns",
      "workspaces",
      "importRuns",
      "importSources",
      "members",
      "departmentAssignments",
      "goals",
      "events",
      "activityEntries",
      "githubRecords",
      "integrations",
      "templates",
    ]);
    expect(Object.keys(details?.scope.detached ?? {})).toEqual([
      "templateAssignments",
      "wikiAnchors",
      "wikiLinks",
      "boardPreferences",
    ]);
    expect(details?.scope.detached.boardPreferences).toBe(1);
  });

  it("reads only and never writes", async () => {
    const { connection, repository } = repositoryWith([
      [/archived_at IS NOT NULL FROM projects/, [["Apollo", "active", 0]]],
    ]);
    await repository.describeDeletion("p1");
    expect(connection.execute).not.toHaveBeenCalled();
  });
});
