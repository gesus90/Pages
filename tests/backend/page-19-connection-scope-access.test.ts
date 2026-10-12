import { describe, expect, it } from "vitest";

import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { createCatalogModel } from "../helpers/agents";
import {
  API_CONNECTION_ID,
  connectionIdOf,
  createScopeHarness,
  textAgent,
} from "../helpers/connection-scope";
import { useMigratedDatabase } from "../helpers/test-database";

import type { ScopedConnectionKind } from "../helpers/connection-scope";
import type { AgentConnectionScope } from "@/definition/AgentConnectionScope";
import type { AgentProfileInput } from "@/definition/AgentProfile";

const KINDS: readonly ScopedConnectionKind[] = ["api", "cli"];

const SIGNAL = new AbortController().signal;

function restricted(
  ...targets: AgentConnectionScope["targets"][number][]
): AgentConnectionScope {
  return { mode: "restricted", targets };
}

/** A shared agent on the connection, usable by everybody except for the scope. */
function sharedAgent(connectionId: string): AgentProfileInput {
  return {
    name: "Shared agent",
    connectionId,
    model: "model-a",
    reasoningEffort: "medium",
    isActive: true,
    purposes: ["agent"],
    targets: [{ kind: "system", targetId: "agent" }],
    configuration: {
      ...emptyAgentConfiguration("system"),
      markdown: "# Task",
      sharing: { isGlobal: true, targets: [] },
    },
  };
}

describe.each(KINDS)("PAGE-19 connection scope on a %s connection", (kind) => {
  const getDatabase = useMigratedDatabase();
  const connectionId = connectionIdOf(kind);

  it("global: every active person is offered the model and may run it", async () => {
    const h = await createScopeHarness(getDatabase());
    const profileId = await h.createTextAgent(connectionId);
    const people = [h.alice, h.bob, h.carol, h.dave, h.erin, h.frank];
    for (const person of people) {
      expect(
        (await h.profiles.choices(person.id, "text")).map(
          (choice) => choice.id,
        ),
      ).toEqual([profileId]);
      const agent = await h.profiles.resolve(person.id, "text", profileId);
      await h.execution.run(
        { agent, userId: person.id, prompt: "Prompt" },
        SIGNAL,
      );
    }
    expect(h.provider.run).toHaveBeenCalledTimes(people.length);
    await h.deactivate(h.frank);
    await expect(h.profiles.choices(h.frank.id, "text")).rejects.toThrow(
      "accessDenied",
    );
    await expect(
      h.execution.run(
        {
          agent: await h.profiles.resolve(h.carol.id, "text", profileId),
          userId: h.frank.id,
          prompt: "Prompt",
        },
        SIGNAL,
      ),
    ).rejects.toThrow("accessDenied");
    expect(h.provider.run).toHaveBeenCalledTimes(people.length);
  });

  it("restricted to a person: only that person sees and runs the model", async () => {
    const h = await createScopeHarness(getDatabase());
    const profileId = await h.createTextAgent(connectionId);
    await h.setScope(
      connectionId,
      restricted({ kind: "person", targetId: h.carol.id }),
    );
    expect(
      (await h.profiles.choices(h.carol.id, "text")).map((entry) => entry.id),
    ).toEqual([profileId]);
    await h.execution.run(
      {
        agent: await h.profiles.resolve(h.carol.id, "text", profileId),
        userId: h.carol.id,
        prompt: "Prompt",
      },
      SIGNAL,
    );
    for (const outsider of [h.bob, h.dave, h.erin, h.frank, h.alice]) {
      expect(await h.profiles.choices(outsider.id, "text")).toEqual([]);
      await expect(
        h.profiles.resolve(outsider.id, "text", profileId),
      ).rejects.toThrow("accessDenied");
    }
    expect(h.provider.run).toHaveBeenCalledTimes(1);
  });

  it("restricted to a group: current members pass, and membership changes apply to the next check", async () => {
    const h = await createScopeHarness(getDatabase());
    const profileId = await h.createTextAgent(connectionId);
    await h.setScope(
      connectionId,
      restricted({ kind: "group", targetId: "team" }),
    );
    expect(
      (await h.profiles.choices(h.erin.id, "text")).map((entry) => entry.id),
    ).toEqual([profileId]);
    expect(await h.profiles.choices(h.carol.id, "text")).toEqual([]);
    await h.groups.save({
      id: "team",
      name: "Team",
      memberIds: [h.carol.id],
    });
    expect(await h.profiles.choices(h.erin.id, "text")).toEqual([]);
    expect(
      (await h.profiles.choices(h.carol.id, "text")).map((entry) => entry.id),
    ).toEqual([profileId]);
    await expect(
      h.profiles.resolve(h.erin.id, "text", profileId),
    ).rejects.toThrow("accessDenied");
    await h.groups.save({ id: "team", name: "Team", memberIds: [] });
    expect(await h.profiles.choices(h.carol.id, "text")).toEqual([]);
    await expect(
      h.access.requireUser(h.carol.id, connectionId),
    ).rejects.toThrow("accessDenied");
  });

  it("restricted to a department: members pass, managing a department does not", async () => {
    const h = await createScopeHarness(getDatabase());
    const profileId = await h.createTextAgent(connectionId);
    await h.setScope(
      connectionId,
      restricted({ kind: "department", targetId: "engineering" }),
    );
    await h.setDepartments(h.dave.id, ["engineering"]);
    await h.setDepartments(h.carol.id, [], ["engineering"]);
    expect(
      (await h.profiles.choices(h.dave.id, "text")).map((entry) => entry.id),
    ).toEqual([profileId]);
    expect(await h.profiles.choices(h.carol.id, "text")).toEqual([]);
    expect(await h.profiles.choices(h.erin.id, "text")).toEqual([]);
    await h.setDepartments(h.dave.id, ["finance"]);
    expect(await h.profiles.choices(h.dave.id, "text")).toEqual([]);
    await h.setDepartments(h.erin.id, ["engineering"]);
    expect(
      (await h.profiles.choices(h.erin.id, "text")).map((entry) => entry.id),
    ).toEqual([profileId]);
  });

  it("several targets are a union: one match is enough, and everybody else stays out", async () => {
    const h = await createScopeHarness(getDatabase());
    const profileId = await h.createTextAgent(connectionId);
    await h.setScope(
      connectionId,
      restricted(
        { kind: "person", targetId: h.carol.id },
        { kind: "group", targetId: "team" },
        { kind: "department", targetId: "engineering" },
      ),
    );
    await h.setDepartments(h.dave.id, ["engineering"]);
    for (const member of [h.carol, h.erin, h.dave])
      expect(
        (await h.profiles.choices(member.id, "text")).map((entry) => entry.id),
      ).toEqual([profileId]);
    for (const outsider of [h.bob, h.frank, h.reader]) {
      expect(await h.profiles.choices(outsider.id, "text")).toEqual([]);
      await expect(
        h.access.requireUser(outsider.id, connectionId),
      ).rejects.toThrow("accessDenied");
    }
    // A person matching two targets is not counted twice or excluded.
    await h.setDepartments(h.erin.id, ["engineering"]);
    expect(
      (await h.profiles.choices(h.erin.id, "text")).map((entry) => entry.id),
    ).toEqual([profileId]);
  });

  it("blocks a direct server-side call without invoking the provider", async () => {
    const h = await createScopeHarness(getDatabase());
    const profileId = await h.createTextAgent(connectionId);
    await h.setScope(
      connectionId,
      restricted({ kind: "person", targetId: h.carol.id }),
    );
    // A tampered selection names the agent explicitly, or names none at all.
    await expect(
      h.assistant.run(h.bob, { ...h.request, profileId }),
    ).rejects.toMatchObject({ code: "accessDenied" });
    await expect(h.assistant.run(h.bob, h.request)).rejects.toMatchObject({
      code: "accessDenied",
    });
    expect(h.provider.run).not.toHaveBeenCalled();
    const result = await h.assistant.run(h.carol, { ...h.request, profileId });
    expect(result.text).toBe("Corrected passage");
    expect(h.provider.run).toHaveBeenCalledTimes(1);
  });

  it("checks again at the execution point, whatever selection the caller holds", async () => {
    const h = await createScopeHarness(getDatabase());
    const profileId = await h.createTextAgent(connectionId);
    const agent = await h.profiles.resolve(h.carol.id, "text", profileId);
    await h.execution.run(
      { agent, userId: h.carol.id, prompt: "Prompt" },
      SIGNAL,
    );
    expect(h.provider.run).toHaveBeenCalledTimes(1);
    // The earlier resolution is stale now; the call must still be refused.
    await h.setScope(
      connectionId,
      restricted({ kind: "person", targetId: h.bob.id }),
    );
    await expect(
      h.execution.run({ agent, userId: h.carol.id, prompt: "Prompt" }, SIGNAL),
    ).rejects.toMatchObject({ code: "accessDenied" });
    // A forged executor does not help either: the check names the person.
    await expect(
      h.execution.run({ agent, userId: "nobody", prompt: "Prompt" }, SIGNAL),
    ).rejects.toMatchObject({ code: "accessDenied" });
    expect(h.provider.run).toHaveBeenCalledTimes(1);
    await h.execution.run(
      { agent, userId: h.bob.id, prompt: "Prompt" },
      SIGNAL,
    );
    expect(h.provider.run).toHaveBeenCalledTimes(2);
  });

  it("gives administrators no usage bypass, while they still manage the scope", async () => {
    const h = await createScopeHarness(getDatabase());
    const profileId = await h.createTextAgent(connectionId);
    await h.setScope(
      connectionId,
      restricted({ kind: "person", targetId: h.carol.id }),
    );
    expect(await h.profiles.choices(h.alice.id, "text")).toEqual([]);
    await expect(
      h.profiles.resolve(h.alice.id, "text", profileId),
    ).rejects.toThrow("accessDenied");
    const listed = (await h.management.list(h.admin)).find(
      (entry) => entry.id === connectionId,
    );
    expect(listed?.scope).toEqual(
      restricted({ kind: "person", targetId: h.carol.id }),
    );
    // The administrator's own availability view reports the block, not a bypass.
    expect((await h.profiles.inspect(h.admin))[profileId]).toMatchObject({
      isUsable: false,
      reason: "accessDenied",
    });
  });

  it("fails closed when a connection has no stored scope", async () => {
    const h = await createScopeHarness(getDatabase());
    const profileId = await h.createTextAgent(connectionId);
    await getDatabase().execute(
      "DELETE FROM agent_connection_scopes WHERE connection_id = $id;",
      { id: connectionId },
    );
    expect(await h.profiles.choices(h.carol.id, "text")).toEqual([]);
    await expect(
      h.profiles.resolve(h.carol.id, "text", profileId),
    ).rejects.toThrow("accessDenied");
    expect((await h.connections.scopes().find(connectionId))?.mode).toBe(
      "restricted",
    );
    await h.setScope(connectionId, { mode: "global", targets: [] });
    expect(
      (await h.profiles.choices(h.carol.id, "text")).map((entry) => entry.id),
    ).toEqual([profileId]);
  });

  it("offers a reusable agent only inside the scope and rejects its selection outside", async () => {
    const h = await createScopeHarness(getDatabase());
    const agentId = await h.profiles.save(
      h.admin,
      null,
      sharedAgent(connectionId),
    );
    await h.setScope(
      connectionId,
      restricted({ kind: "person", targetId: h.carol.id }),
    );
    const selection = {
      agentId,
      personalAgentId: null,
      projectId: null,
    };
    const inside = await h.profiles.catalog(h.carol.id);
    expect(inside.map((entry) => entry.id)).toEqual([agentId]);
    expect(inside[0].availability.isUsable).toBe(true);
    expect(
      (await h.profiles.choices(h.carol.id, "agent")).map((entry) => entry.id),
    ).toEqual([agentId]);
    expect(
      (await h.profiles.resolveDefinition(h.carol.id, selection)).assignment
        .connection.id,
    ).toBe(connectionId);
    // Outside the scope the agent and its model are not listed at all.
    expect(await h.profiles.catalog(h.bob.id)).toEqual([]);
    expect(await h.profiles.choices(h.bob.id, "agent")).toEqual([]);
    await expect(
      h.profiles.resolveDefinition(h.bob.id, selection),
    ).rejects.toThrow("accessDenied");
    await h.setScope(connectionId, { mode: "global", targets: [] });
    expect(
      (await h.profiles.catalog(h.bob.id)).map((entry) => entry.id),
    ).toEqual([agentId]);
  });
});

describe("PAGE-19 connection scope across agents and personal access", () => {
  const getDatabase = useMigratedDatabase();

  it("applies one central scope to every agent that uses the connection", async () => {
    const h = await createScopeHarness(getDatabase());
    const first = await h.profiles.save(
      h.admin,
      null,
      textAgent(API_CONNECTION_ID, {
        name: "First",
        targets: [{ kind: "person", targetId: h.carol.id }],
      }),
    );
    const second = await h.profiles.save(
      h.admin,
      null,
      textAgent(API_CONNECTION_ID, {
        name: "Second",
        targets: [{ kind: "person", targetId: h.bob.id }],
      }),
    );
    await h.setScope(
      API_CONNECTION_ID,
      restricted({ kind: "person", targetId: h.carol.id }),
    );
    expect(
      (await h.profiles.choices(h.carol.id, "text")).map((entry) => entry.id),
    ).toEqual([first]);
    // Bob is assigned to the second agent, but the connection is not his to use.
    expect(await h.profiles.choices(h.bob.id, "text")).toEqual([]);
    await expect(h.profiles.resolve(h.bob.id, "text", second)).rejects.toThrow(
      "accessDenied",
    );
    expect(await h.connections.list()).toHaveLength(2);
    expect((await h.connections.scopes().list()).size).toBe(2);
  });

  it("does not use a personal access whose connection excludes the person", async () => {
    const h = await createScopeHarness(getDatabase());
    await h.connections.insert({
      id: "bob-personal",
      name: "Bob's own access",
      provider: "openrouter",
      secretEncrypted: "synthetic-ciphertext",
      testModel: null,
      actorId: h.bob.id,
    });
    await h.connections.catalogs().save(
      "bob-personal",
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
    await h.connections.checks().save(
      "bob-personal",
      "auth",
      {
        status: "passed",
        errorCode: null,
        detail: {},
        durationMs: 1,
        checkedAt: "now",
      },
      h.bob.id,
    );
    const personal = (person: string): AgentProfileInput => ({
      name: "Personal task",
      connectionId: API_CONNECTION_ID,
      model: "model-a",
      reasoningEffort: "medium",
      isActive: true,
      purposes: ["agent"],
      targets: [{ kind: "person", targetId: person }],
      configuration: {
        ...emptyAgentConfiguration(),
        markdown: "# Task",
        sharing: { isGlobal: true, targets: [] },
      },
    });
    const template = await h.profiles.save(h.admin, null, personal(h.alice.id));
    const own = await h.profiles.save(h.admin, null, {
      ...personal(h.bob.id),
      connectionId: "bob-personal",
      configuration: emptyAgentConfiguration(),
    });
    const selection = {
      agentId: template,
      personalAgentId: own,
      projectId: null,
    };
    expect(
      (await h.profiles.resolveDefinition(h.bob.id, selection)).assignment
        .connection.id,
    ).toBe("bob-personal");
    await h.setScope(
      "bob-personal",
      restricted({ kind: "person", targetId: h.carol.id }),
    );
    await expect(
      h.profiles.resolveDefinition(h.bob.id, selection),
    ).rejects.toMatchObject({ code: "personal_access_missing" });
    expect(
      (await h.profiles.catalog(h.bob.id)).find(
        (entry) => entry.id === template,
      )?.availability,
    ).toMatchObject({ isUsable: false, reason: "personal_access_missing" });
  });
});
