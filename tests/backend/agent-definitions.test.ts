import { describe, expect, it } from "vitest";

import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentContentAccess } from "@/backend/service/agents/AgentContentAccess";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { EMPTY_AGENT_FILTERS } from "@/definition/AgentFilters";

import { createAccess, createRole } from "../helpers/authorization";
import { createCatalogModel } from "../helpers/agents";
import { pageInput } from "../helpers/wiki-harness";
import { createAssistantHarness } from "../helpers/text-assistant";
import { useMigratedDatabase } from "../helpers/test-database";

import type { Database } from "@/backend/database/Database";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentProfileInput } from "@/definition/AgentProfile";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { ApiProviderId } from "@/definition/AgentConnection";

function input(
  personId: string,
  overrides: Partial<AgentProfileInput> = {},
): AgentProfileInput {
  return {
    name: "Reusable",
    connectionId: "connection",
    model: "model-a",
    reasoningEffort: "medium",
    isActive: true,
    purposes: ["agent"],
    targets: [{ kind: "person", targetId: personId }],
    configuration: {
      ...emptyAgentConfiguration(),
      markdown: "# Reusable task",
      sharing: { isGlobal: true, targets: [] },
    },
    ...overrides,
  };
}

async function setup(database: Database): Promise<
  Awaited<ReturnType<typeof createAssistantHarness>> & {
    readonly repository: AgentProfileRepository;
    readonly groups: UserGroupRepository;
    readonly content: AgentContentAccess;
  }
> {
  const harness = await createAssistantHarness(database);
  await harness.authorization.saveAccount(harness.admin);
  const repository = new AgentProfileRepository(database);
  const groups = new UserGroupRepository(database);
  const content = new AgentContentAccess(
    new ProjectRepository(database),
    harness.wiki.repository,
  );
  const profiles = new AgentProfileService({
    profiles: repository,
    groups,
    content,
    connections: harness.connections,
    authorization: harness.authorization,
    operations: new AgentOperationRegistry(),
  });
  return { ...harness, profiles, repository, groups, content };
}

async function addConnection(
  connections: AgentConnectionRepository,
  input: {
    readonly id: string;
    readonly provider: ApiProviderId;
    readonly userId: string;
  },
): Promise<void> {
  await connections.insert({
    id: input.id,
    name: input.id,
    provider: input.provider,
    secretEncrypted: "synthetic-ciphertext",
    testModel: null,
    actorId: input.userId,
  });
  await connections.catalogs().save(
    input.id,
    {
      attemptedAt: "now",
      errorCode: null,
      models: [
        createCatalogModel({
          id: "model-a",
          reasoning: "levels",
          reasoningEfforts: ["low", "medium"],
        }),
      ],
    },
    null,
  );
  await connections.checks().save(
    input.id,
    "auth",
    {
      status: "passed",
      errorCode: null,
      detail: {},
      durationMs: 1,
      checkedAt: "now",
    },
    input.userId,
  );
}

describe("A10.2 central agent rights, sharing and personal representation", () => {
  const getDatabase = useMigratedDatabase();

  it("matches exact technical provider, model and reasoning and resolves the executor's connection instead of the author's", async () => {
    const { profiles, admin, alice, bob, connections, repository } =
      await setup(getDatabase());
    const template = await profiles.save(admin, null, input(alice.id));
    await profiles.save(
      admin,
      null,
      input(bob.id, {
        reasoningEffort: "low",
        configuration: emptyAgentConfiguration(),
      }),
    );
    await addConnection(connections, {
      id: "foreign-provider",
      provider: "openai",
      userId: bob.id,
    });
    await profiles.save(
      admin,
      null,
      input(bob.id, {
        connectionId: "foreign-provider",
        configuration: emptyAgentConfiguration(),
      }),
    );
    await profiles.save(
      admin,
      null,
      input(bob.id, {
        purposes: ["text"],
        configuration: emptyAgentConfiguration(),
      }),
    );
    await repository.save({
      ...input(bob.id, {
        model: "different-model",
        configuration: emptyAgentConfiguration(),
      }),
      id: "wrong-model",
    });
    expect(
      (await profiles.catalog(bob.id)).find((entry) => entry.id === template)
        ?.availability.reason,
    ).toBe("personal_access_missing");
    await addConnection(connections, {
      id: "bob-personal",
      provider: "openrouter",
      userId: bob.id,
    });
    const own = await profiles.save(
      admin,
      null,
      input(bob.id, {
        connectionId: "bob-personal",
        configuration: emptyAgentConfiguration(),
      }),
    );
    const resolved = await profiles.resolveDefinition(bob.id, {
      agentId: template,
      personalAgentId: own,
      projectId: null,
    });
    expect(resolved.assignment.connection.id).toBe("bob-personal");
    expect(resolved.profile.connectionId).toBe("connection");
    const serialized = JSON.stringify(await profiles.catalog(bob.id));
    for (const forbidden of [
      "connectionId",
      "ciphertext",
      "hasApiKey",
      "accountLabel",
      "sharing",
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it("keeps shared personal content visible but blocked without a matching executor-owned personal source", async () => {
    const { profiles, admin, alice, bob, groups, repository } =
      await setup(getDatabase());
    const template = await profiles.save(admin, null, input(alice.id));
    expect(
      (await profiles.catalog(bob.id)).find((entry) => entry.id === template)
        ?.availability,
    ).toMatchObject({ isUsable: false, reason: "personal_access_missing" });
    await expect(
      profiles.resolveDefinition(bob.id, {
        agentId: template,
        personalAgentId: null,
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: "personal_access_missing" });
    await groups.save({ id: "team", name: "Team", memberIds: [bob.id] });
    await profiles.save(
      admin,
      null,
      input(bob.id, {
        name: "Group source",
        targets: [{ kind: "group", targetId: "team" }],
        configuration: {
          ...emptyAgentConfiguration("group"),
          sharing: { isGlobal: true, targets: [] },
        },
      }),
    );
    expect(
      (await profiles.catalog(bob.id)).find((entry) => entry.id === template)
        ?.availability.reason,
    ).toBe("personal_access_missing");
    const own = await profiles.save(
      admin,
      null,
      input(bob.id, {
        name: "Bob source",
        configuration: emptyAgentConfiguration(),
      }),
    );
    const resolved = await profiles.resolveDefinition(bob.id, {
      agentId: template,
      personalAgentId: own,
      projectId: null,
    });
    expect(resolved.accessAgentId).toBe(own);
    expect(resolved.profile.id).toBe(template);
    expect(resolved.profile.configuration?.markdown).toBe("# Reusable task");
    expect(
      (await profiles.catalog(bob.id)).find((entry) => entry.id === template)
        ?.availability.isUsable,
    ).toBe(true);
    const persisted = (await repository.list()).find(
      (entry) => entry.id === own,
    );
    if (!persisted) throw new Error("Missing personal source");
    await repository.save({ ...persisted, isActive: false });
    await expect(
      profiles.resolveDefinition(bob.id, {
        agentId: template,
        personalAgentId: own,
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: "personal_access_missing" });
  });

  it("requires an explicit choice between equal personal sources and never substitutes a revoked choice", async () => {
    const { profiles, admin, alice, bob, repository, connections } =
      await setup(getDatabase());
    const template = await profiles.save(admin, null, input(alice.id));
    const own = await profiles.save(
      admin,
      null,
      input(bob.id, {
        name: "First",
        configuration: emptyAgentConfiguration(),
      }),
    );
    const other = await profiles.save(
      admin,
      null,
      input(bob.id, {
        name: "Second",
        configuration: emptyAgentConfiguration(),
      }),
    );
    await expect(
      profiles.resolveDefinition(bob.id, {
        agentId: template,
        personalAgentId: null,
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: "personal_access_selection_required" });
    expect(
      (
        await profiles.resolveDefinition(bob.id, {
          agentId: template,
          personalAgentId: own,
          projectId: null,
        })
      ).accessAgentId,
    ).toBe(own);
    const current = (await repository.list()).find((entry) => entry.id === own);
    if (!current) throw new Error("Missing source");
    await repository.save({ ...current, isActive: false });
    await expect(
      profiles.resolveDefinition(bob.id, {
        agentId: template,
        personalAgentId: own,
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: "personal_access_missing" });
    expect(
      (
        await profiles.resolveDefinition(bob.id, {
          agentId: template,
          personalAgentId: other,
          projectId: null,
        })
      ).accessAgentId,
    ).toBe(other);
    await connections
      .catalogs()
      .save(
        "connection",
        { attemptedAt: "2026-10-11T10:00:00Z", errorCode: null, models: [] },
        null,
      );
    expect(
      (await profiles.catalog(bob.id)).find((entry) => entry.id === template)
        ?.availability.reason,
    ).toBe("personal_access_missing");
  });

  it("authorizes shared model access independently of usage shares and system function assignments", async () => {
    const { profiles, admin, alice, bob, groups, authorization } =
      await setup(getDatabase());
    await groups.save({ id: "team", name: "Team", memberIds: [alice.id] });
    const config: AgentConfiguration = {
      ...emptyAgentConfiguration("group"),
      sharing: { isGlobal: true, targets: [] },
    };
    const id = await profiles.save(
      admin,
      null,
      input(alice.id, {
        targets: [{ kind: "group", targetId: "team" }],
        configuration: config,
      }),
    );
    expect(
      (await profiles.catalog(bob.id)).find((entry) => entry.id === id)
        ?.availability.reason,
    ).toBe("agent_usage_denied");
    await expect(profiles.resolve(bob.id, "agent", id)).rejects.toMatchObject({
      code: "agent_usage_denied",
    });
    await groups.save({
      id: "team",
      name: "Team",
      memberIds: [alice.id, bob.id],
    });
    expect(
      (
        await profiles.resolveDefinition(bob.id, {
          agentId: id,
          personalAgentId: null,
          projectId: null,
        })
      ).accessAgentId,
    ).toBe(id);
    const changed = {
      ...config,
      sharing: {
        isGlobal: false,
        targets: [{ kind: "person" as const, targetId: alice.id }],
      },
    };
    await profiles.save(
      admin,
      id,
      input(alice.id, {
        targets: [{ kind: "group", targetId: "team" }],
        configuration: changed,
      }),
    );
    expect(
      (await profiles.catalog(bob.id)).some((entry) => entry.id === id),
    ).toBe(false);
    await expect(
      profiles.resolveDefinition(bob.id, {
        agentId: id,
        personalAgentId: null,
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    await expect(
      profiles.list(createAccess({ userId: bob.id })),
    ).rejects.toThrow();
    await authorization.saveAccount({ ...admin, mode: "role" });
    await expect(profiles.save(admin, null, input(alice.id))).rejects.toThrow();
    await expect(profiles.usages(admin, id)).rejects.toThrow();
  });

  it("honors Person > Group > Department > System and blocks invalid highest-priority access without fallback", async () => {
    const { profiles, admin, alice, bob, groups, authorization, repository } =
      await setup(getDatabase());
    await authorization.saveDepartment({
      id: "department",
      name: "Department",
    });
    const role = createRole({ id: "role-bob", departmentBound: false });
    await authorization.saveRole(role);
    await authorization.saveAccount(
      createAccess({ userId: bob.id, role, departments: ["department"] }),
    );
    await groups.save({ id: "team", name: "Team", memberIds: [bob.id] });
    const person = await profiles.save(
      admin,
      null,
      input(bob.id, {
        purposes: ["text"],
        configuration: emptyAgentConfiguration(),
      }),
    );
    const group = await profiles.save(
      admin,
      null,
      input(alice.id, {
        purposes: ["text"],
        targets: [{ kind: "group", targetId: "team" }],
        configuration: emptyAgentConfiguration("group"),
      }),
    );
    const department = await profiles.save(
      admin,
      null,
      input(alice.id, {
        purposes: ["text"],
        targets: [{ kind: "department", targetId: "department" }],
        configuration: emptyAgentConfiguration("department"),
      }),
    );
    expect(
      (await profiles.choices(bob.id, "text")).map((entry) => entry.id),
    ).toEqual([person]);
    const current = (await repository.list()).find(
      (entry) => entry.id === person,
    );
    if (!current) throw new Error("Missing profile");
    await repository.save({ ...current, isActive: false });
    expect(await profiles.choices(bob.id, "text")).toEqual([]);
    await expect(profiles.resolve(bob.id, "text")).rejects.toThrow(
      "accessDenied",
    );
    await expect(
      profiles.resolve(bob.id, "text", "system-text"),
    ).rejects.toThrow("accessDenied");
    await repository.save({ ...current, revision: undefined, targets: [] });
    expect((await profiles.choices(bob.id, "text"))[0].id).toBe(group);
    await groups.save({ id: "team", name: "Team", memberIds: [] });
    expect((await profiles.choices(bob.id, "text"))[0].id).toBe(department);
    await authorization.saveAccount(
      createAccess({ userId: bob.id, role, departments: [] }),
    );
    expect((await profiles.choices(bob.id, "text"))[0].id).toBe("system-text");
  });

  it("keeps one configuration through the legacy facade, rejects stale saves and blocks deletion until references are cleared", async () => {
    const { profiles, admin, alice, repository, roles } =
      await setup(getDatabase());
    const id = await profiles.save(admin, null, input(alice.id));
    const original = (await repository.list()).find((entry) => entry.id === id);
    if (!original) throw new Error("Missing agent");
    await profiles.save(admin, id, { ...original, name: "Changed" });
    await profiles.save(
      admin,
      id,
      input(alice.id, { name: "Legacy edit", configuration: undefined }),
    );
    expect(
      (await repository.list()).find((entry) => entry.id === id)?.configuration,
    ).toEqual(original.configuration);
    await expect(profiles.save(admin, id, original)).rejects.toMatchObject({
      code: "profile_conflict",
    });
    expect(
      (await profiles.usages(admin, id)).map((entry) => entry.kind),
    ).toEqual(["assignment", "global"]);
    await expect(profiles.remove(admin, id)).rejects.toMatchObject({
      code: "profile_in_use",
    });
    await profiles.save(
      admin,
      id,
      input(alice.id, {
        isActive: false,
        targets: [],
        configuration: emptyAgentConfiguration(),
      }),
    );
    await profiles.remove(admin, id);
    expect((await repository.list()).some((entry) => entry.id === id)).toBe(
      false,
    );
    await roles.save(admin, {
      role: {
        connectionId: "connection",
        model: "model-a",
        reasoningEffort: "low",
      },
      retentionDays: 30,
    });
    expect(
      (await repository.list()).find((entry) => entry.id === "system-text")
        ?.reasoningEffort,
    ).toBe("low");
    const filtered = await profiles.filteredList(admin, {
      ...EMPTY_AGENT_FILTERS,
      search: "system",
      scope: "system",
      provider: "openrouter",
      status: "active",
    });
    expect(filtered.profiles.map((entry) => entry.id)).toEqual(["system-text"]);
  });

  it("checks project context and live wiki visibility independently of global shares", async () => {
    const { profiles, admin, alice, bob, wiki, content, authorization } =
      await setup(getDatabase());
    const config = {
      ...emptyAgentConfiguration(),
      projectId: "project",
      sharing: { isGlobal: true, targets: [] },
    };
    const id = await profiles.save(
      admin,
      null,
      input(alice.id, { configuration: config }),
    );
    await profiles.save(
      admin,
      null,
      input(bob.id, { configuration: emptyAgentConfiguration() }),
    );
    await expect(
      profiles.resolveDefinition(bob.id, {
        agentId: id,
        personalAgentId: null,
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    expect(
      (await profiles.catalog(bob.id, "project")).find(
        (entry) => entry.id === id,
      )?.availability.isUsable,
    ).toBe(true);
    const personal = await wiki.service.create(
      alice,
      pageInput({ scope: "private", content: "Private" }),
    );
    const bobAccount = (await authorization.snapshot()).accounts.find(
      (entry) => entry.userId === bob.id,
    );
    if (!bobAccount) throw new Error("Missing executor account");
    await expect(content.wiki(bobAccount, personal.id)).rejects.toMatchObject({
      code: "parameter_reference_unavailable",
    });
    expect((await content.wiki(admin, personal.id)).markdown).toBe("Private");
    const foreign = await wiki.service.create(
      bob,
      pageInput({ scope: "private", content: "Bob private" }),
    );
    await expect(content.wiki(admin, foreign.id)).rejects.toMatchObject({
      code: "parameter_reference_unavailable",
    });
    await expect(
      profiles.save(
        admin,
        null,
        input(alice.id, { configuration: { ...config, projectId: "missing" } }),
      ),
    ).rejects.toThrow();
    await expect(profiles.catalog(bob.id, "missing")).rejects.toMatchObject({
      code: "agent_usage_denied",
    });
  });

  it("hides project-bound definitions after project rights are revoked and rejects unauthorized reference defaults", async () => {
    const { profiles, admin, alice, bob, wiki, authorization, content } =
      await setup(getDatabase());
    await wiki.addDepartment("restricted");
    await wiki.addProject("restricted-project", ["restricted"]);
    const config = {
      ...emptyAgentConfiguration(),
      projectId: "restricted-project",
      sharing: { isGlobal: true, targets: [] },
    };
    const id = await profiles.save(
      admin,
      null,
      input(alice.id, { configuration: config }),
    );
    const role = createRole({ id: "role-bob", departmentBound: true });
    await authorization.saveRole(role);
    const restricted = createAccess({ userId: bob.id, role, departments: [] });
    await authorization.saveAccount(restricted);
    expect(
      (await profiles.catalog(bob.id)).some((entry) => entry.id === id),
    ).toBe(false);
    await expect(
      profiles.catalog(bob.id, "restricted-project"),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    const privatePage = await wiki.service.create(
      bob,
      pageInput({ scope: "private", content: "Not shared" }),
    );
    const wikiDefault = {
      ...emptyAgentConfiguration(),
      parameters: [
        {
          name: "task",
          type: "wiki" as const,
          description: "",
          isRequired: true,
          defaultValue: { type: "wiki" as const, pageId: privatePage.id },
        },
      ],
    };
    await expect(
      profiles.save(
        admin,
        null,
        input(alice.id, { configuration: wikiDefault }),
      ),
    ).rejects.toMatchObject({ code: "parameter_reference_unavailable" });
    const workspaceDefault = {
      ...emptyAgentConfiguration(),
      parameters: [
        {
          name: "root",
          type: "workspace" as const,
          description: "",
          isRequired: true,
          defaultValue: {
            type: "workspace" as const,
            workspaceId: "unregistered",
          },
        },
      ],
    };
    await expect(
      profiles.save(
        admin,
        null,
        input(alice.id, { configuration: workspaceDefault }),
      ),
    ).rejects.toMatchObject({ code: "parameter_reference_unavailable" });
    await expect(
      content.wiki({ ...admin, isActive: false }, privatePage.id),
    ).rejects.toMatchObject({ code: "parameter_reference_unavailable" });
  });

  it("resolves a named system agent through the compatibility facade and rejects duplicate function assignments", async () => {
    const { profiles, admin, alice, repository, roles } =
      await setup(getDatabase());
    const previous = (await repository.list()).find(
      (profile) => profile.id === "system-text",
    );
    if (!previous) throw new Error("Missing system agent");
    await profiles.save(admin, previous.id, {
      ...previous,
      isActive: false,
      targets: [],
      configuration: emptyAgentConfiguration("system"),
    });
    const named = await profiles.save(
      admin,
      null,
      input(alice.id, {
        name: "Named system",
        purposes: ["text"],
        targets: [{ kind: "system", targetId: "text" }],
        configuration: emptyAgentConfiguration("system"),
      }),
    );
    expect((await roles.resolve()).model).toBe("model-a");
    await expect(
      profiles.save(
        admin,
        null,
        input(alice.id, {
          purposes: ["text"],
          targets: [{ kind: "system", targetId: "text" }],
          configuration: emptyAgentConfiguration("system"),
        }),
      ),
    ).rejects.toMatchObject({ code: "system_function_in_use" });
    await roles.save(admin, {
      role: {
        connectionId: "connection",
        model: "model-a",
        reasoningEffort: "low",
      },
      retentionDays: 30,
    });
    expect(
      (await repository.list()).find((profile) => profile.id === named)
        ?.reasoningEffort,
    ).toBe("low");
    const beforeClear = (await repository.list()).find(
      (profile) => profile.id === named,
    );
    if (!beforeClear) throw new Error("Missing named agent");
    await roles.save(admin, { role: null, retentionDays: 30 });
    expect(
      (await repository.list()).find((profile) => profile.id === named)
        ?.revision,
    ).toBe((beforeClear.revision ?? 0) + 1);
    await expect(
      profiles.save(admin, named, beforeClear),
    ).rejects.toMatchObject({ code: "profile_conflict" });
    await roles.save(admin, {
      role: {
        connectionId: "connection",
        model: "model-a",
        reasoningEffort: "medium",
      },
      retentionDays: 30,
    });
    expect(
      (await repository.list()).find((profile) => profile.id === named)
        ?.reasoningEffort,
    ).toBe("low");
    expect(
      (await repository.list()).find((profile) => profile.id === "system-text")
        ?.isActive,
    ).toBe(false);
  });
});
