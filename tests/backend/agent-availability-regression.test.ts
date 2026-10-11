import { afterEach, describe, expect, it, vi } from "vitest";

import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentAvailabilityService } from "@/backend/service/agents/AgentAvailabilityService";
import { AgentContentAccess } from "@/backend/service/agents/AgentContentAccess";
import { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { EMPTY_AGENT_FILTERS } from "@/definition/AgentFilters";

import { createExecutionPlanHarness } from "../helpers/execution-plans";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AgentProfile } from "@/definition/AgentProfile";
import type { ExecutionPlanHarness } from "../helpers/execution-plans";

describe("A10 availability and personal replacement authorization regression", () => {
  const getDatabase = useMigratedDatabase();
  let harness: ExecutionPlanHarness | undefined;
  afterEach(async () => {
    await harness?.dispose();
  });
  async function setup() {
    harness = await createExecutionPlanHarness(getDatabase());
    const current = harness;
    const dependencies = {
      profiles: current.profileRepository,
      connections: current.connections,
      authorization: current.authorization,
      groups: new UserGroupRepository(getDatabase()),
      operations: new AgentOperationRegistry(),
      workspaces: current.workspaces,
      content: new AgentContentAccess(
        current.projects,
        current.wiki.repository,
      ),
    };
    const base: AgentProfile = {
      ...current.agentInput,
      id: "template",
      revision: 1,
      configuration: {
        ...emptyAgentConfiguration("person"),
        sharing: { isGlobal: true, targets: [] },
      },
      targets: [{ kind: "person", targetId: current.alice.id }],
    };
    return {
      current,
      dependencies,
      base,
      availability: new AgentAvailabilityService(dependencies),
    };
  }

  it("filters by current project and usage, preserves blocked choices and denies nonadministrator inspection", async () => {
    const { current, base, availability } = await setup();
    await current.wiki.addProject("other");
    vi.spyOn(current.profileRepository, "list").mockResolvedValue([
      { ...base, id: "non-agent", purposes: ["text"] },
      {
        ...base,
        id: "private",
        configuration: {
          ...emptyAgentConfiguration("system"),
          sharing: { isGlobal: false, targets: [] },
        },
      },
      {
        ...base,
        id: "wrong-project",
        configuration: {
          ...emptyAgentConfiguration("system"),
          projectId: "other",
          sharing: { isGlobal: true, targets: [] },
        },
      },
      {
        ...base,
        id: "gone-project",
        configuration: {
          ...emptyAgentConfiguration("system"),
          projectId: "missing",
          sharing: { isGlobal: true, targets: [] },
        },
      },
      {
        ...base,
        id: "missing-connection",
        connectionId: "missing",
        revision: undefined,
      },
      { ...base, id: "legacy", configuration: undefined },
    ]);
    const catalog = await availability.catalog(current.bob.id, "project");
    expect(catalog.map((entry) => entry.id)).toEqual(["missing-connection"]);
    expect(catalog[0]).toMatchObject({
      provider: null,
      revision: 1,
      availability: { isUsable: false, reason: "personal_access_missing" },
    });
    await expect(availability.inspect(current.bob.id)).rejects.toMatchObject({
      code: "accessDenied",
    });
    await expect(availability.catalog("missing")).rejects.toMatchObject({
      code: "accessDenied",
    });
    await expect(
      availability.resolve(current.bob.id, {
        agentId: "non-agent",
        personalAgentId: null,
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
  });

  it("distinguishes inactive definitions, invalid parameters, absent sharing and unauthorized shared access", async () => {
    const { current, base, availability } = await setup();
    const shared = {
      ...base,
      configuration: {
        ...emptyAgentConfiguration("system"),
        sharing: { isGlobal: true, targets: [] },
      },
      targets: [],
    };
    vi.spyOn(current.profileRepository, "list").mockResolvedValue([
      { ...base, id: "inactive", isActive: false },
      {
        ...base,
        id: "invalid",
        configuration: {
          ...base.configuration,
          ...emptyAgentConfiguration("system"),
          markdown: "{{undeclared}}",
          sharing: { isGlobal: true, targets: [] },
        },
      },
      { ...base, id: "non-agent-unassigned", purposes: ["text"], targets: [] },
      {
        ...base,
        id: "non-agent-assigned",
        purposes: ["text"],
        targets: [{ kind: "system", targetId: "text" }],
      },
      { ...shared, id: "shared-denied" },
      {
        ...base,
        id: "unshared",
        configuration: {
          ...emptyAgentConfiguration("system"),
          sharing: { isGlobal: false, targets: [] },
        },
      },
    ]);
    const inspected = await availability.inspect(current.alice.id);
    expect(inspected).toMatchObject({
      inactive: { reason: "agent_inactive" },
      invalid: { reason: "parameter_invalid" },
      "non-agent-unassigned": { reason: "agent_usage_denied" },
      "non-agent-assigned": { isUsable: true },
      "shared-denied": { reason: "agent_usage_denied" },
      unshared: { reason: "agent_usage_denied" },
    });
    for (const [agentId, code] of [
      ["inactive", "agent_inactive"],
      ["invalid", "parameter_invalid"],
      ["shared-denied", "agent_usage_denied"],
    ])
      await expect(
        availability.resolve(current.bob.id, {
          agentId,
          personalAgentId: null,
          projectId: null,
        }),
      ).rejects.toMatchObject({ code });
    await expect(
      availability.resolve(current.bob.id, {
        agentId: "shared-denied",
        personalAgentId: "forged",
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
  });

  it("selects only compatible personal access and rejects unavailable or forged explicit selections", async () => {
    const { current, base, availability } = await setup();
    const own: AgentProfile = {
      ...base,
      id: "own",
      name: "Bob access",
      configuration: emptyAgentConfiguration("person"),
      targets: [{ kind: "person", targetId: current.bob.id }],
    };
    const list = vi.spyOn(current.profileRepository, "list").mockResolvedValue([
      base,
      own,
      { ...own, id: "wrong-model", model: "other" },
      { ...own, id: "wrong-effort", reasoningEffort: "low" },
      {
        ...own,
        id: "wrong-project",
        configuration: {
          ...emptyAgentConfiguration("person"),
          projectId: "another",
        },
      },
      { ...own, id: "lost-connection", connectionId: "lost" },
      { ...own, id: "different-provider", connectionId: "different" },
    ]);
    const connection = await current.connections.find("connection");
    if (!connection) throw new Error("Missing connection fixture");
    const find = current.connections.find.bind(current.connections);
    vi.spyOn(current.connections, "find").mockImplementation(async (id) =>
      id === "different"
        ? { ...connection, id, provider: "codex_cli" }
        : find(id),
    );
    const catalog = await availability.catalog(current.bob.id);
    expect(catalog[0].availability.personalChoices).toEqual([
      {
        id: "own",
        name: "Bob access",
        model: "model-a",
        reasoningEffort: "medium",
      },
    ]);
    expect(
      (
        await availability.resolve(current.bob.id, {
          agentId: base.id,
          personalAgentId: "own",
          projectId: null,
        })
      ).accessAgentId,
    ).toBe("own");
    await expect(
      availability.resolve(current.bob.id, {
        agentId: base.id,
        personalAgentId: "forged",
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: "personal_access_missing" });
    list.mockResolvedValue([base, { ...own, connectionId: "missing" }]);
    await expect(
      availability.resolve(current.bob.id, {
        agentId: base.id,
        personalAgentId: null,
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: "personal_access_missing" });
    vi.mocked(current.connections.find).mockRejectedValueOnce(
      new Error("storage failure"),
    );
    await expect(availability.catalog(current.bob.id)).rejects.toThrow(
      "storage failure",
    );
  });

  it("propagates native authorization failures and supports installations without optional reference services", async () => {
    const { current, dependencies, base, availability } = await setup();
    const noReferences = new AgentProfileService({
      ...dependencies,
      content: undefined,
      workspaces: undefined,
    });
    expect(await noReferences.projects(current.admin)).toEqual([]);
    expect(await current.profiles.projects(current.admin)).toEqual([
      { id: "project", name: "Project project" },
    ]);
    for (const type of ["workspace", "wiki"] as const) {
      const profile = {
        ...current.agentInput,
        configuration: {
          ...emptyAgentConfiguration("system"),
          parameters: [
            {
              name: "reference",
              type,
              description: "",
              isRequired: true,
              defaultValue:
                type === "workspace"
                  ? { type, workspaceId: current.workspaceId }
                  : { type, pageId: current.page.id },
            },
          ],
        },
      };
      await expect(
        noReferences.save(current.admin, null, profile),
      ).rejects.toMatchObject({ code: "parameter_reference_unavailable" });
    }
    vi.spyOn(current.profileRepository, "list").mockResolvedValue([
      {
        ...base,
        configuration: undefined,
        targets: [{ kind: "system", targetId: "agent" }],
      },
    ]);
    expect(
      (await availability.catalog(current.bob.id))[0].configuration.scope,
    ).toBe("system");
    expect(
      (await current.profiles.resolve(current.bob.id, "agent", base.id)).model,
    ).toBe("model-a");
    await expect(
      current.profiles.resolve(current.bob.id, "agent"),
    ).rejects.toMatchObject({ code: "profileSelectionRequired" });
    await expect(
      current.profiles.resolve(current.bob.id, "text", "gone"),
    ).rejects.toMatchObject({ code: "accessDenied" });
    vi.spyOn(current.connections, "find").mockRejectedValueOnce(
      new Error("native failure"),
    );
    await expect(availability.inspect(current.alice.id)).rejects.toThrow(
      "native failure",
    );
    vi.mocked(current.connections.find).mockResolvedValue(null);
    expect(
      (await current.profiles.filteredList(current.admin, EMPTY_AGENT_FILTERS))
        .profiles,
    ).toHaveLength(1);
    expect(
      (
        await current.profiles.filteredList(current.admin, {
          ...EMPTY_AGENT_FILTERS,
          search: "no matching agent",
        })
      ).profiles,
    ).toEqual([]);
    await expect(
      new AgentAvailabilityService({
        ...dependencies,
        content: undefined,
      }).catalog(current.bob.id, "project"),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
  });

  it("does not hide native candidate failures or choose between equally prioritized function assignments", async () => {
    const { current, base, availability } = await setup();
    const own: AgentProfile = {
      ...base,
      id: "own",
      targets: [{ kind: "person", targetId: current.bob.id }],
      configuration: emptyAgentConfiguration("person"),
    };
    const list = vi
      .spyOn(current.profileRepository, "list")
      .mockResolvedValue([base, own]);
    const connection = await current.connections.find("connection");
    if (!connection) throw new Error("Missing connection fixture");
    vi.spyOn(current.connections, "find")
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce(connection)
      .mockRejectedValueOnce(new Error("candidate storage failure"));
    await expect(
      availability.resolve(current.bob.id, {
        agentId: base.id,
        personalAgentId: null,
        projectId: null,
      }),
    ).rejects.toThrow("candidate storage failure");
    list.mockResolvedValue(
      [own, { ...own, id: "second" }].map((entry) => ({
        ...entry,
        purposes: ["text"],
      })),
    );
    await expect(
      current.profiles.resolve(current.bob.id, "text"),
    ).rejects.toMatchObject({ code: "profileSelectionRequired" });
  });
});
