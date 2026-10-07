import {
  readBooleanColumn,
  readNullableTextColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isCapability } from "@/definition/Authorization";
import { UserRepository } from "./UserRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type {
  AccountAccess,
  Department,
  UserRole,
} from "@/definition/Authorization";

/** SQL operations usable either directly or under the aggregate transaction. */
type AuthorizationDatabase = Pick<
  Database,
  "query" | "execute" | "transaction"
>;

/** Complete authorization state, never accepted from the client. */
export interface AuthorizationSnapshot {
  readonly roles: readonly UserRole[];
  readonly departments: readonly Department[];
  readonly accounts: readonly AccountAccess[];
}

/** Stores the A2 aggregate and serializes policy checks with their mutations. */
export class AuthorizationRepository {
  private readonly database: AuthorizationDatabase;

  /** Binds the repository to its database or already locked transaction. */
  public constructor(database: AuthorizationDatabase) {
    this.database = database;
  }

  /** Runs authorization reads and the resulting writes without interleaving. */
  public async transaction<Result>(
    work: (repository: AuthorizationRepository) => Promise<Result>,
  ): Promise<Result> {
    return this.database.transaction((transaction) =>
      work(
        new AuthorizationRepository({
          query: transaction.query.bind(transaction),
          execute: transaction.execute.bind(transaction),
          transaction: async <Nested>(
            operation: (scope: DatabaseTransaction) => Promise<Nested>,
          ): Promise<Nested> => operation(transaction),
        }),
      ),
    );
  }

  /** Shares user persistence inside the current aggregate transaction. */
  public users(): UserRepository {
    return new UserRepository(this.database);
  }

  /** Restores admin mode for a personally authorized setup account without altering its role. */
  public async activateAdministrator(userId: string): Promise<void> {
    await this.database.execute(
      `
      UPDATE user_authorization
      SET active_mode = 'admin'
      WHERE user_id = $id
          AND is_admin = 1;
    `,
      { id: userId },
    );
  }

  /** Loads a current policy snapshot; callers must filter it before serialization. */
  public async snapshot(): Promise<AuthorizationSnapshot> {
    return this.transaction((repository) => repository.readSnapshot());
  }

  /** Inserts or updates a role and replaces its permission set atomically with its caller. */
  public async saveRole(role: UserRole): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO roles (id, name, hierarchy_rank, department_bound)
      VALUES ($id, $name, $rank, $bound)
      ON CONFLICT (id) DO UPDATE SET
          name = excluded.name,
          hierarchy_rank = excluded.hierarchy_rank,
          department_bound = excluded.department_bound;
    `,
      {
        id: role.id,
        name: role.name,
        rank: role.rank,
        bound: role.departmentBound,
      },
    );
    await this.database.execute(
      "DELETE FROM role_permissions WHERE role_id = $id;",
      { id: role.id },
    );
    for (const permission of new Set(role.permissions)) {
      await this.database.execute(
        "INSERT INTO role_permissions (role_id, permission) VALUES ($id, $permission);",
        { id: role.id, permission },
      );
    }
  }

  /** Removes an unassigned role after service validation. */
  public async deleteRole(id: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM role_permissions WHERE role_id = $id;",
      { id },
    );
    await this.database.execute("DELETE FROM roles WHERE id = $id;", { id });
  }

  /** Saves a named department without granting action rights to its members. */
  public async saveDepartment(department: Department): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO departments (id, name) VALUES ($id, $name)
      ON CONFLICT (id) DO UPDATE SET name = excluded.name;
    `,
      { id: department.id, name: department.name },
    );
  }

  /** Deleting a department is the permitted exception to the final-membership rule. */
  public async deleteDepartment(id: string): Promise<void> {
    await this.database.execute(
      "UPDATE work_items SET department_id = NULL WHERE department_id = $id;",
      { id },
    );
    await this.database.execute(
      "DELETE FROM department_members WHERE department_id = $id;",
      { id },
    );
    await this.database.execute(
      "DELETE FROM managed_departments WHERE department_id = $id;",
      { id },
    );
    await this.database.execute(
      "DELETE FROM project_departments WHERE department_id = $id;",
      { id },
    );
    await this.database.execute("DELETE FROM departments WHERE id = $id;", {
      id,
    });
  }

  /** Persists current account authorization; the historical membership flag is sticky. */
  public async saveAccount(account: AccountAccess): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO user_authorization (
          user_id, role_id, is_admin, active_mode, first_name, last_name,
          all_departments, all_projects, has_had_department
      ) VALUES ($id, $role, $admin, $mode, $first, $last, $all_departments, $all_projects, $had_department)
      ON CONFLICT (user_id) DO UPDATE SET
          role_id = excluded.role_id,
          is_admin = excluded.is_admin,
          active_mode = excluded.active_mode,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          all_departments = excluded.all_departments,
          all_projects = excluded.all_projects,
          has_had_department = greatest(user_authorization.has_had_department, excluded.has_had_department);
    `,
      {
        id: account.userId,
        role: account.role?.id ?? null,
        admin: account.isAdmin,
        mode: account.mode,
        first: account.firstName,
        last: account.lastName,
        all_departments: account.allDepartments,
        all_projects: account.allProjects,
        had_department:
          account.hasHadDepartment || account.departments.length > 0,
      },
    );
    await this.replaceMemberships(account);
  }

  private async readSnapshot(): Promise<AuthorizationSnapshot> {
    const roles = await this.readRoles();
    const departments = await this.database.query(
      "SELECT id, name FROM departments ORDER BY name;",
    );
    const memberships = await this.database.query(
      "SELECT user_id, department_id FROM department_members;",
    );
    const management = await this.database.query(
      "SELECT user_id, department_id FROM managed_departments;",
    );
    const accounts = await this.database.query(`
      SELECT
          access.user_id,
          access.role_id,
          access.is_admin,
          access.active_mode,
          access.first_name,
          access.last_name,
          users.is_active,
          access.all_departments,
          access.all_projects,
          access.has_had_department
      FROM user_authorization AS access
      INNER JOIN users ON users.id = access.user_id;
    `);
    return {
      roles,
      departments: departments.map((row) => ({
        id: readTextColumn(row, 0, "id"),
        name: readTextColumn(row, 1, "name"),
      })),
      accounts: accounts.map((row) => {
        const userId = readTextColumn(row, 0, "user_id");
        const roleId = readNullableTextColumn(row, 1, "role_id");
        const role = roles.find((candidate) => candidate.id === roleId) ?? null;
        const mode = readTextColumn(row, 3, "active_mode");
        if (
          (roleId !== null && role === null) ||
          (mode !== "admin" && mode !== "role")
        ) {
          throw new Error("Invalid account authorization reference.");
        }
        return {
          userId,
          role,
          mode,
          isAdmin: readBooleanColumn(row, 2, "is_admin"),
          firstName: readTextColumn(row, 4, "first_name"),
          lastName: readTextColumn(row, 5, "last_name"),
          isActive: readBooleanColumn(row, 6, "is_active"),
          allDepartments: readBooleanColumn(row, 7, "all_departments"),
          allProjects: readBooleanColumn(row, 8, "all_projects"),
          hasHadDepartment: readBooleanColumn(row, 9, "has_had_department"),
          departments: memberships
            .filter((member) => member[0] === userId)
            .map((member) => readTextColumn(member, 1, "department_id")),
          managedDepartments: management
            .filter((member) => member[0] === userId)
            .map((member) => readTextColumn(member, 1, "department_id")),
        };
      }),
    };
  }

  private async replaceMemberships(account: AccountAccess): Promise<void> {
    await this.database.execute(
      "DELETE FROM department_members WHERE user_id = $id;",
      { id: account.userId },
    );
    for (const department of new Set(account.departments)) {
      await this.database.execute(
        "INSERT INTO department_members (user_id, department_id) VALUES ($id, $department);",
        { id: account.userId, department },
      );
    }
    await this.database.execute(
      "DELETE FROM managed_departments WHERE user_id = $id;",
      { id: account.userId },
    );
    for (const department of new Set(account.managedDepartments)) {
      await this.database.execute(
        "INSERT INTO managed_departments (user_id, department_id) VALUES ($id, $department);",
        { id: account.userId, department },
      );
    }
  }

  private async readRoles(): Promise<UserRole[]> {
    const rows = await this.database.query(
      "SELECT id, name, hierarchy_rank, department_bound FROM roles ORDER BY hierarchy_rank DESC, name;",
    );
    const permissions = await this.database.query(
      "SELECT role_id, permission FROM role_permissions;",
    );
    return rows.map((row) => {
      const id = readTextColumn(row, 0, "id");
      return {
        id,
        name: readTextColumn(row, 1, "name"),
        rank: readCountColumn(row, 2, "hierarchy_rank"),
        departmentBound: readBooleanColumn(row, 3, "department_bound"),
        permissions: permissions
          .filter((permission) => permission[0] === id)
          .map((permission) => {
            const capability = readTextColumn(permission, 1, "permission");
            if (!isCapability(capability)) {
              throw new Error("Invalid stored capability.");
            }
            return capability;
          }),
      };
    });
  }
}
