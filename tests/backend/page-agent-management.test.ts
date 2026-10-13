import { readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AgentScopeInUseError } from "@/backend/error/AdministrationError";
import { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { createPageAgentHarness, pageAgentInput } from "../helpers/page-agents";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentParameterValue } from "@/definition/AgentParameters";

describe("PAGE-20 user agents, live model grants and sharing", () => {
  const getDatabase = useMigratedDatabase();
  let harness: Awaited<ReturnType<typeof createPageAgentHarness>> | undefined;
  afterEach(async () => {
    if (harness)
      await rm(harness.wiki.filesDirectory, { recursive: true, force: true });
    harness = undefined;
  });
  async function setup() {
    harness = await createPageAgentHarness(getDatabase());
    return harness;
  }

  it("creates privately, persists instruction and all parameter types, edits owner-only and generates exactly one valid definition", async () => {
    const current = await setup();
    const proposed = pageAgentInput();
    const id = await current.service.save(current.bob.id, null, proposed);
    const initial = (await current.service.page(current.bob.id)).agents[0];
    expect(initial).toMatchObject({
      id,
      ownerId: current.bob.id,
      name: proposed.name,
      revision: 1,
      canEdit: true,
      configuration: proposed.configuration,
    });
    expect((await current.service.page(current.alice.id)).agents).toEqual([]);
    await expect(
      current.profiles.resolve(current.alice.id, "agent", id),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    const configuration: AgentConfiguration = {
      ...proposed.configuration,
      markdown:
        "Changed {{input}} {{work.path}} {{wiki.link}} {{wiki.markdown}}",
      directoryParameter: "work",
      parameters: [
        ...proposed.configuration.parameters,
        {
          name: "work",
          type: "workspace",
          description: "Working copy",
          isRequired: true,
          defaultValue: null,
        },
        {
          name: "wiki",
          type: "wiki",
          description: "Wiki context",
          isRequired: false,
          defaultValue: null,
        },
      ],
    };
    await current.service.save(current.bob.id, id, {
      ...initial,
      name: "Changed",
      reasoningEffort: "low",
      configuration,
      ownerId: current.alice.id,
      model: "forged",
      connectionId: "forged",
    });
    const reloaded = (await current.service.page(current.bob.id)).agents[0];
    expect(reloaded).toMatchObject({
      name: "Changed",
      ownerId: current.bob.id,
      model: "model-a",
      reasoningEffort: "low",
      revision: 2,
      configuration,
    });
    await expect(
      current.service.save(current.alice.id, id, reloaded),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    await expect(
      current.profiles.save(current.admin, id, {
        ...proposed,
        connectionId: "connection",
        model: "model-a",
        isActive: true,
        purposes: ["agent"],
        targets: [],
        configuration: undefined,
      }),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    await expect(
      current.service.save(current.bob.id, id, initial),
    ).rejects.toMatchObject({ code: "profile_conflict" });
    const directory = path.join(current.directory, id);
    expect(await readdir(directory)).toEqual(["AGENT.md"]);
    const markdown = await readFile(path.join(directory, "AGENT.md"), "utf8");
    const encoded = markdown.split("```json\n")[1]?.split("\n```")[0] ?? "";
    const definition: unknown = JSON.parse(encoded);
    expect(definition).toMatchObject({
      agentId: id,
      name: "Changed",
      revision: 2,
      configuration,
    });
    expect(markdown).not.toMatch(/connectionId|ciphertext|hasApiKey/u);
    expect((await stat(path.join(directory, "AGENT.md"))).mode & 0o777).toBe(
      0o400,
    );
  });

  it("keeps global content visible to active users without delegating admin model or connection grants", async () => {
    const current = await setup();
    const proposed = pageAgentInput();
    const id = await current.service.save(current.bob.id, null, {
      ...proposed,
      configuration: {
        ...proposed.configuration,
        sharing: { isGlobal: true, targets: [] },
      },
    });
    expect(
      (await current.service.page(current.reader.id)).agents[0],
    ).toMatchObject({ id, canEdit: false, availability: { isUsable: true } });
    await current.profiles.resolve(current.reader.id, "agent", id);
    const source = (await current.repository.list()).find(
      (entry) => entry.id === "admin-model",
    );
    if (!source) throw new Error("Missing model grant");
    await current.repository.save({
      ...source,
      targets: [{ kind: "person", targetId: current.bob.id }],
    });
    expect((await current.service.page(current.reader.id)).models).toEqual([]);
    expect(
      (await current.service.page(current.reader.id)).agents[0]?.availability
        .isUsable,
    ).toBe(false);
    await expect(
      current.profiles.resolve(current.reader.id, "agent", id),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    await expect(
      current.service.save(current.reader.id, null, proposed),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    await current.connections.scopes().save("connection", {
      mode: "restricted",
      targets: [{ kind: "person", targetId: current.reader.id }],
    });
    expect((await current.service.page(current.bob.id)).models).toEqual([]);
    await expect(
      current.profiles.resolve(current.bob.id, "agent", id),
    ).rejects.toMatchObject({ code: "accessDenied" });
    const account = (await current.authorization.snapshot()).accounts.find(
      (entry) => entry.userId === current.reader.id,
    );
    if (!account) throw new Error("Missing reader");
    await new UserRepository(getDatabase()).setActive(account.userId, false);
    await expect(current.service.page(current.reader.id)).rejects.toMatchObject(
      { code: "accessDenied" },
    );
  });

  it("stores several group and department targets and applies OR, AND and membership changes on every request", async () => {
    const current = await setup();
    for (const id of ["alpha", "beta"])
      await current.authorization.saveDepartment({ id, name: id });
    await current.groups.save({
      id: "one",
      name: "One",
      memberIds: [current.reader.id],
    });
    await current.groups.save({ id: "two", name: "Two", memberIds: [] });
    const proposed = pageAgentInput();
    const configuration: AgentConfiguration = {
      ...proposed.configuration,
      sharing: {
        isGlobal: false,
        operator: "or",
        targets: [
          { kind: "group", targetId: "one" },
          { kind: "group", targetId: "two" },
          { kind: "department", targetId: "alpha" },
          { kind: "department", targetId: "beta" },
        ],
      },
    };
    const id = await current.service.save(current.bob.id, null, {
      ...proposed,
      configuration,
    });
    await current.profiles.resolve(current.reader.id, "agent", id);
    await expect(
      current.profiles.resolve(current.alice.id, "agent", id),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    expect((await current.service.page(current.alice.id)).agents).toEqual([]);
    const saved = (await current.service.page(current.bob.id)).agents[0];
    await current.service.save(current.bob.id, id, {
      ...saved,
      configuration: {
        ...configuration,
        sharing: { ...configuration.sharing, operator: "and" },
      },
    });
    await expect(
      current.profiles.resolve(current.reader.id, "agent", id),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    await current.groups.save({
      id: "two",
      name: "Two",
      memberIds: [current.reader.id],
    });
    const account = (await current.authorization.snapshot()).accounts.find(
      (entry) => entry.userId === current.reader.id,
    );
    if (!account) throw new Error("Missing reader");
    await current.authorization.saveAccount({
      ...account,
      departments: ["alpha"],
    });
    await expect(
      current.profiles.resolve(current.reader.id, "agent", id),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    await current.authorization.saveAccount({
      ...account,
      departments: ["alpha", "beta"],
    });
    await current.profiles.resolve(current.reader.id, "agent", id);
    await current.groups.save({ id: "one", name: "One", memberIds: [] });
    await expect(
      current.profiles.resolve(current.reader.id, "agent", id),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    const reloaded = (await current.service.page(current.bob.id)).agents[0];
    expect(reloaded.configuration.sharing).toEqual({
      ...configuration.sharing,
      operator: "and",
    });
    await current.service.save(current.bob.id, id, {
      ...reloaded,
      configuration: {
        ...reloaded.configuration,
        sharing: { isGlobal: false, operator: "and", targets: [] },
      },
    });
    await expect(
      current.profiles.resolve(current.reader.id, "agent", id),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    await current.profiles.resolve(current.bob.id, "agent", id);
  });

  it("rejects unauthorized models, unsupported reasoning, invalid targets, malformed parameters and traversal", async () => {
    const current = await setup();
    const proposed = pageAgentInput();
    for (const input of [
      { ...proposed, modelProfileId: "missing" },
      { ...proposed, reasoningEffort: "extreme" },
      {
        ...proposed,
        configuration: {
          ...proposed.configuration,
          markdown: "{{undeclared}}",
        },
      },
      {
        ...proposed,
        configuration: {
          ...proposed.configuration,
          sharing: {
            isGlobal: false,
            targets: [{ kind: "person", targetId: current.alice.id }],
          },
        },
      },
    ])
      await expect(
        current.service.save(current.bob.id, null, input),
      ).rejects.toThrow();
    await expect(
      current.service.save(current.bob.id, "../escape", proposed),
    ).rejects.toThrow();
    await expect(
      current.files.write({
        id: "../escape",
        name: "Invalid",
        connectionId: "connection",
        model: "model-a",
        reasoningEffort: "medium",
        purposes: ["agent"],
        targets: [],
        isActive: true,
      }),
    ).rejects.toThrow();
    const id = await current.service.save(current.bob.id, null, proposed);
    const persisted = (await current.service.page(current.bob.id)).agents[0];
    const release = await current.files.hold([id, id]);
    await expect(
      current.service.save(current.bob.id, id, {
        ...persisted,
        name: "While running",
      }),
    ).rejects.toMatchObject({ code: "profile_running" });
    release();
    release();
    await current.service.save(current.bob.id, id, {
      ...persisted,
      name: "After run",
    });
    const source = (await current.repository.list()).find(
      (entry) => entry.id === "admin-model",
    );
    if (!source) throw new Error("Missing model");
    await current.repository.save({ ...source, isActive: false });
    await expect(
      current.profiles.resolve(current.bob.id, "agent", id),
    ).rejects.toThrow();
    await symlink(current.directory, path.join(current.directory, "linked"));
    await expect(
      current.files.write({ ...source, id: "linked" }),
    ).rejects.toThrow();
  });
});

describe("PAGE-20 visibility of agents, deleted groups and the limits of administrators", () => {
  const getDatabase = useMigratedDatabase();
  let harness: Awaited<ReturnType<typeof createPageAgentHarness>> | undefined;
  afterEach(async () => {
    if (harness)
      await rm(harness.wiki.filesDirectory, { recursive: true, force: true });
    harness = undefined;
  });
  async function setup() {
    harness = await createPageAgentHarness(getDatabase());
    return harness;
  }
  function restricted(
    targets: AgentConfiguration["sharing"]["targets"],
    operator: "and" | "or" = "or",
  ) {
    const proposed = pageAgentInput();
    return {
      ...proposed,
      configuration: {
        ...proposed.configuration,
        sharing: { isGlobal: false, operator, targets },
      },
    };
  }

  it("lets someone read a record of an agent only while the agent is shared with them", async () => {
    const current = await setup();
    await current.groups.save({
      id: "one",
      name: "One",
      memberIds: [current.reader.id],
    });
    const id = await current.service.save(
      current.bob.id,
      null,
      restricted([{ kind: "group", targetId: "one" }]),
    );
    for (const user of [current.bob, current.reader])
      await expect(
        current.service.requireVisible(user.id, id),
      ).resolves.toBeUndefined();
    for (const [user, agent] of [
      [current.alice, id],
      [current.bob, "missing"],
      [current.reader, "../escape"],
    ] as const)
      await expect(
        current.service.requireVisible(user.id, agent),
      ).rejects.toMatchObject({ code: "agent_usage_denied" });
    // Membership is read again each time.
    await current.groups.save({ id: "one", name: "One", memberIds: [] });
    await expect(
      current.service.requireVisible(current.reader.id, id),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
  });

  it("shows the owner only the groups and departments that still exist, and a save stores that list", async () => {
    const current = await setup();
    await current.authorization.saveDepartment({ id: "alpha", name: "alpha" });
    for (const id of ["gone", "kept"])
      await current.groups.save({ id, name: id, memberIds: [] });
    const id = await current.service.save(
      current.bob.id,
      null,
      restricted(
        [
          { kind: "group", targetId: "gone" },
          { kind: "group", targetId: "kept" },
          { kind: "department", targetId: "alpha" },
        ],
        "and",
      ),
    );
    await current.groups.delete("gone");
    const shown = (await current.service.page(current.bob.id)).agents[0];
    expect(shown.configuration.sharing).toEqual({
      isGlobal: false,
      operator: "and",
      targets: [
        { kind: "group", targetId: "kept" },
        { kind: "department", targetId: "alpha" },
      ],
    });
    // The stored share still names the deleted group until the owner saves again.
    expect(
      (await current.repository.list()).find((entry) => entry.id === id)
        ?.configuration?.sharing.targets,
    ).toHaveLength(3);
    await current.service.save(current.bob.id, id, shown);
    expect(
      (await current.repository.list()).find((entry) => entry.id === id)
        ?.configuration?.sharing.targets,
    ).toEqual(shown.configuration.sharing.targets);
  });

  it("keeps administrators from changing or deleting an agent of a user without blocking their own work", async () => {
    const current = await setup();
    for (const id of ["one", "two"])
      await current.groups.save({ id, name: id, memberIds: [] });
    const id = await current.service.save(
      current.bob.id,
      null,
      restricted([{ kind: "group", targetId: "one" }]),
    );
    await expect(
      current.profiles.remove(current.admin, id),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    await expect(
      current.profiles.remove(current.admin, "missing"),
    ).rejects.toMatchObject({ code: "profile_not_found" });
    const listed = await current.profiles.list(current.admin);
    expect(listed.map((entry) => entry.id)).toContain("admin-model");
    expect(listed.map((entry) => entry.id)).not.toContain(id);
    const administration = new GroupAdministrationService(
      current.authorization,
      new ServerCache(),
    );
    // A group that only an agent of a user shares with can be deleted.
    await administration.deleteGroup(current.admin.userId, "one");
    // An agent of the administrators keeps the group in use.
    await current.profiles.save(current.admin, null, {
      name: "Shared work",
      connectionId: "connection",
      model: "model-a",
      reasoningEffort: "medium",
      isActive: true,
      purposes: ["agent"],
      targets: [{ kind: "system", targetId: "agent" }],
      configuration: {
        ...emptyAgentConfiguration("system"),
        sharing: {
          isGlobal: false,
          targets: [{ kind: "group", targetId: "two" }],
        },
      },
    });
    await expect(
      administration.deleteGroup(current.admin.userId, "two"),
    ).rejects.toBeInstanceOf(AgentScopeInUseError);
  });

  it("names only the agents of administrators as users of a connection", async () => {
    const current = await setup();
    const id = await current.service.save(
      current.bob.id,
      null,
      pageAgentInput(),
    );
    const usages = await current.connections.usages("connection");
    expect(usages).toContainEqual({
      kind: "agent",
      id: "admin-model",
      name: "Admin model",
    });
    expect(
      usages.map((usage) => ("id" in usage ? usage.id : "")),
    ).not.toContain(id);
  });
});

describe("PAGE-20 definition validation and the life of a model grant", () => {
  const getDatabase = useMigratedDatabase();
  let harness: Awaited<ReturnType<typeof createPageAgentHarness>> | undefined;
  afterEach(async () => {
    if (harness)
      await rm(harness.wiki.filesDirectory, { recursive: true, force: true });
    harness = undefined;
  });
  async function setup() {
    harness = await createPageAgentHarness(getDatabase());
    return harness;
  }
  function withConfiguration(overrides: Partial<AgentConfiguration>) {
    const proposed = pageAgentInput();
    return {
      ...proposed,
      configuration: { ...proposed.configuration, ...overrides },
    };
  }

  it("answers every malformed or unavailable definition with a stable code", async () => {
    const current = await setup();
    const proposed = pageAgentInput();
    const reference = (
      value: AgentParameterValue,
      type: "workspace" | "wiki",
    ) => ({
      markdown:
        type === "wiki" ? "{{reference.markdown}}" : "{{reference.path}}",
      parameters: [
        {
          name: "reference",
          type,
          description: "Reference",
          isRequired: false,
          defaultValue: value,
        },
      ],
    });
    const cases: readonly (readonly [unknown, string])[] = [
      [{ ...proposed, name: "" }, "profile_invalid"],
      [{ ...proposed, name: "   " }, "profile_invalid"],
      [{ ...proposed, name: "x".repeat(201) }, "profile_invalid"],
      [{ ...proposed, name: 5 }, "profile_invalid"],
      [{ ...proposed, modelProfileId: 5 }, "profile_invalid"],
      [{ ...proposed, reasoningEffort: 5 }, "profile_invalid"],
      [
        withConfiguration({
          sharing: { isGlobal: false, targets: [], operator: "xor" as never },
        }),
        "configuration_invalid",
      ],
      [withConfiguration({ projectId: "project" }), "configuration_invalid"],
      [
        withConfiguration({
          sharing: {
            isGlobal: false,
            targets: [{ kind: "group", targetId: "missing" }],
          },
        }),
        "profile_target_invalid",
      ],
      [
        withConfiguration({
          sharing: {
            isGlobal: false,
            targets: [{ kind: "department", targetId: "missing" }],
          },
        }),
        "profile_target_invalid",
      ],
      [
        withConfiguration(
          reference({ type: "workspace", workspaceId: "w" }, "workspace"),
        ),
        "parameter_reference_unavailable",
      ],
      [
        withConfiguration(
          reference({ type: "wiki", pageId: "missing" }, "wiki"),
        ),
        "parameter_reference_unavailable",
      ],
      [{ ...proposed, name: "password: hunter2hunter2" }, "credentialsInText"],
    ];
    for (const [input, code] of cases)
      await expect(
        current.service.save(current.bob.id, null, input),
      ).rejects.toMatchObject({ code });
    expect((await current.repository.list()).filter((e) => e.ownerId)).toEqual(
      [],
    );
  });

  it("accepts a wiki page the owner can read as a default and keeps its reference", async () => {
    const current = await setup();
    const id = await current.service.save(
      current.bob.id,
      null,
      withConfiguration({
        markdown: "Context: {{reference.markdown}}",
        parameters: [
          {
            name: "reference",
            type: "wiki",
            description: "Context",
            isRequired: false,
            defaultValue: { type: "wiki", pageId: current.page.id },
          },
        ],
      }),
    );
    const saved = (await current.service.page(current.bob.id)).agents[0];
    expect(saved).toMatchObject({ id });
    expect(saved.configuration.parameters[0]).toMatchObject({
      defaultValue: { type: "wiki", pageId: current.page.id },
    });
  });

  it("makes an agent unavailable when its model is swapped or withdrawn and never accepts a personal source", async () => {
    const current = await setup();
    const id = await current.service.save(
      current.bob.id,
      null,
      pageAgentInput(),
    );
    await expect(
      current.profiles.resolveDefinition(current.bob.id, {
        agentId: id,
        personalAgentId: "someone-elses-access",
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    const source = (await current.repository.list()).find(
      (entry) => entry.id === "admin-model",
    );
    if (!source) throw new Error("Missing model");
    // The administrator switches the profile to another model of the connection.
    await current.repository.save({ ...source, model: "model-b" });
    const switched = (await current.repository.list()).find(
      (entry) => entry.id === "admin-model",
    );
    if (!switched) throw new Error("Missing model");
    const [listed] = (await current.service.page(current.bob.id)).agents;
    expect(listed.availability).toMatchObject({
      isUsable: false,
      reason: "agent_usage_denied",
    });
    await expect(
      current.profiles.resolve(current.bob.id, "agent", id),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    // Withdrawn from use, the profile is no longer offered either.
    await current.repository.save({ ...switched, isActive: false });
    expect((await current.service.page(current.bob.id)).models).toEqual([]);
  });

  it("does not hide an infrastructure failure behind an empty model list", async () => {
    const current = await setup();
    vi.spyOn(current.connections, "catalogs").mockImplementation(() => {
      throw new Error("database offline");
    });
    await expect(current.service.page(current.bob.id)).rejects.toThrow(
      "database offline",
    );
  });

  it("holds the definitions of administrators during a run as well and keeps their files afterwards", async () => {
    const current = await setup();
    const agentId = await current.profiles.save(current.admin, null, {
      name: "Administrator agent",
      connectionId: "connection",
      model: "model-a",
      reasoningEffort: "medium",
      isActive: true,
      purposes: ["agent"],
      targets: [],
      configuration: emptyAgentConfiguration("system"),
    });
    const definition = path.join(current.directory, agentId, "AGENT.md");
    const original = await readFile(definition, "utf8");
    const saved = (await current.repository.list()).find(
      (entry) => entry.id === agentId,
    );
    if (!saved) throw new Error("Missing agent");
    const release = await current.files.hold([agentId]);
    await expect(
      current.profiles.save(current.admin, agentId, {
        ...saved,
        name: "Renamed while running",
      }),
    ).rejects.toMatchObject({ code: "profile_running" });
    await expect(
      current.profiles.remove(current.admin, agentId),
    ).rejects.toMatchObject({ code: "profile_running" });
    expect(await readFile(definition, "utf8")).toBe(original);
    release();
    await current.profiles.remove(current.admin, agentId);
    // The history of a removed agent stays where it was written.
    expect(await readFile(definition, "utf8")).toBe(original);
  });
});
