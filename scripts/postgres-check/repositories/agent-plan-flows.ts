import {
  AgentPlanRepository,
  requirePlanRevision,
} from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanTemplateRepository } from "@/backend/database/repositories/agent/AgentPlanTemplateRepository";
import { AgentPlanWorkspaceRepository } from "@/backend/database/repositories/agent/AgentPlanWorkspaceRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentProfileStore } from "@/backend/database/repositories/agent/AgentProfileStore";
import { AgentWorkspaceReferencesRepository } from "@/backend/database/repositories/agent/AgentWorkspaceReferencesRepository";
import { AgentWorkspaceRepository } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";

import {
  AGENT_PROFILE,
  OTHER_USER,
  OWNER,
  planFixture,
  profileFixture,
  PROJECT,
  WORKSPACE,
} from "./plan-fixtures";
import {
  call,
  prepare,
  refused,
  refusedWithoutTable,
  reversedInPostgres,
  stored,
} from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { AgentPlanTemplateNode } from "@/definition/AgentPlanNodeTemplate";

const PARAMETER_NODE: AgentPlanTemplateNode = {
  id: "template-node",
  type: "parameter",
  name: "repository",
  format: "string",
  value: { type: "workspace", workspaceId: WORKSPACE },
  x: 0,
  y: 0,
};

function plans({ database }: RepositoryWorld): AgentPlanRepository {
  return new AgentPlanRepository(database);
}

function templates({ database }: RepositoryWorld): AgentPlanTemplateRepository {
  return new AgentPlanTemplateRepository(database);
}

/** The workspace and the agent every plan of these flows refers to. */
export const PLAN_WORLD_FLOW: RepositoryFlow = {
  title: "plan world",
  steps: [
    call("AgentWorkspaceRepository.save", ({ database }) =>
      new AgentWorkspaceRepository(database).save(
        {
          id: WORKSPACE,
          name: "Arbeitskopie",
          path: "/srv/plans",
          directoryIdentity: "identity-plans",
          projectId: PROJECT,
          registeredBy: OWNER,
          revision: 1,
        },
        true,
      ),
    ),
    call("AgentProfileRepository.save", ({ database }) =>
      new AgentProfileRepository(database).save(profileFixture(AGENT_PROFILE)),
    ),
  ],
};

/** Saving and reading plans, with names per team and the sharing of legacy plans. */
export const PLAN_FLOW: RepositoryFlow = {
  title: "agent plans",
  steps: [
    call("AgentPlanRepository.save", (world) =>
      plans(world).save(planFixture("plan-b", { name: "beta" }), true),
    ),
    call("AgentPlanRepository.save", (world) =>
      plans(world).save(
        planFixture("plan-a", {
          name: "Alpha",
          sharing: {
            isGlobal: false,
            targets: [{ kind: "department", targetId: "department-plans" }],
            operator: "or",
          },
          departmentId: "department-plans",
        }),
        true,
        undefined,
        OWNER,
      ),
    ),
    call("AgentPlanRepository.save", (world) =>
      plans(world).save(planFixture("plan-c", { name: "ALPHA" }), true),
    ),
    reversedInPostgres("agent_plans"),
    call("AgentPlanRepository.list", (world) => plans(world).list()),
    call("AgentPlanRepository.listings", (world) => plans(world).listings()),
    call("AgentPlanRepository.find", (world) => plans(world).find("plan-a")),
    call("AgentPlanRepository.find", (world) =>
      plans(world).find("plan-missing"),
    ),
    stored(
      "SELECT updated_by, updated_at IS NULL, revision, name_key, department_id FROM agent_plans WHERE id LIKE 'plan-_' ORDER BY id;",
    ),
    call("AgentPlanRepository.save", (world) =>
      plans(world).save(planFixture("plan-b", { name: "Beta neu" }), false),
    ),
    call("AgentPlanRepository.save", (world) =>
      plans(world).save(
        planFixture("plan-b", { name: "Beta neu", revision: 2 }),
        false,
        undefined,
        OTHER_USER,
      ),
    ),
    stored(
      "SELECT updated_by, updated_at IS NULL, revision, name FROM agent_plans WHERE id = 'plan-b';",
    ),
    refused("AgentPlanRepository.save", (world) =>
      plans(world).save(planFixture("plan-b", { revision: 1 }), false),
    ),
    refused("AgentPlanRepository.save", (world) =>
      plans(world).save(planFixture("plan-a", { revision: 1 }), true),
    ),
    refused("AgentPlanRepository.save", (world) =>
      plans(world).save(
        planFixture("plan-d", { workspaceId: "workspace-missing" }),
        true,
      ),
    ),
    refused("AgentPlanRepository.save", (world) =>
      plans(world).save(
        planFixture("plan-d", { name: "Beta neu", departmentId: null }),
        true,
        async () => {
          throw new Error("The flow ends this journal.");
        },
      ),
    ),
    call("AgentPlanRepository.save", (world) =>
      plans(world).save(
        planFixture("plan-e", {
          name: "Alpha",
          departmentId: "department-other",
        }),
        true,
      ),
    ),
    refused("AgentPlanRepository.save", (world) =>
      plans(world).save(
        planFixture("plan-f", {
          name: "Alpha",
          departmentId: "department-other",
        }),
        true,
      ),
    ),
    call("AgentPlanRepository.requireCloneSource", (world) =>
      plans(world).requireCloneSource("plan-c", 1),
    ),
    refused("AgentPlanRepository.requireCloneSource", (world) =>
      plans(world).requireCloneSource("plan-c", 2),
    ),
    call("requirePlanRevision", ({ database }) =>
      requirePlanRevision(database, "plan-c", 1),
    ),
    refused("requirePlanRevision", ({ database }) =>
      requirePlanRevision(database, "plan-c", 9),
    ),
    call("AgentPlanRepository.listLegacyShareCandidates", (world) =>
      plans(world).listLegacyShareCandidates(),
    ),
    prepare(`
      UPDATE agent_plans
      SET legacy_share_pending = true
      WHERE id IN ('plan-b', 'plan-c');
    `),
    reversedInPostgres("agent_plans"),
    call("AgentPlanRepository.listLegacyShareCandidates", (world) =>
      plans(world).listLegacyShareCandidates(),
    ),
    call("AgentPlanRepository.shareLegacyPlan", (world) =>
      plans(world).shareLegacyPlan("plan-c", "department-other"),
    ),
    stored(
      "SELECT department_id, legacy_share_pending FROM agent_plans WHERE id = 'plan-c';",
    ),
    call("AgentPlanRepository.shareLegacyPlan", (world) =>
      plans(world).shareLegacyPlan("plan-missing", "department-other"),
    ),
    prepare("UPDATE agent_plans SET name = 'Alpha' WHERE id = 'plan-b';"),
    call("AgentPlanRepository.releaseLegacyShare", (world) =>
      plans(world).releaseLegacyShare("plan-missing"),
    ),
    prepare(
      "INSERT INTO agent_plan_runs (id, plan_id, user_id, project_id, workspace_id, started_at, status, view_json, snapshot_json) VALUES ('run-active', 'plan-e', 'user-plan-owner', 'project-plans', 'workspace-plans', '2026-03-01', 'running', '{}', '{}');",
    ),
    refused("AgentPlanRepository.remove", (world) =>
      plans(world).remove("plan-e", OWNER),
    ),
    refused("AgentPlanRepository.remove", (world) =>
      plans(world).remove("plan-e", OTHER_USER),
    ),
    prepare("DELETE FROM agent_plan_runs WHERE id = 'run-active';"),
    refused("AgentPlanRepository.remove", (world) =>
      plans(world).remove("plan-e", OWNER, {
        revision: 7,
        journal: () => Promise.resolve(),
      }),
    ),
    call("AgentPlanRepository.remove", (world) =>
      plans(world).remove("plan-e", OWNER, {
        revision: 1,
        journal: () => Promise.resolve(),
      }),
    ),
    call("AgentPlanRepository.shareLegacyPlan", (world) =>
      plans(world).shareLegacyPlan("plan-b", "department-other"),
    ),
    stored(
      "SELECT department_id, legacy_share_pending, name_key FROM agent_plans WHERE id = 'plan-b';",
    ),
    call("AgentPlanRepository.releaseLegacyShare", (world) =>
      plans(world).releaseLegacyShare("plan-b"),
    ),
    call("AgentPlanRepository.remove", (world) =>
      plans(world).remove("plan-a", OWNER),
    ),
    call("AgentPlanRepository.list", (world) => plans(world).list()),
  ],
};

/**
 * What the plan listing reads from a document, with a U+0000 in a text.
 *
 * @remarks
 * JSON.stringify writes it as an escape, which PostgreSQL stores but refuses to
 * read as JSON. One such plan must not take the list with it.
 */
export const PLAN_DOCUMENT_FLOW: RepositoryFlow = {
  title: "plan documents",
  steps: [
    prepare(
      `
      INSERT INTO agent_plans (id, owner_id, project_id, workspace_id, name, name_key, usage, plan_json)
      VALUES
          ('document-1', 'user-plan-owner', 'project-documents', 'w', 'Dokument 1', 'dokument 1', 'private', $with_escape),
          ('document-2', 'user-plan-owner', 'project-documents', 'w', 'Dokument 2', 'dokument 2', 'private', $without_sharing),
          ('document-3', 'user-plan-owner', 'project-documents', 'w', 'Dokument 3', 'dokument 3', 'private', $null_sharing);
    `,
      {
        with_escape: JSON.stringify({
          note: "a\u0000b",
          sharing: {
            isGlobal: false,
            operator: "or",
            targets: [{ kind: "group", targetId: "group-plans" }],
          },
        }),
        without_sharing: JSON.stringify({ note: "\\u0000" }),
        null_sharing: '{"sharing":null}',
      },
    ),
    call("AgentPlanRepository.listings", async ({ database }) =>
      (await new AgentPlanRepository(database).listings()).filter((plan) =>
        plan.id.startsWith("document-"),
      ),
    ),
    prepare(
      `
      INSERT INTO agent_plans (id, owner_id, project_id, workspace_id, name, name_key, usage, plan_json)
      VALUES ('document-uses', 'user-plan-owner', 'project-documents', 'w', 'Verwendet', 'verwendet', 'private', $plan);
    `,
      {
        plan: JSON.stringify({
          note: "a\u0000b",
          workspaceId: "workspace-document",
          nodes: [
            {
              type: "agent",
              agentId: "profile-document",
              instruction: "\u0000",
            },
          ],
        }),
      },
    ),
    call("AgentProfileStore.usages", ({ database }) =>
      new AgentProfileStore(database).usages(AGENT_PROFILE),
    ),
    stored(`
      SELECT DISTINCT plans.id
      FROM agent_plans AS plans,
          json_tree(plans.plan_json, '$.nodes') AS node
      WHERE json_extract_string(node.value, '$.agentId') = 'profile-document';
    `),
    call("AgentWorkspaceReferencesRepository.usages", ({ database }) =>
      new AgentWorkspaceReferencesRepository(database).usages(
        "workspace-document",
      ),
    ),
    prepare("DELETE FROM agent_plans WHERE id LIKE 'document-%';"),
    prepare(`
      INSERT INTO agent_plans (id, owner_id, project_id, workspace_id, name, name_key, usage, plan_json)
      VALUES ('document-damaged', 'user-plan-owner', 'project-documents', 'w', 'Kaputt', 'kaputt', 'private', 'kein JSON');
    `),
    refused("AgentPlanRepository.listings", ({ database }) =>
      new AgentPlanRepository(database).listings(),
    ),
    prepare("DELETE FROM agent_plans WHERE id = 'document-damaged';"),
  ],
};

/** Documents as JSON.stringify writes them, each with what `$.a` and `$.a.b` read. */
const READABLE_DOCUMENTS = [
  '{"a":"x"}',
  '{"a":{"b":"y"}}',
  '{"a":{"b":{"c":1.5}}}',
  '{"a":7}',
  '{"a":true}',
  '{"a":null}',
  '{"a":[1,"zwei",{"b":3}]}',
  '{"other":"x"}',
  "[1]",
  '"text"',
  "5",
  "null",
  '{"a":"\\\\u0000"}',
  '{"a":"\\u00e4ü"}',
  '{"a":"q\\"r"}',
  '{"\\u0061":"escaped key"}',
];

/** Documents with a U+0000, which only the comparison of their text can read in both. */
const NUL_DOCUMENTS = [
  '{"b":"\\u0000","a":"x"}',
  '{"\\u0000":1,"a":"x"}',
  '{"a":"x","b":"\\\\\\u0000"}',
  '{"a":"\\u0000x"}',
  '{"a":"x\\u0000\\u0000y"}',
  '{"a":{"b":"\\u0000","id":"x"}}',
];

const DAMAGED_DOCUMENTS = [
  "",
  "  ",
  "kein JSON",
  '{"a":',
  '{"b":"\\ud800","a":"x"}',
];

const TREE_MATCHES = `
    SELECT COUNT(*)
    FROM json_tree($document) AS entry
    WHERE json_extract_string(entry.value, '$.id') = 'x'
`;

/** The two JSON functions on their own, with and without a path that exists. */
export const JSON_FUNCTION_FLOW: RepositoryFlow = {
  title: "json functions",
  steps: [
    ...READABLE_DOCUMENTS.flatMap((document) => [
      stored("SELECT json_extract_string($document, '$.a');", { document }),
      stored("SELECT json_extract_string($document, '$.a.b');", { document }),
    ]),
    ...NUL_DOCUMENTS.flatMap((document) => [
      stored("SELECT json_extract_string($document, '$.a') = 'x';", {
        document,
      }),
      stored("SELECT json_extract_string($document, '$.a.id') = 'x';", {
        document,
      }),
      stored("SELECT json_extract_string($document, '$.missing') IS NULL;", {
        document,
      }),
    ]),
    ...[
      '{"a":{"b":"\\u0000"}}',
      '{"a":["\\u0000",1],"c":"\\u0000"}',
      '{"a":{"b":"\\u0000","c":"<nul>"}}',
      '{"a":{"b":"\\\\u0000","c":"\\u0000"}}',
    ].map((document) =>
      stored("SELECT json_extract_string($document, '$.a');", { document }),
    ),
    ...DAMAGED_DOCUMENTS.flatMap((document) => [
      refused("json_extract_string", ({ database }) =>
        database.query("SELECT json_extract_string($document, '$.a');", {
          document,
        }),
      ),
      refused("json_tree", ({ database }) =>
        database.query(`${TREE_MATCHES};`, { document }),
      ),
    ]),
    stored("SELECT json_extract_string(CAST(NULL AS TEXT), '$.a');"),
    // The six characters of the escape are another text than the character it stands for.
    stored("SELECT json_extract_string($document, '$.a') = $text;", {
      document: '{"a":"\\u0000"}',
      text: "\\u0000",
    }),
    stored("SELECT json_extract_string($document, '$.a') = $text;", {
      document: '{"a":"\\\\u0000"}',
      text: "\\u0000",
    }),
    stored("SELECT json_extract_string($document, '$.a') = $text;", {
      document: '{"a":"b\\u0000c"}',
      text: "bc",
    }),
    ...[
      '{"id":"x"}',
      '{"a":{"id":"x"},"b":[{"id":"x"},{"c":[{"id":"x"}]}]}',
      '[{"id":"x"},{"id":"y"}]',
      '{"id":"y","a":[1,"x",null,true]}',
      "[]",
      "{}",
      "5",
      '"x"',
      "null",
      '{"b":"\\u0000","a":{"id":"x"}}',
      '[{"\\u0000":{"id":"x"}},{"id":"\\u0000"}]',
    ].flatMap((document) => [
      stored(`${TREE_MATCHES};`, { document }),
      stored(
        `
        SELECT COUNT(*)
        FROM json_tree($document, '$.a') AS entry
        WHERE json_extract_string(entry.value, '$.id') = 'x';
      `,
        { document },
      ),
      stored(
        `
        SELECT COUNT(*)
        FROM json_tree($document, '$.missing.path') AS entry;
      `,
        { document },
      ),
    ]),
    stored("SELECT COUNT(*) FROM json_tree($document) AS entry;", {
      document: '{"a":[{"b":1},2],"c":"x","d":{}}',
    }),
    stored("SELECT COUNT(*) FROM json_tree($document, '$.a') AS entry;", {
      document: '{"a":null}',
    }),
    stored("SELECT COUNT(*) FROM json_tree(CAST(NULL AS TEXT)) AS entry;"),
  ],
};

/** Personal and shared node templates. */
export const PLAN_TEMPLATE_FLOW: RepositoryFlow = {
  title: "plan templates",
  steps: [
    call("AgentPlanTemplateRepository.create", (world) =>
      templates(world).create({
        id: "template-b",
        ownerId: OWNER,
        name: "Beta",
        node: PARAMETER_NODE,
        team: null,
      }),
    ),
    call("AgentPlanTemplateRepository.create", (world) =>
      templates(world).create(
        {
          id: "template-a",
          ownerId: OTHER_USER,
          name: "alpha",
          node: PARAMETER_NODE,
          team: { projectId: PROJECT, departmentId: "department-a" },
        },
        () => Promise.resolve(),
      ),
    ),
    call("AgentPlanTemplateRepository.create", (world) =>
      templates(world).create({
        id: "template-c",
        ownerId: OWNER,
        name: "Alpha",
        node: PARAMETER_NODE,
        team: { projectId: PROJECT, departmentId: "department-b" },
      }),
    ),
    prepare(
      "UPDATE agent_plan_templates SET created_at = '2026-03-01 08:00:00' WHERE owner_id IN ('user-plan-owner', 'user-plan-other');",
    ),
    reversedInPostgres("agent_plan_templates"),
    call("AgentPlanTemplateRepository.list", (world) =>
      templates(world).list({
        ownerId: OWNER,
        projectId: PROJECT,
        departmentIds: ["department-a", "department-b"],
      }),
    ),
    call("AgentPlanTemplateRepository.list", (world) =>
      templates(world).list({
        ownerId: OWNER,
        projectId: null,
        departmentIds: ["department-a"],
      }),
    ),
    call("AgentPlanTemplateRepository.list", (world) =>
      templates(world).list({
        ownerId: "user-none",
        projectId: PROJECT,
        departmentIds: [],
      }),
    ),
    call("AgentPlanTemplateRepository.find", (world) =>
      templates(world).find(
        { ownerId: OWNER, projectId: PROJECT, departmentIds: ["department-a"] },
        "template-a",
      ),
    ),
    call("AgentPlanTemplateRepository.find", (world) =>
      templates(world).find(
        { ownerId: OWNER, projectId: null, departmentIds: [] },
        "template-a",
      ),
    ),
    refused("AgentPlanTemplateRepository.create", (world) =>
      templates(world).create({
        id: "template-d",
        ownerId: OWNER,
        name: " BETA ",
        node: PARAMETER_NODE,
        team: null,
      }),
    ),
    refused("AgentPlanTemplateRepository.create", (world) =>
      templates(world).create({
        id: "template-b",
        ownerId: "user-third",
        name: "Beta",
        node: PARAMETER_NODE,
        team: null,
      }),
    ),
    refused("AgentPlanTemplateRepository.create", (world) =>
      templates(world).create({
        id: "template-e",
        ownerId: OWNER,
        name: "Gamma",
        node: {
          ...PARAMETER_NODE,
          value: { type: "workspace", workspaceId: "workspace-missing" },
        },
        team: null,
      }),
    ),
    prepare(
      "UPDATE agent_plan_templates SET node_type = 'future' WHERE id = 'template-c';",
    ),
    call("AgentPlanTemplateRepository.find", (world) =>
      templates(world).find(
        { ownerId: OWNER, projectId: PROJECT, departmentIds: ["department-b"] },
        "template-c",
      ),
    ),
  ],
};

/** The identifiers of all registered directories. */
export const PLAN_WORKSPACE_FLOW: RepositoryFlow = {
  title: "plan workspaces",
  steps: [
    prepare(`
      INSERT INTO remote_workspaces (id, name, connection_id, path, project_id, registered_by)
      VALUES
          ('a-registered', 'Entfernt', 'connection-registered', '/srv/a', 'project-plans', 'user-plan-owner'),
          ('z-registered', 'Entfernt 2', 'connection-registered', '/srv/z', 'project-plans', 'user-plan-owner');
    `),
    reversedInPostgres("remote_workspaces"),
    call("AgentPlanWorkspaceRepository.registeredIds", ({ database }) =>
      new AgentPlanWorkspaceRepository(database).registeredIds(),
    ),
    refusedWithoutTable(
      "AgentPlanWorkspaceRepository.registeredIds",
      "remote_workspaces",
      (transaction) =>
        new AgentPlanWorkspaceRepository(transaction).registeredIds(),
    ),
    prepare("DELETE FROM remote_workspaces WHERE id LIKE '%-registered';"),
  ],
};
