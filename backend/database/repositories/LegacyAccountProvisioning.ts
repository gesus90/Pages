import { ROLE } from "@/definition/Role";
import { CAPABILITY } from "@/definition/Authorization";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  AccountInitialization,
  UserRole,
} from "@/definition/Authorization";
import type { Role } from "@/definition/Role";
import type { NewUser } from "./UserRepository";

const LEGACY_PROFILES: Readonly<Record<Role, UserRole | null>> = {
  admin: null,
  manager: {
    id: "legacy-manager",
    name: "Manager",
    rank: 20,
    departmentBound: false,
    permissions: [
      CAPABILITY.WRITE,
      CAPABILITY.CREATE_PROJECTS,
      CAPABILITY.MANAGE_PROJECTS,
      CAPABILITY.MILESTONES,
      CAPABILITY.MANAGE_USERS,
    ],
  },
  employee: {
    id: "legacy-employee",
    name: "Employee",
    rank: 10,
    departmentBound: false,
    permissions: [CAPABILITY.WRITE],
  },
};

/** Bridges old insertion callers; new administration supplies explicit authorization. */
export async function provisionAccount(
  transaction: DatabaseTransaction,
  user: NewUser,
): Promise<void> {
  const profile = LEGACY_PROFILES[user.role];
  if (!user.authorization && profile) {
    await seedLegacyProfile(transaction, profile);
  }
  const authorization: AccountInitialization = user.authorization ?? {
    roleId: profile?.id ?? null,
    isAdmin: user.role === ROLE.ADMIN,
    mode: user.role === ROLE.ADMIN ? "admin" : "role",
    firstName: user.displayName,
    lastName: "",
  };
  await transaction.execute(
    `
    INSERT INTO user_authorization (user_id, role_id, is_admin, active_mode, first_name, last_name, all_projects)
    VALUES ($id, $role, $admin, $mode, $first, $last, $all_projects);
  `,
    {
      id: user.id,
      role: authorization.roleId,
      admin: authorization.isAdmin,
      mode: authorization.mode,
      first: authorization.firstName,
      last: authorization.lastName,
      all_projects: !user.authorization && user.role === ROLE.MANAGER,
    },
  );
}

async function seedLegacyProfile(
  transaction: DatabaseTransaction,
  role: UserRole,
): Promise<void> {
  // RETURNING distinguishes a newly created compatibility profile from one
  // administrators have already customized; never restore removed permissions.
  const inserted = await transaction.query(
    `
    INSERT INTO roles (id, name, hierarchy_rank, department_bound)
    VALUES ($id, $name, $rank, 0)
    ON CONFLICT (id) DO NOTHING
    RETURNING id;
  `,
    { id: role.id, name: role.name, rank: role.rank },
  );
  if (inserted.length === 0) {
    return;
  }
  for (const permission of role.permissions) {
    await transaction.execute(
      "INSERT INTO role_permissions (role_id, permission) VALUES ($id, $permission);",
      { id: role.id, permission },
    );
  }
}
