import { describe, expect, it } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";

import {
  canManageRemoteConnections,
  canManageRemoteProject,
  canOpenRemoteConsole,
  canReadRemoteProject,
  canUseRemoteConnection,
  requireRemoteAccount,
} from "./RemoteAccess";

import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { Project } from "@/definition/Project";

function accountOf(overrides: Partial<AccountAccess> = {}): AccountAccess {
  return {
    userId: "user-1",
    role: {
      id: "role-1",
      name: "Member",
      rank: 1,
      departmentBound: true,
      permissions: [],
    },
    isAdmin: false,
    mode: "role",
    firstName: "A",
    lastName: "B",
    isActive: true,
    departments: ["dep-1"],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: true,
    ...overrides,
  };
}

function projectOf(departmentIds: readonly string[]): Project {
  return {
    id: "project-1",
    departments: departmentIds.map((id) => ({ id, name: id })),
  } as unknown as Project;
}

function snapshotOf(accounts: readonly AccountAccess[]): AuthorizationSnapshot {
  return { roles: [], departments: [], accounts };
}

describe("requireRemoteAccount", () => {
  it("returns the active account and applies the channel", () => {
    const admin = accountOf({ isAdmin: true, mode: "role" });
    const snapshot = snapshotOf([admin]);
    expect(requireRemoteAccount(snapshot, "user-1").mode).toBe("role");
    expect(requireRemoteAccount(snapshot, "user-1", "mcp").mode).toBe("admin");
  });

  it("refuses unknown and inactive accounts", () => {
    const snapshot = snapshotOf([accountOf({ isActive: false })]);
    expect(() => requireRemoteAccount(snapshot, "user-1")).toThrow(RemoteError);
    expect(() => requireRemoteAccount(snapshot, "other")).toThrow(
      "remote_access_denied",
    );
  });
});

describe("remote connection rights", () => {
  const admin = accountOf({ isAdmin: true, mode: "admin", departments: [] });
  const member = accountOf();

  it("lets only administrators manage connections", () => {
    expect(canManageRemoteConnections(admin)).toBe(true);
    expect(canManageRemoteConnections(member)).toBe(false);
  });

  it("lets administrators and department members use a connection", () => {
    expect(canUseRemoteConnection(admin, "dep-1")).toBe(true);
    expect(canUseRemoteConnection(member, "dep-1")).toBe(true);
    expect(canUseRemoteConnection(member, "dep-2")).toBe(false);
    expect(
      canUseRemoteConnection(accountOf({ isActive: false }), "dep-1"),
    ).toBe(false);
  });

  it("needs the membership itself for a console", () => {
    expect(canOpenRemoteConsole(admin, "dep-1")).toBe(false);
    expect(canOpenRemoteConsole(member, "dep-1")).toBe(true);
    expect(canOpenRemoteConsole(accountOf({ isActive: false }), "dep-1")).toBe(
      false,
    );
  });
});

describe("remote project rights", () => {
  const member = accountOf();

  it("reads a project of the own department", () => {
    expect(canReadRemoteProject(member, projectOf(["dep-1"]))).toBe(true);
    expect(canReadRemoteProject(member, projectOf(["dep-2"]))).toBe(false);
  });

  it("manages only with project responsibility", () => {
    expect(canManageRemoteProject(member, projectOf(["dep-1"]), true)).toBe(
      true,
    );
    expect(canManageRemoteProject(member, projectOf(["dep-1"]), false)).toBe(
      false,
    );
    expect(canManageRemoteProject(member, projectOf(["dep-2"]), true)).toBe(
      false,
    );
  });
});
