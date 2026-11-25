import { beforeEach, describe, expect, it, vi } from "vitest";

import { withManagementAudit } from "@/backend/database/ManagementAuditContext";
import { ADMINISTRATION_ROLE_ID } from "@/definition/Authorization";

import { ManagementAudit } from "./ManagementAudit";

import type { ManagementDatabase } from "./ManagementContext";
import type { AccountAccess } from "@/definition/Authorization";

const state = vi.hoisted(() => ({
  accounts: [] as unknown[],
  record: vi.fn(async () => undefined),
  list: vi.fn(async () => ["entry"]),
}));

vi.mock("@/backend/database/repositories/AuthorizationRepository", () => ({
  AuthorizationRepository: class {
    public snapshot = async (): Promise<{ accounts: unknown[] }> => ({
      accounts: state.accounts,
    });
  },
}));
vi.mock("@/backend/database/repositories/ManagementAuditRepository", () => ({
  ManagementAuditRepository: class {
    public record = state.record;
    public list = state.list;
  },
}));

function accountOf(overrides: Partial<AccountAccess>): AccountAccess {
  return {
    userId: "u",
    role: {
      id: "role-1",
      name: "R",
      rank: 1,
      departmentBound: true,
      permissions: [],
    },
    isAdmin: false,
    mode: "role",
    firstName: "A",
    lastName: "B",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: true,
    ...overrides,
  };
}

const management = accountOf({
  userId: "m",
  role: {
    id: ADMINISTRATION_ROLE_ID,
    name: "M",
    rank: 9,
    departmentBound: false,
    permissions: [],
  },
});
const administrator = accountOf({ userId: "a", isAdmin: true, mode: "admin" });

function databaseOf(): {
  runCall: ReturnType<typeof vi.fn>;
  database: ManagementDatabase;
} {
  const runCall = vi.fn(
    async (
      work: () => Promise<unknown>,
      after: (context: { transaction: unknown }) => Promise<void>,
    ) => {
      const result = await work();
      await after({ transaction: {} });
      return result;
    },
  );
  return { runCall, database: { runCall } as unknown as ManagementDatabase };
}

beforeEach(() => {
  state.accounts = [management, administrator, accountOf({ userId: "p" })];
  state.record.mockClear();
});

describe("ManagementAudit.run", () => {
  it("runs directly inside an audited call", async () => {
    const { database, runCall } = databaseOf();
    const result = await withManagementAudit("m", () =>
      new ManagementAudit(database).run("m", "act", "t", async () => 1),
    );
    expect(result).toBe(1);
    expect(runCall).not.toHaveBeenCalled();
  });

  it("runs directly for unknown actors and non-management", async () => {
    const { database, runCall } = databaseOf();
    const audit = new ManagementAudit(database);
    expect(await audit.run("missing", "act", "t", async () => 2)).toBe(2);
    expect(await audit.run("p", "act", "t", async () => 3)).toBe(3);
    expect(runCall).not.toHaveBeenCalled();
  });

  it("records an audit row together with management work", async () => {
    const { database } = databaseOf();
    const result = await new ManagementAudit(database).run(
      "m",
      "act",
      "target",
      async () => 4,
    );
    expect(result).toBe(4);
    expect(state.record).toHaveBeenCalledWith("m", "act", "target");
  });
});

describe("ManagementAudit.list", () => {
  it("lists for administrators", async () => {
    const { database } = databaseOf();
    expect(await new ManagementAudit(database).list("a")).toEqual(["entry"]);
  });

  it("refuses unknown actors and non-administrators", async () => {
    const { database } = databaseOf();
    const audit = new ManagementAudit(database);
    await expect(audit.list("missing")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(audit.list("m")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
