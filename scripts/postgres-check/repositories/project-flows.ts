import { ProjectActivityRepository } from "@/backend/database/repositories/project/ProjectActivityRepository";

import { call, MISSING_TEXT, prepare, refused, stored } from "./world";

import type { RepositoryFlow, RepositoryStep } from "./world";

const PROJECT = {
  description: "Beschreibung",
  ownerId: "user-manager",
  placeholderColor: "#FCE3D3",
  status: "active",
} as const;

const PROJECT_UPDATE = {
  description: "",
  status: "paused",
  progress: 40,
} as const;

const EVENT = {
  description: "Termin",
  type: "general",
} as const;

const INTEGRATION = {
  repoUrl: "https://example.test/repo",
  tokenHash: "token-hash",
  tokenEncrypted: "token-cipher",
  syncIssues: true,
  syncStatus: false,
  syncComments: true,
  syncPullRequests: false,
  syncCommits: true,
  syncDirection: "push",
  syncIntervalMinutes: 15,
  isConnected: true,
  repoName: "repo",
  lastSyncAt: null,
} as const;

const failTransaction = (): never => {
  throw new Error("The flow ends this transaction.");
};

const CORE_STEPS: readonly RepositoryStep[] = [
  call("ProjectRepository.findAll", ({ projects }) => projects.findAll()),
  call("ProjectRepository.insert", ({ projects }) =>
    projects.insert({
      ...PROJECT,
      id: "project-b",
      name: "Änderung",
      departmentIds: ["department-z", "department-a", "department-z"],
    }),
  ),
  call("ProjectRepository.insert", ({ projects }) =>
    projects.insert({ ...PROJECT, id: "project-a", name: "Same" }),
  ),
  call("ProjectRepository.insert", ({ projects }) =>
    projects.insert({ ...PROJECT, id: "project-c", name: "Same" }),
  ),
  call("ProjectRepository.insert", ({ projects }) =>
    projects.insert({ ...PROJECT, id: "project-d", name: "zuletzt" }),
  ),
  refused("ProjectRepository.insert", ({ projects }) =>
    projects.insert({ ...PROJECT, id: "project-a", name: "Duplicate" }),
  ),
  refused("ProjectRepository.insert", ({ projects }) =>
    projects.insert({ ...PROJECT, id: "project-x", name: MISSING_TEXT }),
  ),
  stored("SELECT id FROM projects WHERE id = 'project-x';"),
  prepare("UPDATE projects SET updated_at = '2026-03-01 00:00:00';"),
  prepare(
    "UPDATE projects SET updated_at = '2026-04-01 00:00:00' WHERE id = 'project-d';",
  ),
  prepare("UPDATE projects SET description = NULL WHERE id = 'project-c';"),
  // An update moves a row in PostgreSQL only, which shows a sort without a unique last key.
  prepare("UPDATE projects SET notes = 'x' WHERE id = 'project-a';"),
  call("ProjectRepository.findAll", ({ projects }) => projects.findAll()),
  call("ProjectRepository.findActiveIds", ({ projects }) =>
    projects.findActiveIds(),
  ),
  call("ProjectRepository.findById", ({ projects }) =>
    projects.findById("project-b"),
  ),
  call("ProjectRepository.findById", ({ projects }) =>
    projects.findById("nothing"),
  ),
  call("ProjectRepository.findByMemberId", ({ projects }) =>
    projects.findByMemberId("user-manager"),
  ),
  call("ProjectRepository.findByMemberId", ({ projects }) =>
    projects.findByMemberId("user-admin"),
  ),
  call("ProjectRepository.findDepartments", ({ projects }) =>
    projects.findDepartments("project-b"),
  ),
  call("ProjectRepository.findDepartmentsByProjects", ({ projects }) =>
    projects.findDepartmentsByProjects([]),
  ),
  call("ProjectRepository.findDepartmentsByProjects", ({ projects }) =>
    projects.findDepartmentsByProjects(["project-b", "project-a"]),
  ),
  call("ProjectRepository.setDepartments", ({ projects }) =>
    projects.setDepartments("project-a", ["department-a"]),
  ),
  call("ProjectRepository.findDepartments", ({ projects }) =>
    projects.findDepartments("project-a"),
  ),
  refused("ProjectRepository.setDepartments", ({ projects }) =>
    projects.setDepartments("project-a", [MISSING_TEXT]),
  ),
  // The event of an access change is an outbox row of kind and project (PAGE-236).
  call("ProjectRepository.appendEvent", async ({ projects, database }) => {
    await projects.appendEvent({
      type: "project.access.changed",
      id: "project-a",
    });
    const rows = await database.query(
      "SELECT kind, object_id, audience_project_id FROM pages_event_outbox ORDER BY position DESC LIMIT 1;",
    );
    return {
      isAsKnown:
        JSON.stringify(rows) ===
        JSON.stringify([["project.access.changed", "project-a", null]]),
    };
  }),
  refused("ProjectRepository.appendEvent", ({ projects }) =>
    projects.appendEvent({ type: "Project Access", id: "project-a" }),
  ),
  call("ProjectRepository.update", ({ projects }) =>
    projects.update("project-a", {
      ...PROJECT_UPDATE,
      name: "Same neu",
    }),
  ),
  refused("ProjectRepository.update", ({ projects }) =>
    projects.update("project-a", {
      ...PROJECT_UPDATE,
      name: "Same neu",
      progress: 101,
    }),
  ),
  call("ProjectRepository.updateDetails", ({ projects }) =>
    projects.updateDetails("project-a", {
      ...PROJECT_UPDATE,
      name: "Same Details",
      managerId: "user-admin",
      startDate: "2026-01-01",
      targetDate: null,
      notes: "Notiz mit 'Zeichen' und $name",
    }),
  ),
  call("ProjectRepository.findById", ({ projects }) =>
    projects.findById("project-a"),
  ),
  call("ProjectRepository.transaction", ({ projects }) =>
    projects.transaction(async (repository) => {
      await repository.setTags("project-a", ["tx"]);
      return repository.findTags("project-a");
    }),
  ),
  refused("ProjectRepository.transaction", ({ projects }) =>
    projects.transaction(async (repository) => {
      await repository.setTags("project-a", ["verworfen"]);
      failTransaction();
    }),
  ),
  call("ProjectRepository.findTags", ({ projects }) =>
    projects.findTags("project-a"),
  ),
  call("ProjectRepository.readTransaction", ({ projects }) =>
    projects.readTransaction((repository) => repository.findActiveIds()),
  ),
  refused("ProjectRepository.readTransaction", ({ projects }) =>
    projects.readTransaction((repository) =>
      repository.setTags("project-a", ["kein Lesen"]),
    ),
  ),
  call("ProjectRepository.authorization", ({ projects }) =>
    projects.authorization().snapshot(),
  ),
];

const MEMBER_STEPS: readonly RepositoryStep[] = [
  call("ProjectRepository.isMember", ({ projects }) =>
    projects.isMember("project-a", "user-manager"),
  ),
  call("ProjectRepository.isMember", ({ projects }) =>
    projects.isMember("project-a", "user-admin"),
  ),
  call("ProjectRepository.isProjectManager", ({ projects }) =>
    projects.isProjectManager("project-a", "user-manager"),
  ),
  call("ProjectRepository.findManagedProjectIds", ({ projects }) =>
    projects.findManagedProjectIds("user-manager"),
  ),
  call("ProjectRepository.addMember", ({ projects }) =>
    projects.addMember("project-a", "user-admin", "member"),
  ),
  call("ProjectRepository.addMember", ({ projects }) =>
    projects.addMember(
      "project-a",
      "user-same-name-a",
      "viewer",
      "2026-01-01 00:00:00",
    ),
  ),
  call("ProjectRepository.addMember", ({ projects }) =>
    projects.addMember("project-a", "user-same-name-b", "viewer"),
  ),
  call("ProjectRepository.addMember", ({ projects }) =>
    projects.addMember("project-a", "user-admin", "viewer"),
  ),
  refused("ProjectRepository.addMember", ({ projects }) =>
    projects.addMember("project-a", "user-admin", MISSING_TEXT as "member"),
  ),
  prepare(
    "UPDATE project_members SET joined_at = joined_at WHERE user_id = 'user-same-name-a';",
  ),
  prepare(
    "UPDATE users SET updated_at = updated_at WHERE id = 'user-same-name-a';",
  ),
  call("ProjectRepository.findMembers", ({ projects }) =>
    projects.findMembers("project-a"),
  ),
  call("ProjectRepository.updateMemberRole", ({ projects }) =>
    projects.updateMemberRole("project-a", "user-admin", "manager"),
  ),
  call("ProjectRepository.isProjectManager", ({ projects }) =>
    projects.isProjectManager("project-a", "user-admin"),
  ),
  call("ProjectRepository.removeMember", ({ projects }) =>
    projects.removeMember("project-a", "user-same-name-b"),
  ),
  call("ProjectRepository.findMembers", ({ projects }) =>
    projects.findMembers("project-a"),
  ),
];

const PART_STEPS: readonly RepositoryStep[] = [
  call("ProjectRepository.findIconByProjectId", ({ projects }) =>
    projects.findIconByProjectId("project-a"),
  ),
  call("ProjectRepository.upsertIcon", ({ projects }) =>
    projects.upsertIcon("project-a", {
      mimeType: "image/png",
      filename: "icon.png",
      data: Buffer.from([9, 8, 7]),
    }),
  ),
  call("ProjectRepository.upsertIcon", ({ projects }) =>
    projects.upsertIcon("project-a", {
      mimeType: "image/webp",
      filename: "icon.webp",
      data: Buffer.from([0, 255]),
    }),
  ),
  call("ProjectRepository.findIconByProjectId", ({ projects }) =>
    projects.findIconByProjectId("project-a"),
  ),
  refused("ProjectRepository.upsertIcon", ({ projects }) =>
    projects.upsertIcon("project-b", {
      mimeType: MISSING_TEXT,
      filename: "icon.png",
      data: Buffer.from([1]),
    }),
  ),
  call("ProjectRepository.findById", ({ projects }) =>
    projects.findById("project-a"),
  ),
  call("ProjectRepository.insertGoal", ({ projects }) =>
    projects.insertGoal({
      id: "goal-b",
      projectId: "project-a",
      title: "Zweites",
      position: 1,
    }),
  ),
  call("ProjectRepository.insertGoal", ({ projects }) =>
    projects.insertGoal({
      id: "goal-a",
      projectId: "project-a",
      title: "Gleiche Position",
      position: 1,
    }),
  ),
  call("ProjectRepository.insertGoal", ({ projects }) =>
    projects.insertGoal({
      id: "goal-c",
      projectId: "project-a",
      title: "Erstes",
      position: 0,
    }),
  ),
  refused("ProjectRepository.insertGoal", ({ projects }) =>
    projects.insertGoal({
      id: "goal-c",
      projectId: "project-a",
      title: "Doppelt",
      position: 0,
    }),
  ),
  prepare("UPDATE project_goals SET created_at = '2026-01-01 00:00:00';"),
  call("ProjectRepository.updateGoal", ({ projects }) =>
    projects.updateGoal("goal-b", "Zweites erledigt", true),
  ),
  call("ProjectRepository.findGoals", ({ projects }) =>
    projects.findGoals("project-a"),
  ),
  call("ProjectRepository.deleteGoal", ({ projects }) =>
    projects.deleteGoal("goal-c"),
  ),
  call("ProjectRepository.findGoals", ({ projects }) =>
    projects.findGoals("project-a"),
  ),
  call("ProjectRepository.setTags", ({ projects }) =>
    projects.setTags("project-a", ["Zebra", "apfel", "Äpfel", "apfel"]),
  ),
  refused("ProjectRepository.setTags", ({ projects }) =>
    projects.setTags("project-a", [MISSING_TEXT]),
  ),
  call("ProjectRepository.setTags", ({ projects }) =>
    projects.setTags("project-a", ["Zebra", "apfel", "Äpfel"]),
  ),
  call("ProjectRepository.findTags", ({ projects }) =>
    projects.findTags("project-a"),
  ),
  call("ProjectRepository.insertEvent", ({ projects }) =>
    projects.insertEvent({
      ...EVENT,
      id: "event-b",
      projectId: "project-a",
      title: "Mit Zeit",
      eventDate: "2026-05-01",
      eventTime: "09:00",
    }),
  ),
  call("ProjectRepository.insertEvent", ({ projects }) =>
    projects.insertEvent({
      ...EVENT,
      id: "event-c",
      projectId: "project-a",
      title: "Ohne Zeit",
      eventDate: "2026-05-01",
      eventTime: null,
    }),
  ),
  call("ProjectRepository.insertEvent", ({ projects }) =>
    projects.insertEvent({
      ...EVENT,
      id: "event-a",
      projectId: "project-a",
      title: "Ohne Zeit, gleicher Tag",
      eventDate: "2026-05-01",
      eventTime: null,
    }),
  ),
  refused("ProjectRepository.insertEvent", ({ projects }) =>
    projects.insertEvent({
      ...EVENT,
      id: "event-a",
      projectId: "project-a",
      title: "Doppelt",
      eventDate: "2026-05-01",
      eventTime: null,
    }),
  ),
  prepare("UPDATE project_events SET created_at = '2026-01-01 00:00:00';"),
  prepare("UPDATE project_events SET description = 'x' WHERE id = 'event-c';"),
  call("ProjectRepository.findEvents", ({ projects }) =>
    projects.findEvents("project-a"),
  ),
  call("ProjectRepository.updateEvent", ({ projects }) =>
    projects.updateEvent("event-b", {
      ...EVENT,
      title: "Verschoben",
      eventDate: "2026-04-01",
      eventTime: null,
    }),
  ),
  call("ProjectRepository.archiveEvent", ({ projects }) =>
    projects.archiveEvent("event-a"),
  ),
  call("ProjectRepository.findEvents", ({ projects }) =>
    projects.findEvents("project-a"),
  ),
];

const INTEGRATION_STEPS: readonly RepositoryStep[] = [
  call("ProjectRepository.findIntegration", ({ projects }) =>
    projects.findIntegration("project-a"),
  ),
  call("ProjectRepository.findTokenEncrypted", ({ projects }) =>
    projects.findTokenEncrypted("project-a"),
  ),
  call("ProjectRepository.findIntegrationsByProjectIds", ({ projects }) =>
    projects.findIntegrationsByProjectIds([]),
  ),
  call("ProjectRepository.upsertIntegration", ({ projects }) =>
    projects.upsertIntegration("project-a", INTEGRATION),
  ),
  call("ProjectRepository.upsertIntegration", ({ projects }) =>
    projects.upsertIntegration("project-c", {
      ...INTEGRATION,
      tokenHash: null,
      tokenEncrypted: null,
      syncDirection: "bidirectional",
      syncIntervalMinutes: 0,
      isConnected: false,
      repoName: null,
    }),
  ),
  call("ProjectRepository.upsertIntegration", ({ projects }) =>
    projects.upsertIntegration("project-c", {
      ...INTEGRATION,
      tokenHash: null,
      tokenEncrypted: null,
      syncDirection: "pull",
      syncIntervalMinutes: 30,
      isConnected: false,
    }),
  ),
  refused("ProjectRepository.upsertIntegration", ({ projects }) =>
    projects.upsertIntegration("project-b", {
      ...INTEGRATION,
      repoUrl: MISSING_TEXT,
    }),
  ),
  call("ProjectRepository.findIntegration", ({ projects }) =>
    projects.findIntegration("project-a"),
  ),
  call("ProjectRepository.findIntegrationsByProjectIds", ({ projects }) =>
    projects.findIntegrationsByProjectIds(["project-a", "project-c"]),
  ),
  call("ProjectRepository.findTokenEncrypted", ({ projects }) =>
    projects.findTokenEncrypted("project-a"),
  ),
  prepare(`
    INSERT INTO project_integrations (project_id, has_token, is_connected)
    VALUES ('project-b', 1, 1);
    UPDATE project_integrations SET repo_name = 'y' WHERE project_id = 'project-a';
  `),
  call("ProjectRepository.findDueSyncIntegrations", ({ projects }) =>
    projects.findDueSyncIntegrations("2026-06-01T00:00:00.000Z"),
  ),
  call("ProjectRepository.updateSyncSchedule", ({ projects }) =>
    projects.updateSyncSchedule("project-a", {
      lastSyncAt: "2026-05-01T00:00:00.000Z",
      nextSyncAt: "2026-07-01T00:00:00.000Z",
    }),
  ),
  call("ProjectRepository.findDueSyncIntegrations", ({ projects }) =>
    projects.findDueSyncIntegrations("2026-06-01T00:00:00.000Z"),
  ),
  call("ProjectRepository.deferNextSync", ({ projects }) =>
    projects.deferNextSync("project-a", "2026-05-15T00:00:00.000Z"),
  ),
  call("ProjectRepository.findDueSyncIntegrations", ({ projects }) =>
    projects.findDueSyncIntegrations("2026-06-01T00:00:00.000Z"),
  ),
  call("ProjectRepository.setIntegrationSyncEnabled", ({ projects }) =>
    projects.setIntegrationSyncEnabled("project-a", false),
  ),
  call("ProjectRepository.findDueSyncIntegrations", ({ projects }) =>
    projects.findDueSyncIntegrations("2026-06-01T00:00:00.000Z"),
  ),
  call("ProjectRepository.setIntegrationSyncEnabled", ({ projects }) =>
    projects.setIntegrationSyncEnabled("project-a", true),
  ),
  call("ProjectRepository.markIntegrationDisconnected", ({ projects }) =>
    projects.markIntegrationDisconnected("project-a", "other-cipher"),
  ),
  call("ProjectRepository.findIntegration", ({ projects }) =>
    projects.findIntegration("project-a"),
  ),
  call("ProjectRepository.markIntegrationDisconnected", ({ projects }) =>
    projects.markIntegrationDisconnected("project-a", "token-cipher"),
  ),
  call("ProjectRepository.findIntegration", ({ projects }) =>
    projects.findIntegration("project-a"),
  ),
  call("ProjectRepository.deleteIntegration", ({ projects }) =>
    projects.deleteIntegration("project-c"),
  ),
  call("ProjectRepository.findIntegration", ({ projects }) =>
    projects.findIntegration("project-c"),
  ),
];

const ACTIVITY_STEPS: readonly RepositoryStep[] = [
  call("ProjectRepository.insertActivity", ({ projects }) =>
    projects.insertActivity({
      id: "activity-b",
      projectId: "project-a",
      userId: "user-manager",
      category: "project",
      action: "updated",
      message: "Zweite",
    }),
  ),
  call("ProjectRepository.insertActivity", ({ projects }) =>
    projects.insertActivity({
      id: "activity-a",
      projectId: "project-a",
      userId: "user-gone",
      category: "project",
      action: "updated",
      message: "Erste, Person fehlt",
    }),
  ),
  call("ProjectActivityRepository.insert", ({ database }) =>
    new ProjectActivityRepository(database, "mcp").insert({
      id: "activity-c",
      projectId: "project-a",
      userId: "user-manager",
      category: "wiki",
      action: "page_created",
      message: "Wiki",
      wikiPageId: "page-of-project",
    }),
  ),
  call("ProjectRepository.insertActivity", ({ projects }) =>
    projects.insertActivity({
      id: "activity-d",
      projectId: "project-a",
      userId: "user-manager",
      category: "integrations",
      action: "github_conflict",
      message: "Konflikt ohne Ticket",
    }),
  ),
  refused("ProjectRepository.insertActivity", ({ projects }) =>
    projects.insertActivity({
      id: "activity-a",
      projectId: "project-a",
      userId: "user-manager",
      category: "project",
      action: "updated",
      message: "Doppelt",
    }),
  ),
  prepare("UPDATE project_activity SET created_at = '2026-01-01 00:00:00';"),
  prepare(`
    INSERT INTO wiki_pages (id, author_id, owner_id, title, scope, project_id)
    VALUES ('page-of-project', 'user-manager', 'user-manager', 'Seite', 'project', 'project-a');
  `),
  call("ProjectRepository.findActivity", ({ projects }) =>
    projects.findActivity("project-a"),
  ),
  call("ProjectRepository.findActivity", ({ projects }) =>
    projects.findActivity(
      "project-a",
      { departmentIds: null },
      {
        userId: "user-manager",
        isAdmin: false,
        departmentIds: [],
        projectIds: ["project-a"],
      },
    ),
  ),
  call("ProjectRepository.findActivity", ({ projects }) =>
    projects.findActivity(
      "project-a",
      { departmentIds: [] },
      {
        userId: "user-admin",
        isAdmin: true,
        departmentIds: ["department-a"],
        projectIds: [],
      },
    ),
  ),
];

const TEMPLATE_STEPS: readonly RepositoryStep[] = [
  call("ProjectRepository.findTemplates", ({ projects }) =>
    projects.findTemplates(),
  ),
  call("ProjectRepository.saveTemplate", ({ projects }) =>
    projects.saveTemplate({
      id: "template-b",
      projectId: "project-a",
      name: "Vorlage",
      description: "Erste",
      status: "planned",
      goals: ["Zweites Ziel", "Erstes Ziel"],
      tags: ["z", "a", "z"],
    }),
  ),
  call("ProjectRepository.saveTemplate", ({ projects }) =>
    projects.saveTemplate({
      id: "template-a",
      projectId: "project-b",
      name: "Vorlage",
      description: "Gleicher Name",
      status: "active",
      goals: [],
      tags: [],
    }),
  ),
  call("ProjectRepository.saveTemplate", ({ projects }) =>
    projects.saveTemplate({
      id: "template-b",
      projectId: "project-a",
      name: "Vorlage neu",
      description: "Ersetzt",
      status: "paused",
      goals: ["Einziges Ziel"],
      tags: ["neu"],
    }),
  ),
  refused("ProjectRepository.saveTemplate", ({ projects }) =>
    projects.saveTemplate({
      id: "template-c",
      projectId: "project-a",
      name: "Zweite Vorlage desselben Projekts",
      description: "Doppelt",
      status: "planned",
      goals: [],
      tags: [],
    }),
  ),
  call("ProjectRepository.findTemplates", ({ projects }) =>
    projects.findTemplates(),
  ),
];

const ARCHIVE_STEPS: readonly RepositoryStep[] = [
  call("ProjectRepository.findArchived", ({ projects }) =>
    projects.findArchived(),
  ),
  call("ProjectRepository.findArchivedById", ({ projects }) =>
    projects.findArchivedById("project-c"),
  ),
  call("ProjectRepository.archive", ({ projects }) =>
    projects.archive("project-c"),
  ),
  call("ProjectRepository.archive", ({ projects }) =>
    projects.archive("project-d"),
  ),
  prepare(`
    UPDATE projects
    SET
        archived_at = '2026-05-01 00:00:00',
        name = 'Same'
    WHERE id IN ('project-c', 'project-d');
  `),
  prepare("UPDATE projects SET notes = 'x' WHERE id = 'project-c';"),
  call("ProjectRepository.findArchived", ({ projects }) =>
    projects.findArchived(),
  ),
  call("ProjectRepository.findArchivedById", ({ projects }) =>
    projects.findArchivedById("project-c"),
  ),
  call("ProjectRepository.findById", ({ projects }) =>
    projects.findById("project-c"),
  ),
  call("ProjectRepository.findActiveIds", ({ projects }) =>
    projects.findActiveIds(),
  ),
];

/** Projekte: the project from its creation to its archive, with all its parts. */
export const PROJECT_FLOW: RepositoryFlow = {
  title: "projects",
  steps: [
    ...CORE_STEPS,
    ...MEMBER_STEPS,
    ...PART_STEPS,
    ...INTEGRATION_STEPS,
    ...ACTIVITY_STEPS,
    ...TEMPLATE_STEPS,
    ...ARCHIVE_STEPS,
  ],
};
