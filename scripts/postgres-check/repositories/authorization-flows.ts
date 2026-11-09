import { CAPABILITY } from "@/definition/Authorization";

import { call, prepare, refused, reversedInPostgres, stored } from "./world";

import type { AccountAccess, UserRole } from "@/definition/Authorization";
import type { RepositoryFlow } from "./world";

const ROLE_LEAD: UserRole = {
  id: "role-lead",
  name: "Lead",
  rank: 50,
  departmentBound: true,
  permissions: [CAPABILITY.WRITE, CAPABILITY.MILESTONES, CAPABILITY.WRITE],
};

const ROLE_SAME_RANK: UserRole = {
  id: "role-b",
  name: "Assistenz",
  rank: 50,
  departmentBound: false,
  permissions: [CAPABILITY.MANAGE_USERS, CAPABILITY.MANAGE_DEPARTMENTS],
};

const ACCOUNT: AccountAccess = {
  userId: "user-same-name-a",
  role: ROLE_LEAD,
  isAdmin: false,
  mode: "role",
  firstName: "Änne",
  lastName: "O'Neil",
  isActive: true,
  departments: ["department-z", "department-a", "department-z"],
  managedDepartments: ["department-a"],
  allDepartments: false,
  allProjects: true,
  hasHadDepartment: false,
};

const failTransaction = (): never => {
  throw new Error("The flow ends this transaction.");
};

/** Rechte und Abteilungen: roles, departments and the access of accounts. */
export const AUTHORIZATION_FLOW: RepositoryFlow = {
  title: "rights and departments",
  steps: [
    call("AuthorizationRepository.saveRole", ({ authorization }) =>
      authorization.saveRole(ROLE_LEAD),
    ),
    call("AuthorizationRepository.saveRole", ({ authorization }) =>
      authorization.saveRole(ROLE_SAME_RANK),
    ),
    call("AuthorizationRepository.saveRole", ({ authorization }) =>
      authorization.saveRole({ ...ROLE_SAME_RANK, rank: 40, name: "Hilfe" }),
    ),
    refused("AuthorizationRepository.saveRole", ({ authorization }) =>
      authorization.saveRole({ ...ROLE_SAME_RANK, id: "role-c", name: "LEAD" }),
    ),
    call("AuthorizationRepository.saveDepartment", ({ authorization }) =>
      authorization.saveDepartment({ id: "department-z", name: "Ärzte" }),
    ),
    call("AuthorizationRepository.saveDepartment", ({ authorization }) =>
      authorization.saveDepartment({ id: "department-a", name: "Zentrale" }),
    ),
    call("AuthorizationRepository.saveDepartment", ({ authorization }) =>
      authorization.saveDepartment({ id: "department-b", name: "alt" }),
    ),
    call("AuthorizationRepository.saveDepartment", ({ authorization }) =>
      authorization.saveDepartment({ id: "department-b", name: "Beratung" }),
    ),
    refused("AuthorizationRepository.saveDepartment", ({ authorization }) =>
      authorization.saveDepartment({ id: "department-c", name: "ZENTRALE" }),
    ),
    call("AuthorizationRepository.saveAccount", ({ authorization }) =>
      authorization.saveAccount(ACCOUNT),
    ),
    // Saved order, shown by a physical order that differs in PostgreSQL only.
    reversedInPostgres("role_permissions"),
    reversedInPostgres("department_members"),
    reversedInPostgres("managed_departments"),
    reversedInPostgres("user_authorization"),
    call("AuthorizationRepository.snapshot", ({ authorization }) =>
      authorization.snapshot(),
    ),
    call("AuthorizationRepository.saveAccount", ({ authorization }) =>
      authorization.saveAccount({
        ...ACCOUNT,
        role: null,
        isAdmin: true,
        mode: "admin",
        departments: [],
        managedDepartments: [],
      }),
    ),
    stored(`
      SELECT role_id, is_admin, active_mode, has_had_department, all_projects
      FROM user_authorization
      WHERE user_id = 'user-same-name-a';
    `),
    refused("AuthorizationRepository.saveAccount", ({ authorization }) =>
      authorization.saveAccount({ ...ACCOUNT, role: null, mode: "role" }),
    ),
    call("AuthorizationRepository.saveAccount", ({ authorization }) =>
      authorization.saveAccount(ACCOUNT),
    ),
    call("AuthorizationRepository.activateAdministrator", ({ authorization }) =>
      authorization.activateAdministrator("user-same-name-a"),
    ),
    prepare(
      "UPDATE user_authorization SET is_admin = 1 WHERE user_id = 'user-same-name-a';",
    ),
    call("AuthorizationRepository.activateAdministrator", ({ authorization }) =>
      authorization.activateAdministrator("user-same-name-a"),
    ),
    stored(`
      SELECT is_admin, active_mode
      FROM user_authorization
      WHERE user_id = 'user-same-name-a';
    `),
    prepare(`
      INSERT INTO work_items (id, project_id, key, number, department_id, type, title, status_id, created_by)
      VALUES ('item-of-department', 'project-of-department', 'DEP-1', 1, 'department-b', 'task', 'x', 'status-todo', 'user-admin');
      INSERT INTO project_departments (project_id, department_id)
      VALUES ('project-of-department', 'department-b');
    `),
    call("AuthorizationRepository.deleteDepartment", ({ authorization }) =>
      authorization.deleteDepartment("department-b"),
    ),
    stored(
      "SELECT department_id FROM work_items WHERE id = 'item-of-department';",
    ),
    stored("SELECT COUNT(*) FROM project_departments;"),
    prepare("DELETE FROM work_items WHERE id = 'item-of-department';"),
    call("AuthorizationRepository.deleteRole", ({ authorization }) =>
      authorization.deleteRole("role-b"),
    ),
    call("AuthorizationRepository.snapshot", ({ authorization }) =>
      authorization.snapshot(),
    ),
    call("AuthorizationRepository.transaction", ({ authorization }) =>
      authorization.transaction(async (repository) => {
        await repository.saveDepartment({ id: "department-tx", name: "Neu" });
        const seen = await repository.snapshot();
        return seen.departments.map(({ id }) => id);
      }),
    ),
    refused("AuthorizationRepository.transaction", ({ authorization }) =>
      authorization.transaction(async (repository) => {
        await repository.saveDepartment({ id: "department-gone", name: "Weg" });
        failTransaction();
      }),
    ),
    refused("AuthorizationRepository.transaction", ({ authorization }) =>
      authorization.transaction(async (repository) => {
        await repository.saveDepartment({ id: "department-gone", name: "Weg" });
        await repository.saveDepartment({ id: "department-dup", name: "NEU" });
      }),
    ),
    stored("SELECT id FROM departments ORDER BY id;"),
    call("AuthorizationRepository.users", ({ authorization }) =>
      authorization.transaction((repository) =>
        repository.users().findById("user-admin"),
      ),
    ),
    call("AuthorizationRepository.groups", ({ authorization }) =>
      authorization.transaction((repository) =>
        repository.groups().findSummaries(),
      ),
    ),
    call("AuthorizationRepository.agentProfiles", ({ authorization }) =>
      Promise.resolve(authorization.agentProfiles() !== null),
    ),
    call("AuthorizationRepository.agentConnectionScopes", ({ authorization }) =>
      Promise.resolve(authorization.agentConnectionScopes() !== null),
    ),
    call("AuthorizationRepository.employees", ({ authorization }) =>
      Promise.resolve(authorization.employees() !== null),
    ),
  ],
};

/** Groups of people and their members. */
export const GROUP_FLOW: RepositoryFlow = {
  title: "groups",
  steps: [
    call("UserGroupRepository.save", ({ groups }) =>
      groups.save({
        id: "group-b",
        name: "Beta",
        memberIds: ["user-manager", "user-admin", "user-admin"],
      }),
    ),
    call("UserGroupRepository.save", ({ groups }) =>
      groups.save({ id: "group-a", name: "änderung", memberIds: [] }),
    ),
    call("UserGroupRepository.save", ({ groups }) =>
      groups.save({ id: "group-c", name: "ALPHA", memberIds: ["user-admin"] }),
    ),
    call("UserGroupRepository.save", ({ groups }) =>
      groups.save({ id: "group-c", name: "Alpha", memberIds: ["user-admin"] }),
    ),
    refused("UserGroupRepository.save", ({ groups }) =>
      groups.save({ id: "group-d", name: "BETA", memberIds: [] }),
    ),
    call("UserGroupRepository.findAll", ({ groups }) => groups.findAll()),
    call("UserGroupRepository.findSummaries", ({ groups }) =>
      groups.findSummaries(),
    ),
    call("UserGroupRepository.findSummaryById", ({ groups }) =>
      groups.findSummaryById("group-b"),
    ),
    call("UserGroupRepository.findSummaryById", ({ groups }) =>
      groups.findSummaryById("nothing"),
    ),
    call("UserGroupRepository.findIdsByMember", ({ groups }) =>
      groups.findIdsByMember("user-admin"),
    ),
    prepare(`
      INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by, assignee_group_id)
      VALUES ('item-of-group', 'project-of-group', 'GRP-1', 1, 'task', 'x', 'status-todo', 'user-admin', 'group-a');
    `),
    call("UserGroupRepository.delete", ({ groups }) =>
      groups.delete("group-a"),
    ),
    stored(
      "SELECT assignee_group_id FROM work_items WHERE id = 'item-of-group';",
    ),
    prepare("DELETE FROM work_items WHERE id = 'item-of-group';"),
    call("UserGroupRepository.findSummaries", ({ groups }) =>
      groups.findSummaries(),
    ),
  ],
};
