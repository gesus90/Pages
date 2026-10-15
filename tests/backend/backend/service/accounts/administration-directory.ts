import { CAPABILITY } from "@/definition/Authorization";

import { AuthorizationWorld } from "./authorization-world";

/**
 * A small organization for the administration service.
 *
 * @remarks
 * - `admin`: administrator in administrator mode, no role.
 * - `hr`: rank 5, manages users and roles, works in sales.
 * - `lead`: rank 4, manages departments and users, manages sales.
 * - `emp-sales`, `emp-legal`: plain employees of one department each.
 * - `loose`: employee without department.
 * - `writer`: may only write, no management capability.
 */
export function organizationWorld(): AuthorizationWorld {
  const world = new AuthorizationWorld();
  world.addDepartment("sales", "Sales");
  world.addDepartment("legal", "Legal");
  world.addAdministrator({ email: "admin@example.test" });
  world.addAccount({
    userId: "hr",
    roleId: "role-hr",
    rank: 5,
    permissions: [
      CAPABILITY.WRITE,
      CAPABILITY.MANAGE_USERS,
      CAPABILITY.MANAGE_ROLES,
    ],
    departments: ["sales"],
    email: "hr@example.test",
  });
  world.addAccount({
    userId: "lead",
    roleId: "role-lead",
    rank: 4,
    permissions: [
      CAPABILITY.WRITE,
      CAPABILITY.MANAGE_USERS,
      CAPABILITY.MANAGE_DEPARTMENTS,
    ],
    departments: ["sales"],
    managedDepartments: ["sales"],
  });
  world.addAccount({
    userId: "emp-sales",
    roleId: "role-employee",
    departments: ["sales"],
    hasHadDepartment: true,
    email: "sales@example.test",
  });
  world.addAccount({
    userId: "emp-legal",
    roleId: "role-legal",
    departments: ["legal"],
    hasHadDepartment: true,
  });
  world.addAccount({ userId: "loose", roleId: "role-employee" });
  world.addAccount({
    userId: "writer",
    roleId: "role-writer",
    permissions: [CAPABILITY.WRITE],
  });

  return world;
}
