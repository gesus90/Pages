import { afterEach, describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentScopeInUseError } from "@/backend/error/AdministrationError";
import {
  AgentAccessDeniedError,
  AgentInUseError,
} from "@/backend/error/AgentErrors";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { DepartmentAdministrationService } from "@/backend/service/DepartmentAdministrationService";
import { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";
import { AgentConnectionService } from "@/backend/service/agents/AgentConnectionService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { CAPABILITY } from "@/definition/Authorization";
import { EMPTY_AGENT_FILTERS } from "@/definition/AgentFilters";

import { createAccess, createRole } from "../helpers/authorization";
import {
  createExecutionPlanHarness,
  executionPlan,
  executionStep,
} from "../helpers/execution-plans";
import { createAssistantHarness } from "../helpers/text-assistant";
import { useMigratedDatabase } from "../helpers/test-database";

import type { Database } from "@/backend/database/Database";
import type {
  AgentProfileInput,
  AgentProfileTarget,
  AgentProfileTargetKind,
} from "@/definition/AgentProfile";
import type { ExecutionPlanHarness } from "../helpers/execution-plans";

function agentInput(
  scope: AgentProfileTargetKind,
  overrides: Partial<AgentProfileInput> = {},
): AgentProfileInput {
  const targets: readonly AgentProfileTarget[] = overrides.targets ?? [];
  return {
    name: `${scope} agent`,
    connectionId: "connection",
    model: "model-a",
    reasoningEffort: "medium",
    isActive: true,
    purposes: ["text"],
    targets,
    configuration: emptyAgentConfiguration(scope),
    ...overrides,
  };
}

async function setup(database: Database) {
  const harness = await createAssistantHarness(database);
  await harness.authorization.saveAccount(harness.admin);
  await harness.authorization.saveDepartment({
    id: "engineering",
    name: "Engineering",
  });
  const lead = await harness.wiki.addUser("lead", {
    departments: ["engineering"],
    capabilities: [CAPABILITY.MANAGE_USERS, CAPABILITY.MANAGE_DEPARTMENTS],
  });
  const leadRole = createRole({
    id: "role-lead",
    name: "Role lead",
    permissions: [CAPABILITY.MANAGE_USERS, CAPABILITY.MANAGE_DEPARTMENTS],
  });
  const leadAccess = createAccess({
    userId: lead.id,
    role: leadRole,
    departments: ["engineering"],
    managedDepartments: ["engineering"],
  });
  await harness.authorization.saveAccount(leadAccess);
  const bobAccess = createAccess({
    userId: harness.bob.id,
    role: createRole({ id: "role-bob", departmentBound: false }),
    departments: ["engineering"],
    managedDepartments: [],
  });
  if (bobAccess.role === null) throw new Error("Missing fixture role");
  await harness.authorization.saveRole(bobAccess.role);
  await harness.authorization.saveAccount(bobAccess);
  const groups = new UserGroupRepository(database);
  await groups.save({ id: "team", name: "Team", memberIds: [harness.bob.id] });
  return { ...harness, lead, leadAccess, groups };
}

describe("A11.3 central agent administration", () => {
  const getDatabase = useMigratedDatabase();

  it("resolves function, person and department assignments by priority without a silent fallback", async () => {
    const { profiles, admin, alice, bob, reader } = await setup(getDatabase());
    const personal = await profiles.save(
      admin,
      null,
      agentInput("person", {
        name: "Personal text",
        targets: [{ kind: "person", targetId: alice.id }],
      }),
    );
    const department = await profiles.save(
      admin,
      null,
      agentInput("department", {
        name: "Engineering text",
        targets: [{ kind: "department", targetId: "engineering" }],
      }),
    );
    const choices = async (userId: string): Promise<readonly string[]> =>
      (await profiles.choices(userId, "text")).map((choice) => choice.id);

    expect(await choices(alice.id)).toEqual([personal]);
    expect(await choices(bob.id)).toEqual([department]);
    expect(await choices(reader.id)).toEqual(["system-text"]);
    expect((await profiles.resolve(bob.id, "text")).model).toBe("model-a");

    const second = await profiles.save(
      admin,
      null,
      agentInput("department", {
        name: "Second engineering text",
        targets: [{ kind: "department", targetId: "engineering" }],
      }),
    );
    expect([...(await choices(bob.id))].sort()).toEqual(
      [department, second].sort(),
    );
    await expect(profiles.resolve(bob.id, "text")).rejects.toThrow(
      "profileSelectionRequired",
    );
    await expect(
      profiles.resolve(bob.id, "text", second),
    ).resolves.toMatchObject({ model: "model-a" });
    await expect(
      profiles.resolve(bob.id, "text", "system-text"),
    ).rejects.toThrow("accessDenied");
  });

  it("validates the scope on the server: system functions only with System, other scopes only with their own targets", async () => {
    const { profiles, admin, alice } = await setup(getDatabase());
    const invalid: readonly AgentProfileInput[] = [
      agentInput("person", {
        targets: [{ kind: "system", targetId: "text" }],
      }),
      agentInput("system", {
        targets: [{ kind: "person", targetId: alice.id }],
      }),
      agentInput("group", { targets: [] }),
    ];
    for (const input of invalid)
      await expect(profiles.save(admin, null, input)).rejects.toMatchObject({
        code: "profile_scope_invalid",
      });
    await expect(
      profiles.save(
        admin,
        null,
        agentInput("system", {
          purposes: ["agent"],
          targets: [{ kind: "system", targetId: "chat" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "profile_invalid" });
    await expect(
      profiles.save(
        admin,
        null,
        agentInput("system", {
          purposes: ["chat"],
          targets: [{ kind: "system", targetId: "chat" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "system_function_in_use" });
    const draft = await profiles.save(
      admin,
      null,
      agentInput("group", { isActive: false, targets: [] }),
    );
    expect(
      (await profiles.list(admin)).find((profile) => profile.id === draft),
    ).toMatchObject({ isActive: false, targets: [] });
  });

  it("filters the authorized list by search, scope, purpose, status and usability without changing access", async () => {
    const { profiles, admin, alice } = await setup(getDatabase());
    const personal = await profiles.save(
      admin,
      null,
      agentInput("person", {
        name: "Release notes",
        targets: [{ kind: "person", targetId: alice.id }],
      }),
    );
    const inactive = await profiles.save(
      admin,
      null,
      agentInput("department", {
        name: "Inactive department",
        isActive: false,
      }),
    );
    async function ids(
      filters: Partial<typeof EMPTY_AGENT_FILTERS>,
    ): Promise<readonly string[]> {
      return (
        await profiles.filteredList(admin, {
          ...EMPTY_AGENT_FILTERS,
          ...filters,
        })
      ).profiles.map((profile) => profile.id);
    }

    expect(await ids({ search: "release" })).toEqual([personal]);
    expect(await ids({ scope: "department" })).toEqual([inactive]);
    expect(await ids({ status: "inactive" })).toEqual([inactive]);
    expect(await ids({ purpose: "chat" })).toEqual(["system-text"]);
    expect(await ids({ usability: "blocked" })).toContain(inactive);
    const listed = await profiles.filteredList(admin, EMPTY_AGENT_FILTERS);
    expect(listed.availability[inactive]).toMatchObject({
      isUsable: false,
      reason: "agent_inactive",
    });
    expect(listed.profiles.map((profile) => profile.id)).toContain(inactive);
  });

  it("blocks deleting a used agent and returns the usage list", async () => {
    const { profiles, admin, alice } = await setup(getDatabase());
    const id = await profiles.save(
      admin,
      null,
      agentInput("person", {
        name: "Assigned",
        targets: [{ kind: "person", targetId: alice.id }],
      }),
    );

    const rejection = await profiles
      .remove(admin, id)
      .catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(AgentInUseError);
    expect(rejection).toMatchObject({
      code: "profile_in_use",
      usages: [
        { kind: "assignment", target: { kind: "person", targetId: alice.id } },
      ],
    });
    expect((await profiles.list(admin)).map((profile) => profile.id)).toContain(
      id,
    );
    const saved = (await profiles.list(admin)).find(
      (profile) => profile.id === id,
    );
    if (!saved) throw new Error("Missing saved agent");
    await profiles.save(admin, id, {
      ...saved,
      isActive: false,
      targets: [],
    });
    await profiles.remove(admin, id);
    expect(
      (await profiles.list(admin)).map((profile) => profile.id),
    ).not.toContain(id);
  });

  it("keeps a used connection and lists the agents that use it", async () => {
    const { admin, connections } = await setup(getDatabase());
    const cli = { describe: vi.fn(), cleanup: vi.fn() };
    const management = new AgentConnectionService({
      repository: connections,
      operations: new AgentOperationRegistry(),
      cipher: new InstanceSecretCipher(Buffer.alloc(32, 8)),
      cli,
    });

    const rejection = await management
      .remove(admin, "connection")
      .catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(AgentInUseError);
    expect(rejection).toMatchObject({
      code: "connection_in_use",
      usages: [{ kind: "agent", id: "system-text", name: "System Text" }],
    });
    expect(await connections.find("connection")).not.toBeNull();
    expect(cli.cleanup).not.toHaveBeenCalled();
  });

  it("keeps groups and departments that agents use as scope or usage share and names the agents only for administrators", async () => {
    const database = getDatabase();
    const { profiles, admin, authorization, lead } = await setup(database);
    const groupAgent = await profiles.save(
      admin,
      null,
      agentInput("group", {
        name: "Team agent",
        targets: [{ kind: "group", targetId: "team" }],
      }),
    );
    const shared = await profiles.save(admin, null, {
      ...agentInput("system", {
        name: "Shared template",
        purposes: ["agent"],
        targets: [{ kind: "system", targetId: "agent" }],
      }),
      configuration: {
        ...emptyAgentConfiguration("system"),
        sharing: {
          isGlobal: false,
          targets: [{ kind: "department", targetId: "engineering" }],
        },
      },
    });
    const cache = new ServerCache();
    const groups = new GroupAdministrationService(authorization, cache);
    const departments = new DepartmentAdministrationService(authorization);

    for (const [deletion, agents] of [
      [() => groups.deleteGroup(admin.userId, "team"), ["Team agent"]],
      [() => groups.deleteGroup(lead.id, "team"), []],
      [
        () => departments.deleteDepartment(admin.userId, "engineering"),
        ["Shared template"],
      ],
      [() => departments.deleteDepartment(lead.id, "engineering"), []],
    ] as const) {
      const rejection = await deletion().catch((error: unknown) => error);
      expect(rejection).toBeInstanceOf(AgentScopeInUseError);
      expect(rejection).toMatchObject({ code: "agentInUse", agents });
    }
    expect(
      await database.query("SELECT id FROM user_groups ORDER BY id;"),
    ).toEqual([["team"]]);
    expect(
      (await authorization.snapshot()).departments.map(
        (department) => department.id,
      ),
    ).toContain("engineering");

    for (const id of [groupAgent, shared]) {
      const saved = (await profiles.list(admin)).find(
        (profile) => profile.id === id,
      );
      if (!saved?.configuration) throw new Error("Missing saved agent");
      await profiles.save(admin, id, {
        ...saved,
        isActive: false,
        targets: [],
        configuration: {
          ...saved.configuration,
          sharing: { isGlobal: false, targets: [] },
        },
      });
    }
    await groups.deleteGroup(lead.id, "team");
    await departments.deleteDepartment(lead.id, "engineering");
    expect(await database.query("SELECT id FROM user_groups;")).toEqual([]);
  });

  it("rejects management calls from team leaders and from administrators outside admin mode", async () => {
    const { profiles, admin, alice, leadAccess, authorization } =
      await setup(getDatabase());
    const id = await profiles.save(
      admin,
      null,
      agentInput("department", {
        name: "Engineering text",
        targets: [{ kind: "department", targetId: "engineering" }],
      }),
    );
    async function expectRejected(actor: typeof admin): Promise<void> {
      await expect(profiles.list(actor)).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
      await expect(profiles.directory(actor)).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
      await expect(profiles.usages(actor, id)).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
      await expect(
        profiles.save(
          actor,
          null,
          agentInput("department", {
            targets: [{ kind: "department", targetId: "engineering" }],
          }),
        ),
      ).rejects.toBeInstanceOf(AgentAccessDeniedError);
      await expect(profiles.remove(actor, id)).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
    }
    await expectRejected(leadAccess);
    // The service rereads persisted account facts, so the role mode must be stored.
    const roleMode = { ...admin, mode: "role" as const };
    await authorization.saveAccount(roleMode);
    await expectRejected(roleMode);
    expect(await profiles.choices(leadAccess.userId, "text")).toEqual([
      expect.objectContaining({ id }),
    ]);
    expect(await profiles.choices(alice.id, "text")).toEqual([
      expect.objectContaining({ id: "system-text" }),
    ]);
  });
});

describe("A11.3 tickets assigned through execution plans", () => {
  const getDatabase = useMigratedDatabase();
  let harness: ExecutionPlanHarness | undefined;
  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  it("lists each bound ticket once per agent, omits unreadable tickets and stays administrator-only", async () => {
    harness = await createExecutionPlanHarness(getDatabase());
    const current = harness;
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        nodes: [
          executionStep("A", current.agentId, {
            input: { kind: "source", nodeId: "ticket" },
          }),
          executionStep("B", current.agentId, {
            input: { kind: "source", nodeId: "ticket" },
          }),
          executionStep("C", current.agentId),
          { id: "ticket", type: "task", taskId: current.task.id, x: 0, y: 0 },
          {
            id: "unbound",
            type: "task",
            taskId: current.subtask.id,
            x: 0,
            y: 40,
          },
        ],
      }),
    );

    expect(await current.service.taskAssignments(current.admin)).toEqual({
      [current.agentId]: [
        {
          planId,
          planName: "Build",
          taskId: current.task.id,
          key: current.task.key,
          title: "Implement worker",
        },
      ],
    });
    vi.spyOn(current.tasks, "findAll").mockResolvedValueOnce([]);
    expect(await current.service.taskAssignments(current.admin)).toEqual({});
    for (const actor of [
      { ...current.admin, mode: "role" as const },
      createAccess({ userId: current.bob.id }),
    ])
      await expect(
        current.service.taskAssignments(actor),
      ).rejects.toBeInstanceOf(AgentAccessDeniedError);
  });
});
