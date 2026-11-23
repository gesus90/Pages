import { beforeEach, expect, it, vi, type Mock } from "vitest";

import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { AgentProfileStore } from "./AgentProfileStore";
import { AgentWorkspaceReferencesRepository } from "./AgentWorkspaceReferencesRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentProfile } from "@/definition/AgentProfile";

vi.mock("./AgentWorkspaceReferencesRepository", () => ({
  AgentWorkspaceReferencesRepository: vi.fn(
    class {
      public requireReferences = vi.fn(async () => {});
    },
  ),
}));

type Rows = readonly DatabaseValue[][];

interface Fixture {
  readonly store: AgentProfileStore;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
}

/** Answers each query by a fragment of its statement; unmatched statements return no rows. */
function fixtureOf(answers: Readonly<Record<string, Rows>> = {}): Fixture {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async (statement) => {
    const key = Object.keys(answers).find((fragment) =>
      statement.includes(fragment),
    );
    return key === undefined ? [] : [...(answers[key] ?? [])];
  });
  return { store: new AgentProfileStore({ execute, query }), execute, query };
}

const LIST = "ORDER BY lower(name)";
const PURPOSES = "FROM agent_profile_purposes";
const TARGETS = "FROM agent_profile_targets\n      ORDER";
const CONFIGURATION = JSON.stringify(emptyAgentConfiguration());

function profileRow(
  overrides: Record<number, DatabaseValue> = {},
): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "p1",
    "Profile",
    "c1",
    "m1",
    null,
    1,
    CONFIGURATION,
    3,
    null,
    null,
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

function profileOf(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "p1",
    name: "Profile",
    connectionId: "c1",
    model: "m1",
    reasoningEffort: null,
    isActive: true,
    purposes: ["chat"],
    targets: [{ kind: "person", targetId: "u1" }],
    configuration: emptyAgentConfiguration(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(AgentWorkspaceReferencesRepository).mockClear();
});

it("lists profiles with their purposes and targets", async () => {
  const { store } = fixtureOf({
    [LIST]: [profileRow({ 4: "high" }), profileRow({ 0: "p2", 5: 0 })],
    [PURPOSES]: [
      ["p1", "chat"],
      ["p1", "agent"],
    ],
    [TARGETS]: [["p1", "group", "g1"]],
  });
  const profiles = await store.list();
  expect(profiles).toHaveLength(2);
  expect(profiles[0]).toMatchObject({
    id: "p1",
    reasoningEffort: "high",
    isActive: true,
    revision: 3,
    purposes: ["chat", "agent"],
    targets: [{ kind: "group", targetId: "g1" }],
  });
  expect(profiles[0]).not.toHaveProperty("ownerId");
  expect(profiles[1]).toMatchObject({
    isActive: false,
    purposes: [],
    targets: [],
  });
});

it("lists the owner and model source of a user agent", async () => {
  const { store } = fixtureOf({
    [LIST]: [
      profileRow({ 8: "u1", 9: "src" }),
      profileRow({ 0: "p2", 8: "u1" }),
    ],
  });
  const profiles = await store.list();
  expect(profiles[0]).toMatchObject({ ownerId: "u1", modelProfileId: "src" });
  expect(profiles[1]).toMatchObject({ ownerId: "u1", modelProfileId: "" });
});

it("rejects an unknown stored purpose", async () => {
  const { store } = fixtureOf({
    [LIST]: [profileRow()],
    [PURPOSES]: [["p1", "other"]],
  });
  await expect(store.list()).rejects.toMatchObject({ code: "profile_invalid" });
});

it("rejects an unknown stored target kind", async () => {
  const { store } = fixtureOf({
    [LIST]: [profileRow()],
    [TARGETS]: [["p1", "other", "x"]],
  });
  await expect(store.list()).rejects.toMatchObject({ code: "profile_invalid" });
});

it("saves a new profile with scopes and a derived configuration", async () => {
  const { store, execute } = fixtureOf();
  await store.save(
    profileOf({
      configuration: undefined,
      targets: [{ kind: "system", targetId: "agent" }],
    }),
  );
  const record = execute.mock.calls[0]?.[1];
  expect(record).toMatchObject({
    id: "p1",
    owner_id: null,
    model_profile_id: null,
  });
  expect(JSON.parse(String(record?.configuration_json))).toMatchObject({
    scope: "system",
    sharing: { isGlobal: true, targets: [] },
  });
  expect(execute.mock.calls.slice(1).map((call) => call[1])).toEqual([
    { id: "p1" },
    { id: "p1" },
    { id: "p1", purpose: "chat" },
    { id: "p1", kind: "system", target_id: "agent" },
  ]);
});

it("saves the configuration of the profile as given", async () => {
  const { store, execute } = fixtureOf();
  const configuration: AgentConfiguration = {
    ...emptyAgentConfiguration(),
    tag: "x",
  };
  await store.save(profileOf({ configuration }));
  expect(execute.mock.calls[0]?.[1]?.configuration_json).toBe(
    JSON.stringify(configuration),
  );
});

it("saves a profile whose revision still matches", async () => {
  const { store, execute } = fixtureOf({ "SELECT revision": [[2]] });
  await store.save(profileOf({ revision: 2 }));
  expect(execute).toHaveBeenCalled();
});

it("rejects a save with a stale revision", async () => {
  const { store, execute } = fixtureOf({ "SELECT revision": [[3]] });
  await expect(store.save(profileOf({ revision: 2 }))).rejects.toMatchObject({
    code: "profile_conflict",
  });
  expect(execute).not.toHaveBeenCalled();
});

it("rejects a save with a revision for a missing profile", async () => {
  const { store } = fixtureOf();
  await expect(store.save(profileOf({ revision: 1 }))).rejects.toMatchObject({
    code: "profile_conflict",
  });
});

it("saves a user agent whose model source exists", async () => {
  const { store, execute } = fixtureOf({ "AND owner_id IS NULL": [["src"]] });
  await store.save(profileOf({ ownerId: "u1", modelProfileId: "src" }));
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    owner_id: "u1",
    model_profile_id: "src",
  });
});

it("rejects a user agent without a model source", async () => {
  const { store, query } = fixtureOf();
  await expect(store.save(profileOf({ ownerId: "u1" }))).rejects.toMatchObject({
    code: "model_assignment_missing",
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ id: "" });
});

it("rejects a system function that another profile already uses", async () => {
  const { store } = fixtureOf({ "kind = 'system'": [["other"]] });
  await expect(
    store.save(
      profileOf({ targets: [{ kind: "system", targetId: "skills" }] }),
    ),
  ).rejects.toMatchObject({ code: "system_function_in_use" });
});

it("saves a system function that no other profile uses", async () => {
  const { store, query } = fixtureOf();
  await store.save(
    profileOf({ targets: [{ kind: "system", targetId: "skills" }] }),
  );
  expect(query.mock.calls[0]?.[1]).toEqual({ function: "skills", id: "p1" });
});

it("removes an unused profile", async () => {
  const { store, execute } = fixtureOf({ [LIST]: [profileRow()] });
  await store.remove("p1");
  expect(execute.mock.calls.at(-1)?.[0]).toContain(
    "DELETE FROM agent_execution_profiles",
  );
  expect(execute).toHaveBeenCalledTimes(3);
});

it("removes a profile whose expected revision matches", async () => {
  const { store, execute } = fixtureOf({ "SELECT revision": [[4]] });
  await store.remove("p1", 4);
  expect(execute).toHaveBeenCalledTimes(3);
});

it("rejects a removal with a stale revision", async () => {
  const { store } = fixtureOf({ "SELECT revision": [[4]] });
  await expect(store.remove("p1", 3)).rejects.toMatchObject({
    code: "profile_conflict",
  });
});

it("rejects a removal with a revision for a missing profile", async () => {
  const { store } = fixtureOf();
  await expect(store.remove("p1", 1)).rejects.toMatchObject({
    code: "profile_conflict",
  });
});

it("refuses to remove a profile that is still in use", async () => {
  const { store, execute } = fixtureOf({
    [LIST]: [profileRow()],
    [TARGETS]: [["p1", "person", "u1"]],
  });
  await expect(store.remove("p1")).rejects.toMatchObject({
    code: "profile_in_use",
    usages: [
      { kind: "assignment", target: { kind: "person", targetId: "u1" } },
    ],
  });
  expect(execute).not.toHaveBeenCalled();
});

it("reports no usage for an unknown profile or an agent of a user", async () => {
  const { store } = fixtureOf({ [LIST]: [profileRow({ 0: "p2", 8: "u1" })] });
  await expect(store.usages("p1")).resolves.toEqual([]);
  await expect(store.usages("p2")).resolves.toEqual([]);
});

it("reports every kind of usage", async () => {
  const configuration: AgentConfiguration = {
    ...emptyAgentConfiguration(),
    projectId: "project-1",
    sharing: {
      isGlobal: true,
      targets: [{ kind: "department", targetId: "d1" }],
    },
  };
  const { store } = fixtureOf({
    [LIST]: [profileRow({ 6: JSON.stringify(configuration) })],
    [TARGETS]: [["p1", "person", "u1"]],
    "FROM agent_legacy_function_assignments": [["skills"]],
    "FROM agent_plans": [["plan-1"]],
  });
  await expect(store.usages("p1")).resolves.toEqual([
    { kind: "assignment", target: { kind: "person", targetId: "u1" } },
    { kind: "sharing", target: { kind: "department", targetId: "d1" } },
    { kind: "global" },
    { kind: "project", id: "project-1" },
    { kind: "legacy", id: "skills" },
    { kind: "plan", id: "plan-1" },
  ]);
});

it("names the administrator agents that reference a target", async () => {
  const shared: AgentConfiguration = {
    ...emptyAgentConfiguration(),
    sharing: { isGlobal: false, targets: [{ kind: "group", targetId: "g1" }] },
  };
  const { store } = fixtureOf({
    [LIST]: [
      profileRow({ 0: "a", 1: "A" }),
      profileRow({ 0: "b", 1: "B", 6: JSON.stringify(shared) }),
      profileRow({ 0: "c", 1: "C", 8: "u1" }),
      profileRow({ 0: "d", 1: "D" }),
    ],
    [TARGETS]: [
      ["a", "group", "g1"],
      ["c", "group", "g1"],
      ["d", "group", "g2"],
    ],
  });
  await expect(
    store.references({ kind: "group", targetId: "g1" }),
  ).resolves.toEqual([
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ]);
});

it("reports no sharing usage for a profile without configuration", async () => {
  const { store } = fixtureOf();
  vi.spyOn(store, "list").mockResolvedValue([
    profileOf({ configuration: undefined, targets: [] }),
  ]);
  await expect(store.usages("p1")).resolves.toEqual([]);
});

it("references a target through the scope of a profile without configuration", async () => {
  const { store } = fixtureOf();
  vi.spyOn(store, "list").mockResolvedValue([
    profileOf({
      configuration: undefined,
      targets: [{ kind: "group", targetId: "g1" }],
    }),
  ]);
  await expect(
    store.references({ kind: "group", targetId: "g1" }),
  ).resolves.toEqual([{ id: "p1", name: "Profile" }]);
});
