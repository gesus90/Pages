import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleUsersAction } from "@/app/lib/user-actions/user-actions.server";
import {
  AdministrationError,
  AgentScopeInUseError,
} from "@/backend/error/AdministrationError";

import {
  ACTOR,
  callArgument,
  formOf,
  outcomeOf,
  servicesOf,
} from "./action-fixtures";

import type { ActionOutcome, FormFields } from "./action-fixtures";

const administration = {
  saveRole: vi.fn(),
  deleteRole: vi.fn(),
  saveDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
  setMemberships: vi.fn(),
  setScope: vi.fn(),
  setAdministrator: vi.fn(),
};
const groups = { saveGroup: vi.fn(), deleteGroup: vi.fn() };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

beforeEach(() => {
  vi.resetAllMocks();
});

async function submit(
  intent: string,
  fields: FormFields,
): Promise<ActionOutcome> {
  const formData = formOf({ intent, ...fields });

  return outcomeOf(
    await handleUsersAction(formData.get("intent"), {
      actor: ACTOR,
      formData,
      services: servicesOf({
        administrationService: administration,
        groupAdministrationService: groups,
      }),
    }),
  );
}

function nothingCalled(): void {
  for (const service of [
    ...Object.values(administration),
    ...Object.values(groups),
  ]) {
    expect(service).not.toHaveBeenCalled();
  }
}

describe("save-role", () => {
  const fields = {
    entityId: " role-1 ",
    name: " Lead ",
    rank: "5",
    departmentBound: "true",
    permission: ["write", "milestones"],
  };

  it("saves the role with the trusted capabilities", async () => {
    const outcome = await submit("save-role", fields);

    expect(outcome.body).toEqual({ intent: "save-role", ok: true });
    expect(administration.saveRole).toHaveBeenCalledExactlyOnceWith(ACTOR.id, {
      id: "role-1",
      name: "Lead",
      rank: 5,
      departmentBound: true,
      permissions: ["write", "milestones"],
    });
  });

  it("creates a new identifier when the form names none", async () => {
    await submit("save-role", { ...fields, entityId: "" });

    const saved = callArgument(administration.saveRole, 0, 1);

    expect(saved).toMatchObject({ name: "Lead" });
    expect(saved).toHaveProperty("id", expect.stringMatching(UUID));
  });

  it("binds to departments only for the literal true", async () => {
    await submit("save-role", { ...fields, departmentBound: "1" });

    expect(administration.saveRole.mock.calls[0]?.[1]).toMatchObject({
      departmentBound: false,
    });
  });

  it.each([
    ["an unknown capability", { permission: ["write", "root"] }],
    ["an inherited property name", { permission: ["constructor"] }],
    ["a file as capability", { permission: new File(["write"], "write") }],
    ["no rank", { rank: "" }],
    ["a blank rank", { rank: "   " }],
    ["a file as name", { name: new File(["x"], "x") }],
  ])("rejects %s without saving", async (caseName, change) => {
    const outcome = await submit("save-role", { ...fields, ...change });

    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual({
      ok: false,
      intent: "save-role",
      error: "invalidInput",
    });
    nothingCalled();
  });

  it("answers forbidden when the service refuses the actor", async () => {
    administration.saveRole.mockRejectedValue(
      new AdministrationError("forbidden"),
    );

    const outcome = await submit("save-role", fields);

    expect(outcome.status).toBe(403);
    expect(outcome.body).toMatchObject({ error: "forbidden" });
  });
});

describe("deleting entities", () => {
  it("deletes a role by its trimmed identifier", async () => {
    const outcome = await submit("delete-role", { entityId: " role-1 " });

    expect(outcome.body).toEqual({ intent: "delete-role", ok: true });
    expect(administration.deleteRole).toHaveBeenCalledWith(ACTOR.id, "role-1");
  });

  it("reports a role that is still in use", async () => {
    administration.deleteRole.mockRejectedValue(
      new AdministrationError("inUse"),
    );

    const outcome = await submit("delete-role", { entityId: "role-1" });

    expect(outcome.status).toBe(409);
    expect(outcome.body).toMatchObject({ error: "inUse" });
  });

  it("deletes a department and lists agents that block it", async () => {
    administration.deleteDepartment.mockRejectedValue(
      new AgentScopeInUseError(["Agent A"]),
    );

    const outcome = await submit("delete-department", { entityId: "d1" });

    expect(outcome.status).toBe(409);
    expect(outcome.body).toEqual({
      ok: false,
      intent: "delete-department",
      error: "agentInUse",
      agents: ["Agent A"],
    });
  });

  it("deletes a group through the group service", async () => {
    await submit("delete-group", { entityId: "g1" });

    expect(groups.deleteGroup).toHaveBeenCalledWith(ACTOR.id, "g1");
    expect(administration.deleteRole).not.toHaveBeenCalled();
  });

  it("rejects a file as identifier", async () => {
    const outcome = await submit("delete-group", {
      entityId: new File(["g1"], "g1"),
    });

    expect(outcome.status).toBe(400);
    nothingCalled();
  });
});

describe("saving departments and groups", () => {
  it("saves a department with a new identifier", async () => {
    await submit("save-department", { entityId: "", name: " Sales " });

    const saved = callArgument(administration.saveDepartment, 0, 1);

    expect(saved).toMatchObject({ name: "Sales" });
    expect(saved).toHaveProperty("id", expect.stringMatching(UUID));
  });

  it("saves a group with its members", async () => {
    const outcome = await submit("save-group", {
      entityId: "g1",
      name: "Core",
      member: ["u1", "u2"],
    });

    expect(outcome.body).toEqual({ intent: "save-group", ok: true });
    expect(groups.saveGroup).toHaveBeenCalledWith(ACTOR.id, {
      id: "g1",
      memberIds: ["u1", "u2"],
      name: "Core",
    });
  });

  it("saves a new group with a generated identifier", async () => {
    const outcome = await submit("save-group", { entityId: " ", name: "Ops" });

    expect(outcome.body).toEqual({ intent: "save-group", ok: true });
    const saved = callArgument(groups.saveGroup, 0, 1);

    expect(saved).toMatchObject({ memberIds: [], name: "Ops" });
    expect(saved).toHaveProperty("id", expect.stringMatching(UUID));
  });

  it("rejects a file among the members", async () => {
    const outcome = await submit("save-group", {
      name: "Core",
      member: new File(["u1"], "u1"),
    });

    expect(outcome.status).toBe(400);
    expect(groups.saveGroup).not.toHaveBeenCalled();
  });
});

describe("user assignments", () => {
  it("sets the department memberships of a user", async () => {
    await submit("set-memberships", { userId: " u1 ", department: ["d1"] });

    expect(administration.setMemberships).toHaveBeenCalledWith(ACTOR.id, "u1", [
      "d1",
    ]);
  });

  it("sets the scope with explicit flags only", async () => {
    await submit("set-scope", {
      userId: "u1",
      department: ["d1", "d2"],
      allDepartments: "true",
      allProjects: "false",
    });

    expect(administration.setScope).toHaveBeenCalledWith(ACTOR.id, "u1", {
      managedDepartments: ["d1", "d2"],
      allDepartments: true,
      allProjects: false,
    });
  });

  it.each([
    ["true", true],
    ["false", false],
    ["", false],
    ["TRUE", false],
  ])("sets administrator to %j as %s", async (value, expected) => {
    await submit("set-admin", { userId: "u1", isAdmin: value });

    expect(administration.setAdministrator).toHaveBeenCalledWith(
      ACTOR.id,
      "u1",
      expected,
    );
  });

  it("does not remove the last administrator", async () => {
    administration.setAdministrator.mockRejectedValue(
      new AdministrationError("lastAdministrator"),
    );

    const outcome = await submit("set-admin", { userId: "u1" });

    expect(outcome.status).toBe(409);
    expect(outcome.body).toMatchObject({ error: "lastAdministrator" });
  });

  it("rethrows a failure that is none of the known ones", async () => {
    administration.setScope.mockRejectedValue(new Error("disk full"));

    await expect(submit("set-scope", { userId: "u1" })).rejects.toThrow(
      "disk full",
    );
  });
});
