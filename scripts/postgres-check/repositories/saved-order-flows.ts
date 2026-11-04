import { strict as assert } from "node:assert";

import { CAPABILITY } from "@/definition/Authorization";

import { call, prepare, reversedInPostgres, stored } from "./world";

import type { RepositoryFlow, RepositoryStep, RepositoryWorld } from "./world";

const PROJECT = "project-order";
const NUL_PROJECT = "project-nul";
const NUL = "\u0000";

const NEW_PROJECT = {
  description: "",
  ownerId: "user-admin",
  placeholderColor: "#FCE3D3",
  status: "active",
} as const;

/** The accounts of the user flow, in the order they were created. */
const CREATED_ACCOUNTS = [
  "user-manager",
  "user-employee",
  "user-admin",
  "user-same-name-a",
  "user-same-name-b",
];

const NUL_USER = {
  id: "user-nul-text",
  username: "plain-name",
  displayName: `Na${NUL}me`,
  passwordHash: "hash-1",
  role: "employee",
} as const;

/** The one approved difference, taken out so that every other one still shows. */
export function withoutNul(input: unknown): unknown {
  if (typeof input === "string") return input.replaceAll(NUL, "");
  if (Array.isArray(input)) return input.map(withoutNul);
  if (typeof input === "object" && input !== null)
    return Object.fromEntries(
      Object.entries(input).map(([key, item]) => [key, withoutNul(item)]),
    );
  return input;
}

/** DuckDB takes a key with the character; PostgreSQL refuses it and merges nothing. */
export function keyRefusedOnPostgres(
  name: string,
  run: (world: RepositoryWorld) => Promise<unknown>,
): RepositoryStep {
  return call(name, async (world) => {
    const isStored = await run(world).then(
      () => true,
      () => false,
    );
    return { isAsApproved: isStored === (world.database.dialect === "duckdb") };
  });
}

/** Both databases could agree on a wrong order, so these steps name the right one. */
export function inOrder<Item>(
  items: readonly Item[] | undefined,
  expected: readonly unknown[],
  read: (item: Item) => unknown = (item) => item,
): readonly Item[] {
  assert.ok(items);
  assert.deepEqual(items.map(read), expected);
  return items;
}

const GOAL_STEPS: readonly RepositoryStep[] = [
  ...["goal-order-z", "goal-order-a"].map((id) =>
    call("ProjectRepository.insertGoal", ({ projects }) =>
      projects.insertGoal({ id, projectId: PROJECT, title: id, position: 1 }),
    ),
  ),
  prepare("UPDATE project_goals SET created_at = '2026-01-01 00:00:00';"),
  reversedInPostgres("project_goals"),
  call("ProjectRepository.findGoals", async ({ projects }) =>
    inOrder(
      await projects.findGoals(PROJECT),
      ["goal-order-z", "goal-order-a"],
      ({ id }) => id,
    ),
  ),
];

const EVENT_STEPS: readonly RepositoryStep[] = [
  ...["event-order-z", "event-order-a"].map((id) =>
    call("ProjectRepository.insertEvent", ({ projects }) =>
      projects.insertEvent({
        id,
        projectId: PROJECT,
        title: id,
        description: "",
        eventDate: "2026-05-01",
        eventTime: null,
        type: "general",
      }),
    ),
  ),
  prepare("UPDATE project_events SET created_at = '2026-01-01 00:00:00';"),
  reversedInPostgres("project_events"),
  call("ProjectRepository.findEvents", async ({ projects }) =>
    inOrder(
      await projects.findEvents(PROJECT),
      ["event-order-z", "event-order-a"],
      ({ id }) => id,
    ),
  ),
];

const SAME_NAME_PROJECTS = ["project-order-z", "project-order-a"];
const PIN_SAME_NAME_PROJECTS = `
  UPDATE projects
  SET updated_at = '2999-01-01 00:00:00'
  WHERE id IN ('project-order-z', 'project-order-a');
`;

const SAME_NAME_PROJECT_STEPS: readonly RepositoryStep[] = [
  ...SAME_NAME_PROJECTS.map((id) =>
    call("ProjectRepository.insert", ({ projects }) =>
      projects.insert({
        ...NEW_PROJECT,
        id,
        name: "Gleicher Name",
        description: "fundstelle-ordnung",
      }),
    ),
  ),
  prepare(PIN_SAME_NAME_PROJECTS),
  reversedInPostgres("projects"),
  call("ProjectRepository.findAll", async ({ projects }) =>
    inOrder(
      (await projects.findAll()).slice(0, 2),
      SAME_NAME_PROJECTS,
      ({ id }) => id,
    ),
  ),
  call("WikiLinkRepository.findProjectsMentioning", async ({ wiki }) =>
    inOrder(
      await wiki.links.findProjectsMentioning(
        {
          userId: "user-admin",
          isAdmin: true,
          departmentIds: [],
          projectIds: SAME_NAME_PROJECTS,
        },
        "fundstelle-ordnung",
      ),
      SAME_NAME_PROJECTS,
      ({ id }) => id,
    ),
  ),
  ...SAME_NAME_PROJECTS.map((id) =>
    call("ProjectRepository.archive", ({ projects }) => projects.archive(id)),
  ),
  prepare(`
    UPDATE projects
    SET archived_at = '2999-01-01 00:00:00'
    WHERE id IN ('project-order-z', 'project-order-a');
  `),
  call("ProjectRepository.findArchived", async ({ projects }) =>
    inOrder(
      (await projects.findArchived()).slice(0, 2),
      SAME_NAME_PROJECTS,
      ({ id }) => id,
    ),
  ),
  ...SAME_NAME_PROJECTS.map((id) =>
    call("ProjectRepository.deletePermanently", ({ projects }) =>
      projects.deletePermanently(id),
    ),
  ),
];

const SESSION_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, last_used_at)
    VALUES
        ('session-order-z', 'user-admin', 'token-order-z', '2999-01-01 00:00:00', '2026-01-01 00:00:00'),
        ('session-order-a', 'user-admin', 'token-order-a', '2999-01-01 00:00:00', '2026-01-01 00:00:00');
  `),
  reversedInPostgres("sessions"),
  call("SessionRepository.listActiveByUserId", async ({ sessions }) =>
    inOrder(
      await sessions.listActiveByUserId("user-admin", "no-current-token"),
      ["session-order-z", "session-order-a"],
      ({ id }) => id,
    ),
  ),
  prepare("DELETE FROM sessions WHERE id LIKE 'session-order-%';"),
];

const MEMBER_STEPS: readonly RepositoryStep[] = [
  // Against the order of the two accounts: the list follows the accounts, not this.
  call("ProjectRepository.addMember", ({ projects }) =>
    projects.addMember(PROJECT, "user-same-name-b", "viewer"),
  ),
  call("ProjectRepository.addMember", ({ projects }) =>
    projects.addMember(PROJECT, "user-same-name-a", "viewer"),
  ),
  reversedInPostgres("project_members"),
  call("ProjectRepository.findMembers", async ({ projects }) =>
    inOrder(
      (await projects.findMembers(PROJECT)).filter(
        ({ displayName }) => displayName === "Same Name",
      ),
      ["user-same-name-a", "user-same-name-b"],
      ({ userId }) => userId,
    ),
  ),
];

/** Changing a profile moves the person behind others of the same name. */
const PROFILE_STEPS: readonly RepositoryStep[] = [
  reversedInPostgres("users"),
  call("UserRepository.findAll", async ({ users }) =>
    inOrder(
      (await users.findAll()).filter(
        ({ displayName }) => displayName === "Same Name",
      ),
      ["user-same-name-a", "user-same-name-b"],
      ({ id }) => id,
    ),
  ),
  call("UserRepository.updateProfile", ({ users }) =>
    users.updateProfile("user-same-name-a", {
      displayName: "Same Name",
      username: "same-a",
      email: null,
    }),
  ),
  call("UserRepository.findAll", async ({ users }) =>
    inOrder(
      (await users.findAll()).filter(
        ({ displayName }) => displayName === "Same Name",
      ),
      ["user-same-name-b", "user-same-name-a"],
      ({ id }) => id,
    ),
  ),
  prepare("UPDATE users SET is_active = 1 WHERE id = 'user-same-name-b';"),
  call("TaskRepository.findEligibleAssignees", async ({ tasks }) =>
    inOrder(
      (await tasks.findEligibleAssignees()).filter(
        ({ displayName }) => displayName === "Same Name",
      ),
      ["user-same-name-b", "user-same-name-a"],
      ({ id }) => id,
    ),
  ),
  prepare("UPDATE users SET is_active = 0 WHERE id = 'user-same-name-b';"),
];

/** The order people see: permissions and memberships as saved, ties as created. */
export const SAVED_ORDER_FLOW: RepositoryFlow = {
  title: "saved order",
  steps: [
    call("AuthorizationRepository.saveRole", ({ authorization }) =>
      authorization.saveRole({
        id: "role-saved-order",
        name: "Gespeicherte Ordnung",
        rank: 5,
        departmentBound: false,
        permissions: [
          CAPABILITY.WRITE,
          CAPABILITY.MANAGE_USERS,
          CAPABILITY.MILESTONES,
        ],
      }),
    ),
    reversedInPostgres("role_permissions"),
    call("AuthorizationRepository.snapshot", async ({ authorization }) => {
      const { roles } = await authorization.snapshot();
      return inOrder(
        roles.find(({ id }) => id === "role-saved-order")?.permissions,
        [CAPABILITY.WRITE, CAPABILITY.MANAGE_USERS, CAPABILITY.MILESTONES],
      );
    }),
    call("AuthorizationRepository.snapshot", async ({ authorization }) => {
      const { accounts } = await authorization.snapshot();
      return inOrder(
        accounts.slice(0, 5),
        CREATED_ACCOUNTS,
        (account) => account.userId,
      );
    }),
    call("AuthorizationRepository.saveAccount", async ({ authorization }) => {
      const before = (await authorization.snapshot()).accounts.find(
        ({ userId }) => userId === "user-manager",
      );
      assert.ok(before);
      await authorization.saveAccount({
        ...before,
        departments: ["department-z", "department-a"],
        managedDepartments: ["department-z", "department-a"],
      });
      const after = (await authorization.snapshot()).accounts.find(
        ({ userId }) => userId === "user-manager",
      );
      const saved = ["department-z", "department-a"];
      inOrder(after?.departments, saved);
      inOrder(after?.managedDepartments, saved);
      await authorization.saveAccount(before);
    }),
    call("AuthorizationRepository.deleteRole", ({ authorization }) =>
      authorization.deleteRole("role-saved-order"),
    ),
    call("ProjectRepository.insert", ({ projects }) =>
      projects.insert({ ...NEW_PROJECT, id: PROJECT, name: "Ordnung" }),
    ),
    // Identifiers against the alphabet of creation, all within one pinned second.
    ...GOAL_STEPS,
    ...EVENT_STEPS,
    ...SAME_NAME_PROJECT_STEPS,
    ...SESSION_STEPS,
    ...MEMBER_STEPS,
    ...PROFILE_STEPS,
    call("ProjectRepository.deletePermanently", ({ projects }) =>
      projects.deletePermanently(PROJECT),
    ),
  ],
};

/** U+0000 in this area: saved values lose it on PostgreSQL, reads and identities never match. */
export const AREA_NUL_FLOW: RepositoryFlow = {
  title: "U+0000 in core and projects",
  steps: [
    call("UserRepository.insert", ({ users }) => users.insert(NUL_USER)),
    call("UserRepository.findById", async ({ users }) =>
      withoutNul(await users.findById(NUL_USER.id)),
    ),
    call("UserRepository.updateProfile", ({ users }) =>
      users.updateProfile(NUL_USER.id, {
        displayName: `Ge${NUL}ändert`,
        username: NUL_USER.username,
        email: null,
      }),
    ),
    call("UserRepository.findById", async ({ users }) =>
      withoutNul(await users.findById(NUL_USER.id)),
    ),
    call("UserRepository.findCredentialsByUsername", ({ users }) =>
      users.findCredentialsByUsername(`${NUL_USER.username}${NUL}`),
    ),
    call("UserRepository.findCredentialsByUsername", ({ users }) =>
      users.findCredentialsByUsername(`plain${NUL}-name`),
    ),
    call("UserRepository.findById", ({ users }) =>
      users.findById(`${NUL_USER.id}${NUL}`),
    ),
    call("UserRepository.findByEmail", ({ users }) =>
      users.findByEmail(`a${NUL}@example.test`),
    ),
    call("UserRepository.updatePasswordHash", ({ users }) =>
      users.updatePasswordHash(`${NUL_USER.id}${NUL}`, "changed"),
    ),
    stored("SELECT password_hash FROM users WHERE id = 'user-nul-text';"),
    prepare(`
      INSERT INTO sessions (id, user_id, token_hash, expires_at)
      VALUES ('session-nul', 'user-nul-text', 'token-nul', '2999-01-01 00:00:00');
    `),
    call("SessionRepository.findUserIdByTokenHash", ({ sessions }) =>
      sessions.findUserIdByTokenHash(`token-nul${NUL}`),
    ),
    call("SessionRepository.isActive", ({ sessions }) =>
      sessions.isActive(`session-nul${NUL}`, NUL_USER.id),
    ),
    call("SessionRepository.deleteByTokenHash", ({ sessions }) =>
      sessions.deleteByTokenHash(`token-nul${NUL}`),
    ),
    stored("SELECT COUNT(*) FROM sessions WHERE id = 'session-nul';"),
    prepare("DELETE FROM sessions WHERE id = 'session-nul';"),
    call("UserBoardPreferencesRepository.upsert", ({ boards }) =>
      boards.upsert(NUL_USER.id, "erste"),
    ),
    keyRefusedOnPostgres(
      "UserBoardPreferencesRepository.upsert",
      ({ boards }) => boards.upsert(`${NUL_USER.id}${NUL}`, "zweite"),
    ),
    call("UserBoardPreferencesRepository.findByUserId", ({ boards }) =>
      boards.findByUserId(NUL_USER.id),
    ),
    call("UserBoardPreferencesRepository.findByUserId", ({ boards }) =>
      boards.findByUserId(`${NUL_USER.id}${NUL}`).then((found) =>
        // DuckDB finds the row it stored under this key; PostgreSQL refused that row.
        found === null || found === "zweite" ? "not the first row" : found,
      ),
    ),
    prepare(
      "DELETE FROM user_board_preferences WHERE user_id LIKE 'user-nul-text%';",
    ),
    call("ProjectRepository.insert", ({ projects }) =>
      projects.insert({
        ...NEW_PROJECT,
        id: NUL_PROJECT,
        name: `Pro${NUL}jekt`,
        description: `Text${NUL}`,
      }),
    ),
    call("ProjectRepository.findById", async ({ projects }) =>
      withoutNul(await projects.findById(NUL_PROJECT)),
    ),
    call("ProjectRepository.findById", ({ projects }) =>
      projects.findById(`${NUL_PROJECT}${NUL}`),
    ),
    prepare(`
      INSERT INTO project_tags (project_id, tag) VALUES ('project-nul', 'tag');
    `),
    keyRefusedOnPostgres("ProjectRepository.setTags", ({ projects }) =>
      projects.setTags(NUL_PROJECT, [`tag${NUL}`]),
    ),
    // PostgreSQL refuses and keeps the old tag; DuckDB stores the tag with the character.
    call("ProjectRepository.findTags", async ({ projects }) =>
      withoutNul(await projects.findTags(NUL_PROJECT)),
    ),
    prepare("DELETE FROM project_tags WHERE project_id = 'project-nul';"),
    // A character inside JSON is the escape of six characters and stays in both.
    call("AdministrationActivityRepository.insert", ({ activity }) =>
      activity.insert({
        actorId: NUL_USER.id,
        operation: "admin.nul",
        source: "mcp",
        result: {
          id: `a${NUL}b`,
          targetType: "role",
          changed: true,
          affectedUserIds: [],
        },
      }),
    ),
    stored(
      "SELECT changes_json FROM administration_activity WHERE operation = 'admin.nul';",
    ),
    prepare(
      "DELETE FROM administration_activity WHERE operation = 'admin.nul';",
    ),
    call("ProjectRepository.deletePermanently", ({ projects }) =>
      projects.deletePermanently(NUL_PROJECT),
    ),
    prepare(`
      DELETE FROM user_authorization WHERE user_id = 'user-nul-text';
      DELETE FROM users WHERE id = 'user-nul-text';
    `),
  ],
};
