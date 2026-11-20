import { expect, it } from "vitest";

import { ADMINISTRATION_ROLE_ID, CAPABILITY } from "@/definition/Authorization";

import { UserPolicyService } from "./UserPolicyService";

import type {
  AccountAccess,
  Capability,
  UserRole,
} from "@/definition/Authorization";

function role(overrides: Partial<UserRole> = {}): UserRole {
  return {
    id: "role-member",
    name: "Member",
    rank: 1,
    departmentBound: false,
    permissions: [],
    ...overrides,
  };
}

function account(overrides: Partial<AccountAccess> = {}): AccountAccess {
  return {
    userId: "user-1",
    role: null,
    isAdmin: false,
    mode: "role",
    firstName: "Ada",
    lastName: "Lovelace",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
    ...overrides,
  };
}

const service = new UserPolicyService();
const mcpService = new UserPolicyService("mcp");
const administrator = account({
  userId: "admin-1",
  isAdmin: true,
  mode: "admin",
});
const management = account({
  userId: "management-1",
  role: role({ id: ADMINISTRATION_ROLE_ID, rank: 3 }),
});
const agentAdministrator = account({
  userId: "agent-1",
  isAgent: true,
  isAdmin: true,
  mode: "admin",
  hasAgentAdministratorRights: true,
});

it("recognizes an administrator only in the admin mode of an active human account", () => {
  expect(service.isAdministrator(administrator)).toBe(true);
  expect(
    service.isAdministrator(account({ isAdmin: true, mode: "role" })),
  ).toBe(false);
  expect(
    service.isAdministrator(
      account({ isAdmin: true, mode: "admin", isActive: false }),
    ),
  ).toBe(false);
  expect(
    service.isAdministrator(account({ isAdmin: false, mode: "admin" })),
  ).toBe(false);
});

it("interprets the role mode of an administrator as administration on the MCP channel only", () => {
  const roleModeAdministrator = account({ isAdmin: true, mode: "role" });

  expect(mcpService.isAdministrator(roleModeAdministrator)).toBe(true);
  expect(service.isAdministrator(roleModeAdministrator)).toBe(false);
  expect(
    mcpService.isAdministrator(
      account({ isAdmin: true, mode: "role", isActive: false }),
    ),
  ).toBe(false);
});

it("grants an agent administration only through its explicit rights", () => {
  expect(service.isAdministrator(agentAdministrator)).toBe(true);
  expect(
    service.isAdministrator(
      account({ isAgent: true, isAdmin: true, mode: "admin" }),
    ),
  ).toBe(false);
  expect(
    service.isAdministrator({ ...agentAdministrator, isActive: false }),
  ).toBe(false);
});

it("never treats an agent account as a human administrator in admin mode", () => {
  expect(service.isHumanAdministratorInAdminMode(administrator)).toBe(true);
  expect(service.isHumanAdministratorInAdminMode(agentAdministrator)).toBe(
    false,
  );
  expect(
    service.isHumanAdministratorInAdminMode(
      account({ isAdmin: true, mode: "admin", isActive: false }),
    ),
  ).toBe(false);
});

it("recognizes the business administration role only for an active account", () => {
  expect(service.isManagement(management)).toBe(true);
  expect(service.isManagement({ ...management, isActive: false })).toBe(false);
  expect(service.isManagement(account({ role: role() }))).toBe(false);
  expect(service.isManagement(account())).toBe(false);
});

it("grants global access to administrators and to business management", () => {
  expect(service.hasGlobalAccess(administrator)).toBe(true);
  expect(service.hasGlobalAccess(management)).toBe(true);
  expect(
    service.hasGlobalAccess(
      account({ role: role({ permissions: [CAPABILITY.MANAGE_USERS] }) }),
    ),
  ).toBe(false);
});

it("grants business management every capability except role and department management", () => {
  expect(service.has(management, CAPABILITY.WRITE)).toBe(true);
  expect(service.has(management, CAPABILITY.MANAGE_USERS)).toBe(true);
  expect(service.has(management, CAPABILITY.MANAGE_ROLES)).toBe(false);
  expect(service.has(management, CAPABILITY.MANAGE_DEPARTMENTS)).toBe(false);
  expect(service.has(administrator, CAPABILITY.MANAGE_ROLES)).toBe(true);
});

it("grants a role only its listed capabilities for an active account", () => {
  const userManager = account({
    role: role({ permissions: [CAPABILITY.MANAGE_USERS] }),
  });

  expect(service.has(userManager, CAPABILITY.MANAGE_USERS)).toBe(true);
  expect(service.has(userManager, CAPABILITY.MANAGE_PROJECTS)).toBe(false);
  expect(service.has(account(), CAPABILITY.MANAGE_USERS)).toBe(false);
  expect(
    service.has({ ...userManager, isActive: false }, CAPABILITY.MANAGE_USERS),
  ).toBe(false);
});

it("enters the management area with user, role or department management", () => {
  const withPermission = (permission: Capability): AccountAccess =>
    account({ role: role({ permissions: [permission] }) });

  expect(service.canEnter(withPermission(CAPABILITY.MANAGE_USERS))).toBe(true);
  expect(service.canEnter(withPermission(CAPABILITY.MANAGE_ROLES))).toBe(true);
  expect(service.canEnter(withPermission(CAPABILITY.MANAGE_DEPARTMENTS))).toBe(
    true,
  );
  expect(service.canEnter(withPermission(CAPABILITY.MANAGE_PROJECTS))).toBe(
    false,
  );
  expect(service.canEnter(administrator)).toBe(true);
});

it("manages a department through the department capability and its range", () => {
  const departmentManager = account({
    role: role({ permissions: [CAPABILITY.MANAGE_DEPARTMENTS] }),
    managedDepartments: ["dept-a"],
  });
  const allDepartmentsManager = account({
    role: role({ permissions: [CAPABILITY.MANAGE_DEPARTMENTS] }),
    allDepartments: true,
  });
  const userManager = account({
    role: role({ permissions: [CAPABILITY.MANAGE_USERS] }),
    allDepartments: true,
  });

  expect(service.canManageDepartment(departmentManager, "dept-a")).toBe(true);
  expect(service.canManageDepartment(departmentManager, "dept-b")).toBe(false);
  expect(service.canManageDepartment(allDepartmentsManager, "dept-z")).toBe(
    true,
  );
  expect(service.canManageDepartment(userManager, "dept-z")).toBe(false);
  expect(service.canManageDepartment(administrator, "dept-z")).toBe(true);
});

it("sees accounts without departments and every account of a global scope", () => {
  const departmentless = account({ departments: [] });
  const inDepartmentA = account({ departments: ["dept-a"] });
  const inDepartmentB = account({ departments: ["dept-b"] });
  const userManager = account({
    role: role({ permissions: [CAPABILITY.MANAGE_USERS] }),
    departments: ["dept-a"],
  });

  expect(service.canSee(account(), departmentless)).toBe(false);
  expect(service.canSee(userManager, departmentless)).toBe(true);
  expect(service.canSee(userManager, inDepartmentA)).toBe(true);
  expect(service.canSee(userManager, inDepartmentB)).toBe(false);
  expect(service.canSee(administrator, inDepartmentB)).toBe(true);
  expect(service.canSee(management, inDepartmentB)).toBe(true);
});

it("sees accounts of a managed department through the department range", () => {
  const departmentManager = account({
    role: role({ permissions: [CAPABILITY.MANAGE_DEPARTMENTS] }),
    managedDepartments: ["dept-b"],
  });
  const departmentOnlyMember = account({
    role: role({ permissions: [CAPABILITY.MANAGE_DEPARTMENTS] }),
    departments: ["dept-a"],
  });
  const inDepartmentB = account({ departments: ["dept-b"] });
  const inDepartmentA = account({ departments: ["dept-a"] });

  expect(service.canSee(departmentManager, inDepartmentB)).toBe(true);
  expect(service.canSee(departmentOnlyMember, inDepartmentA)).toBe(false);
});

it("changes every non-protected account as administrator", () => {
  const member = account({ userId: "member-1", role: role({ rank: 1 }) });

  expect(
    service.canChange(administrator, member, CAPABILITY.MANAGE_USERS),
  ).toBe(true);
});

it("lets business management change ordinary accounts only within user, role and department management", () => {
  const member = account({ userId: "member-1", role: role({ rank: 1 }) });
  const otherAdmin = account({
    userId: "admin-2",
    isAdmin: true,
    mode: "role",
  });

  expect(service.canChange(management, member, CAPABILITY.MANAGE_USERS)).toBe(
    true,
  );
  expect(
    service.canChange(management, member, CAPABILITY.MANAGE_PROJECTS),
  ).toBe(false);
  expect(
    service.canChange(management, management, CAPABILITY.MANAGE_USERS),
  ).toBe(false);
  expect(
    service.canChange(management, otherAdmin, CAPABILITY.MANAGE_USERS),
  ).toBe(false);
});

it("changes an account of equal or lower rank only with the capability and visibility", () => {
  const actor = account({
    userId: "actor-1",
    role: role({ rank: 2, permissions: [CAPABILITY.MANAGE_USERS] }),
  });
  const lowerRank = account({ userId: "member-1", role: role({ rank: 1 }) });
  const higherRank = account({ userId: "member-2", role: role({ rank: 3 }) });

  expect(service.canChange(actor, lowerRank, CAPABILITY.MANAGE_USERS)).toBe(
    true,
  );
  expect(service.canChange(actor, higherRank, CAPABILITY.MANAGE_USERS)).toBe(
    false,
  );
  expect(
    service.canChange(
      actor,
      account({ userId: "member-3" }),
      CAPABILITY.MANAGE_USERS,
    ),
  ).toBe(false);
  expect(service.canChange(actor, lowerRank, CAPABILITY.MANAGE_PROJECTS)).toBe(
    false,
  );
  expect(
    service.canChange(
      actor,
      account({
        userId: "member-4",
        role: role({ rank: 1 }),
        departments: ["dept-b"],
      }),
      CAPABILITY.MANAGE_USERS,
    ),
  ).toBe(false);
});

it("does not let an account change itself through the rank rule", () => {
  const actor = account({
    role: role({ rank: 2, permissions: [CAPABILITY.MANAGE_USERS] }),
  });

  expect(service.canChange(actor, actor, CAPABILITY.MANAGE_USERS)).toBe(false);
});

it("protects administrators from agents and agent administrators from everyone but administrators", () => {
  const humanAdministrator = account({
    userId: "admin-3",
    isAdmin: true,
    mode: "admin",
  });
  const agent = account({
    userId: "agent-2",
    isAgent: true,
    isAdmin: false,
    mode: "role",
    role: role({ rank: 2, permissions: [CAPABILITY.MANAGE_USERS] }),
  });
  const userManager = account({
    userId: "manager-1",
    role: role({ rank: 2, permissions: [CAPABILITY.MANAGE_USERS] }),
  });

  expect(
    service.canChange(agent, humanAdministrator, CAPABILITY.MANAGE_USERS),
  ).toBe(false);
  expect(
    service.canChange(userManager, agentAdministrator, CAPABILITY.MANAGE_USERS),
  ).toBe(false);
  expect(
    service.canChange(
      administrator,
      agentAdministrator,
      CAPABILITY.MANAGE_USERS,
    ),
  ).toBe(true);
});

it("assigns any role as administrator and never the administration role to others", () => {
  const administrationRole = role({ id: ADMINISTRATION_ROLE_ID, rank: 3 });

  expect(service.canAssignRole(administrator, administrationRole)).toBe(true);
  expect(service.canAssignRole(management, administrationRole)).toBe(false);
  expect(service.canAssignRole(management, role({ rank: 1 }))).toBe(true);
});

it("assigns a role only up to the rank and permissions of the actor", () => {
  const actor = account({
    role: role({
      rank: 2,
      permissions: [CAPABILITY.MANAGE_ROLES, CAPABILITY.MANAGE_USERS],
    }),
  });

  expect(
    service.canAssignRole(
      actor,
      role({ rank: 1, permissions: [CAPABILITY.MANAGE_USERS] }),
    ),
  ).toBe(true);
  expect(service.canAssignRole(actor, role({ rank: 3 }))).toBe(false);
  expect(
    service.canAssignRole(
      actor,
      role({ rank: 1, permissions: [CAPABILITY.MANAGE_ROLES] }),
    ),
  ).toBe(false);
  expect(
    service.canAssignRole(
      actor,
      role({ rank: 1, permissions: [CAPABILITY.MANAGE_PROJECTS] }),
    ),
  ).toBe(false);
  expect(
    service.canAssignRole({ ...actor, isActive: false }, role({ rank: 1 })),
  ).toBe(false);
  expect(service.canAssignRole(account(), role({ rank: 1 }))).toBe(false);
});

it("edits a shared role only when every holder is within the actor's scope", () => {
  const current = role({
    id: "role-shared",
    rank: 1,
    permissions: [CAPABILITY.MANAGE_USERS],
  });
  const next = role({ id: "role-shared", rank: 1 });
  const actor = account({
    role: role({
      id: "role-manager",
      rank: 2,
      permissions: [CAPABILITY.MANAGE_ROLES, CAPABILITY.MANAGE_USERS],
    }),
  });
  const lowHolder = account({ userId: "holder-1", role: current });
  const highHolder = account({
    userId: "holder-2",
    role: role({ id: "role-high", rank: 3 }),
  });

  expect(service.canEditRole(actor, current, next, [lowHolder])).toBe(true);
  expect(
    service.canEditRole(actor, current, next, [lowHolder, highHolder]),
  ).toBe(false);
});

it("refuses to edit the administration role or any role for business management", () => {
  const administrationRole = role({ id: ADMINISTRATION_ROLE_ID, rank: 3 });
  const plainRole = role({ id: "role-plain", rank: 1 });

  expect(
    service.canEditRole(administrator, administrationRole, plainRole, []),
  ).toBe(false);
  expect(service.canEditRole(administrator, plainRole, plainRole, [])).toBe(
    true,
  );
  expect(service.canEditRole(management, plainRole, plainRole, [])).toBe(false);
});

it("requires the role capability and a role range for editing a shared role", () => {
  const current = role({ id: "role-shared", rank: 1 });
  const next = role({ id: "role-shared", rank: 1 });
  const withRoleIdentity = (overrides: Partial<UserRole>): AccountAccess =>
    account({ role: role({ id: "role-manager", rank: 2, ...overrides }) });

  expect(
    service.canEditRole(
      withRoleIdentity({ permissions: [] }),
      current,
      next,
      [],
    ),
  ).toBe(false);
  expect(
    service.canEditRole(
      withRoleIdentity({ permissions: [CAPABILITY.MANAGE_ROLES] }),
      role({ id: "role-manager", rank: 1 }),
      next,
      [],
    ),
  ).toBe(false);
  expect(
    service.canEditRole(
      withRoleIdentity({ permissions: [CAPABILITY.MANAGE_ROLES] }),
      role({ id: "role-high", rank: 3 }),
      next,
      [],
    ),
  ).toBe(false);
  expect(
    service.canEditRole(
      withRoleIdentity({ permissions: [CAPABILITY.MANAGE_ROLES] }),
      current,
      role({ id: "role-shared", rank: 3 }),
      [],
    ),
  ).toBe(false);
  expect(service.canEditRole(account(), current, next, [])).toBe(false);
});

it("lets an administrator set any memberships and business management set them of others", () => {
  const target = account({ userId: "member-1", departments: ["dept-a"] });

  expect(service.canSetMemberships(administrator, target, ["dept-b"])).toBe(
    true,
  );
  expect(service.canSetMemberships(management, target, ["dept-b"])).toBe(true);
  expect(service.canSetMemberships(management, management, ["dept-b"])).toBe(
    false,
  );
  expect(
    service.canSetMemberships(
      management,
      account({ userId: "admin-4", isAdmin: true, mode: "role" }),
      ["dept-b"],
    ),
  ).toBe(false);
});

it("refuses to remove the last membership of an account that once had one", () => {
  const formerMember = account({
    userId: "member-2",
    hasHadDepartment: true,
    departments: [],
  });

  expect(service.canSetMemberships(administrator, formerMember, [])).toBe(
    false,
  );
});

it("refuses membership changes that touch protected accounts", () => {
  expect(
    service.canSetMemberships(agentAdministrator, administrator, ["dept-a"]),
  ).toBe(false);
  expect(
    service.canSetMemberships(
      account({ isAgent: true, role: role({ permissions: [] }) }),
      account({ userId: "member-3", hasAgentAdministratorRights: true }),
      ["dept-a"],
    ),
  ).toBe(false);
});

it("sets memberships of a departmentless account by department range or own departments", () => {
  const departmentManager = account({
    userId: "dept-manager",
    role: role({
      permissions: [CAPABILITY.MANAGE_DEPARTMENTS],
      rank: 2,
    }),
    managedDepartments: ["dept-a"],
  });
  const userManager = account({
    userId: "user-manager",
    role: role({
      permissions: [CAPABILITY.MANAGE_ROLES],
      rank: 2,
    }),
    departments: ["dept-b"],
  });
  const departmentless = account({
    userId: "member-5",
    role: role({ rank: 1 }),
  });

  expect(
    service.canSetMemberships(departmentManager, departmentless, ["dept-a"]),
  ).toBe(true);
  expect(
    service.canSetMemberships(departmentManager, departmentless, ["dept-z"]),
  ).toBe(false);
  expect(
    service.canSetMemberships(userManager, departmentless, ["dept-b"]),
  ).toBe(true);
  expect(
    service.canSetMemberships(userManager, departmentless, ["dept-z"]),
  ).toBe(false);
});

it("changes memberships of an account with departments only within the managed range", () => {
  const departmentManager = account({
    userId: "dept-manager",
    role: role({ permissions: [CAPABILITY.MANAGE_DEPARTMENTS], rank: 2 }),
    managedDepartments: ["dept-a", "dept-b"],
  });
  const member = account({
    userId: "member-6",
    role: role({ rank: 1 }),
    departments: ["dept-a"],
  });
  const outsideMember = account({
    userId: "member-7",
    role: role({ rank: 1 }),
    departments: ["dept-c"],
  });

  expect(service.canSetMemberships(departmentManager, member, ["dept-b"])).toBe(
    true,
  );
  expect(
    service.canSetMemberships(departmentManager, member, ["dept-a", "dept-c"]),
  ).toBe(false);
  expect(
    service.canSetMemberships(departmentManager, outsideMember, ["dept-c"]),
  ).toBe(false);
});

it("manages groups only with the user management capability", () => {
  const userManager = account({
    role: role({ permissions: [CAPABILITY.MANAGE_USERS] }),
  });

  expect(service.canManageGroups(userManager)).toBe(true);
  expect(service.canManageGroups(account())).toBe(false);
});

it("lists a group when it is empty, global or has a member the actor may see", () => {
  const userManager = account({
    role: role({ permissions: [CAPABILITY.MANAGE_USERS] }),
    departments: ["dept-a"],
  });
  const visibleMember = account({ departments: ["dept-a"] });
  const hiddenMember = account({ departments: ["dept-z"] });

  expect(service.canSeeGroup(administrator, [hiddenMember])).toBe(true);
  expect(service.canSeeGroup(userManager, [])).toBe(true);
  expect(service.canSeeGroup(userManager, [hiddenMember, visibleMember])).toBe(
    true,
  );
  expect(service.canSeeGroup(userManager, [hiddenMember])).toBe(false);
  expect(service.canSeeGroup(account(), [])).toBe(false);
});

it("changes a group only when every member is within the actor's scope", () => {
  const userManager = account({
    role: role({ permissions: [CAPABILITY.MANAGE_USERS] }),
    departments: ["dept-a"],
  });
  const visibleMember = account({ departments: ["dept-a"] });
  const hiddenMember = account({ departments: ["dept-z"] });

  expect(service.canChangeGroup(administrator, [hiddenMember])).toBe(true);
  expect(service.canChangeGroup(userManager, [visibleMember])).toBe(true);
  expect(
    service.canChangeGroup(userManager, [visibleMember, hiddenMember]),
  ).toBe(false);
  expect(service.canChangeGroup(account(), [visibleMember])).toBe(false);
});
