import { describe, expect, it, vi } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentProfileStore } from "@/backend/database/repositories/agent/AgentProfileStore";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentConnectionService } from "@/backend/service/agents/AgentConnectionService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { readAgentProfileInput } from "@/backend/service/agents/AgentProfileValidation";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import {
  isAgentProfilePurpose,
  isAgentProfileTargetKind,
} from "@/definition/AgentProfile";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { createCatalogModel } from "../helpers/agents";
import { createAccess, createRole } from "../helpers/authorization";
import { createAssistantHarness } from "../helpers/text-assistant";
import { useMigratedDatabase } from "../helpers/test-database";

import type { DatabaseValue } from "@/backend/database/Database";
import type { AgentProfileInput } from "@/definition/AgentProfile";

function profileInput(
  overrides: Partial<AgentProfileInput> = {},
): AgentProfileInput {
  return {
    name: "Named execution profile",
    connectionId: "connection",
    model: "model-a",
    reasoningEffort: "medium",
    isActive: true,
    purposes: ["text"],
    targets: [{ kind: "system", targetId: "text" }],
    ...overrides,
  };
}

async function setup(database: Database) {
  const harness = await createAssistantHarness(database);
  await harness.authorization.saveAccount(harness.admin);
  const inherited = (await harness.profiles.list(harness.admin)).find(
    (profile) => profile.id === "system-text",
  );
  if (!inherited) throw new Error("Missing inherited system agent");
  await harness.profiles.save(harness.admin, inherited.id, {
    ...inherited,
    isActive: false,
    targets: [],
    configuration: emptyAgentConfiguration("system"),
  });
  await harness.profiles.remove(harness.admin, "system-text");
  return {
    ...harness,
    groups: new UserGroupRepository(database),
    repository: new AgentProfileRepository(database),
  };
}

describe("A10.1 persisted grants and execution authorization", () => {
  const getDatabase = useMigratedDatabase();

  it("filters person, group, department and system scopes, including explicit team-leader departments", async () => {
    const harness = await setup(getDatabase());
    const { profiles, admin, alice, bob, reader, authorization, groups } =
      harness;
    await authorization.saveDepartment({
      id: "engineering",
      name: "Engineering",
    });
    await authorization.saveDepartment({ id: "managed", name: "Managed" });
    const bobAccess = createAccess({
      userId: bob.id,
      role: createRole({ id: "role-bob", departmentBound: false }),
      departments: ["engineering"],
      managedDepartments: ["managed"],
    });
    if (bobAccess.role === null) throw new Error("Missing fixture role");
    await authorization.saveRole(bobAccess.role);
    await authorization.saveAccount(bobAccess);
    await groups.save({ id: "team", name: "Team", memberIds: [bob.id] });
    const person = await profiles.save(
      admin,
      null,
      profileInput({
        name: "Personal",
        targets: [{ kind: "person", targetId: alice.id }],
      }),
    );
    const group = await profiles.save(
      admin,
      null,
      profileInput({
        name: "Group",
        targets: [{ kind: "group", targetId: "team" }],
      }),
    );
    const department = await profiles.save(
      admin,
      null,
      profileInput({
        name: "Department",
        targets: [{ kind: "department", targetId: "engineering" }],
      }),
    );
    const managed = await profiles.save(
      admin,
      null,
      profileInput({
        name: "Managed",
        targets: [{ kind: "department", targetId: "managed" }],
      }),
    );
    const system = await profiles.save(
      admin,
      null,
      profileInput({
        name: "System",
        purposes: ["text", "chat"],
        targets: [{ kind: "system", targetId: "chat" }],
      }),
    );
    expect((await profiles.list(admin)).map((entry) => entry.id)).toEqual(
      expect.arrayContaining([department, managed]),
    );
    expect(
      (await profiles.choices(alice.id, "text")).map((entry) => entry.id),
    ).toEqual([person]);
    expect(
      (await profiles.choices(bob.id, "text")).map((entry) => entry.id).sort(),
    ).toEqual([group]);
    expect(await profiles.choices(reader.id, "text")).toEqual([]);
    expect((await profiles.choices(reader.id, "chat"))[0].id).toBe(system);
    await authorization.saveAccount({
      ...bobAccess,
      role: null,
      isAdmin: true,
      mode: "admin",
      departments: [],
      managedDepartments: ["managed"],
    });
    expect(
      (await profiles.choices(bob.id, "text")).map((entry) => entry.id),
    ).toEqual([group]);
    await authorization.saveAccount(bobAccess);
    const serialized = JSON.stringify(await profiles.choices(bob.id, "text"));
    for (const forbidden of [
      "connectionId",
      "targets",
      "hasApiKey",
      "ciphertext",
      "accountLabel",
    ])
      expect(serialized).not.toContain(forbidden);
    expect((await profiles.resolve(bob.id, "text")).model).toBe("model-a");
    expect((await profiles.resolve(alice.id, "text")).connection.id).toBe(
      "connection",
    );
    expect((await profiles.resolve(bob.id, "text", group)).model).toBe(
      "model-a",
    );
    await expect(profiles.resolve(reader.id, "text", person)).rejects.toThrow(
      "accessDenied",
    );
    await expect(profiles.resolve(reader.id, "text")).rejects.toThrow(
      "roleMissing",
    );
    await authorization.saveRole(
      createRole({ id: "role-bob", permissions: [] }),
    );
    await authorization.saveAccount({
      ...bobAccess,
      role: createRole({ id: "role-bob", permissions: [] }),
    });
    expect(
      (await profiles.choices(bob.id, "text")).map((entry) => entry.id).sort(),
    ).toEqual([group]);
    await authorization.saveAccount({
      ...bobAccess,
      departments: [],
      managedDepartments: [],
      allDepartments: true,
      allProjects: true,
    });
    expect(
      (await profiles.choices(bob.id, "text")).map((entry) => entry.id),
    ).toEqual([group]);
    await groups.save({ id: "team", name: "Team", memberIds: [] });
    await expect(profiles.resolve(bob.id, "text", group)).rejects.toThrow(
      "accessDenied",
    );
  });

  it("rejects direct runs before provider invocation and pins explicit personal/system choices", async () => {
    const {
      profiles,
      admin,
      alice,
      bob,
      service,
      request,
      execution,
      repository,
    } = await setup(getDatabase());
    const personal = await profiles.save(
      admin,
      null,
      profileInput({
        name: "Personal",
        targets: [{ kind: "person", targetId: alice.id }],
      }),
    );
    const global = await profiles.save(
      admin,
      null,
      profileInput({ name: "System" }),
    );
    await expect(
      service.run(alice, { ...request, profileId: global }),
    ).rejects.toThrow("accessDenied");
    await expect(
      service.run(bob, { ...request, profileId: personal }),
    ).rejects.toThrow("accessDenied");
    await expect(
      service.run(alice, { ...request, profileId: "missing" }),
    ).rejects.toThrow("accessDenied");
    await expect(
      service.run(alice, {
        ...request,
        action: "chat",
        instruction: "Question",
        change: "answer",
        profileId: personal,
      }),
    ).rejects.toThrow("accessDenied");
    expect(execution.run).not.toHaveBeenCalled();
    await service.run(alice, { ...request, profileId: personal });
    expect(execution.run).toHaveBeenCalledTimes(1);
    await profiles.save(
      admin,
      personal,
      profileInput({
        name: "Personal",
        isActive: false,
        targets: [{ kind: "person", targetId: alice.id }],
      }),
    );
    await expect(
      service.run(alice, { ...request, profileId: personal }),
    ).rejects.toThrow("accessDenied");
    expect(execution.run).toHaveBeenCalledTimes(1);
    expect(
      (await profiles.choices(alice.id, "text")).map((entry) => entry.id),
    ).toEqual([]);
    await profiles.save(admin, global, profileInput({ targets: [] }));
    expect(await profiles.choices(alice.id, "text")).toEqual([]);
    expect(await repository.list()).toHaveLength(2);
    await expect(profiles.remove(admin, personal)).rejects.toMatchObject({
      code: "profile_in_use",
    });
    await profiles.save(
      admin,
      personal,
      profileInput({
        isActive: false,
        targets: [],
        configuration: emptyAgentConfiguration(),
      }),
    );
    await profiles.remove(admin, personal);
    await expect(profiles.remove(admin, personal)).rejects.toMatchObject({
      code: "profile_not_found",
    });
  });

  it("requires fresh administrator mode and active accounts even when callers supply a stale actor", async () => {
    const { profiles, authorization, admin, alice, bob } =
      await setup(getDatabase());
    const stale = { ...admin };
    await authorization.saveAccount({ ...admin, mode: "role" });
    for (const operation of [
      () => profiles.list(stale),
      () => profiles.directory(stale),
      () => profiles.save(stale, null, profileInput()),
      () => profiles.remove(stale, "missing"),
    ])
      await expect(operation()).rejects.toThrow("Administrator mode");
    await authorization.saveAccount({ ...admin, isAdmin: false, mode: "role" });
    await expect(profiles.save(stale, null, profileInput())).rejects.toThrow(
      "Administrator mode",
    );
    await getDatabase().execute(
      "UPDATE users SET is_active = 0 WHERE id = $id;",
      { id: alice.id },
    );
    await expect(profiles.choices(alice.id, "text")).rejects.toThrow(
      "accessDenied",
    );
    await expect(profiles.list(stale)).rejects.toThrow("accessDenied");
    await expect(profiles.choices("missing", "text")).rejects.toThrow(
      "accessDenied",
    );
    await expect(profiles.choices(bob.id, "unknown")).rejects.toThrow(
      "invalidInput",
    );
  });

  it("withdraws access for disabled connections, missing keys, failed checks, catalog changes and login removal", async () => {
    const database = getDatabase();
    const { profiles, admin, alice, connections, repository } =
      await setup(database);
    const id = await profiles.save(admin, null, profileInput());
    const management = new AgentConnectionService({
      repository: connections,
      operations: new AgentOperationRegistry(),
      cipher: new InstanceSecretCipher(Buffer.alloc(32, 8)),
      cli: { describe: vi.fn(), cleanup: vi.fn() },
    });
    await management.setActive(admin, "connection", false);
    expect(await profiles.choices(alice.id, "text")).toEqual([]);
    await expect(profiles.resolve(alice.id, "text", id)).rejects.toThrow(
      "connectionUnavailable",
    );
    await management.setActive(admin, "connection", true);
    expect(await profiles.choices(alice.id, "text")).toHaveLength(1);
    await expect(management.remove(admin, "connection")).rejects.toMatchObject({
      code: "connection_in_use",
    });
    await expect(
      management.setActive({ ...admin, mode: "role" }, "connection", true),
    ).rejects.toThrow("Administrator mode");
    await expect(
      management.setActive(admin, "missing", true),
    ).rejects.toMatchObject({ code: "connection_not_found" });
    const invalidActive = { isActive: true };
    Object.defineProperty(invalidActive, "isActive", { value: "true" });
    await expect(
      management.setActive(admin, "connection", invalidActive.isActive),
    ).rejects.toMatchObject({ code: "profile_invalid" });
    await connections.checks().clear("connection");
    expect(await profiles.choices(alice.id, "text")).toEqual([]);
    await connections.checks().save(
      "connection",
      "auth",
      {
        status: "passed",
        errorCode: null,
        detail: {},
        durationMs: 1,
        checkedAt: "now",
      },
      admin.userId,
    );
    await connections.catalogs().save(
      "connection",
      {
        attemptedAt: "now",
        errorCode: null,
        models: [
          createCatalogModel({ id: "model-a", reasoningEfforts: ["low"] }),
        ],
      },
      null,
    );
    expect(await profiles.choices(alice.id, "text")).toEqual([]);
    await repository.save({ ...profileInput(), id, model: "gone" });
    await expect(profiles.resolve(alice.id, "text", id)).rejects.toThrow(
      "modelUnavailable",
    );
    await connections.remove("connection");
    expect(await profiles.choices(alice.id, "text")).toEqual([]);
    vi.spyOn(connections, "find").mockRejectedValueOnce(
      new Error("Storage failure"),
    );
    await expect(profiles.choices(alice.id, "text")).rejects.toThrow(
      "Storage failure",
    );
  });

  it("keeps two Google API keys and two Codex accounts separate, with multiple profiles per connection", async () => {
    const { profiles, admin, alice, bob, connections } =
      await setup(getDatabase());
    const cipher = new InstanceSecretCipher(Buffer.alloc(32, 8));
    const management = new AgentConnectionService({
      repository: connections,
      cipher,
      operations: new AgentOperationRegistry(),
      cli: {
        describe: vi.fn().mockResolvedValue({
          binaryFound: true,
          loggedInAt: "now",
          accountLabel: "private-label",
          login: null,
          terminalCommand: "isolated",
        }),
        cleanup: vi.fn(),
      },
    });
    for (const provider of ["google_ai_studio", "codex_cli"] as const) {
      const ids: string[] = [];
      for (const index of [1, 2]) {
        const id = await management.create(admin, {
          name: `${provider} ${index}`,
          provider,
          apiKey:
            provider === "google_ai_studio"
              ? `synthetic-key-${index}`
              : undefined,
        });
        ids.push(id);
        if (provider === "google_ai_studio") {
          await connections.checks().save(
            id,
            "auth",
            {
              status: "passed",
              errorCode: null,
              durationMs: 1,
              checkedAt: "now",
              detail: {},
            },
            admin.userId,
          );
          const secret = await connections.findSecretEncrypted(id);
          if (secret === null) throw new Error("Missing synthetic key");
          expect(cipher.decrypt(id, secret)).toBe(`synthetic-key-${index}`);
          expect(() => cipher.decrypt("foreign-id", secret)).toThrow();
        } else
          await connections.setCliAccount(
            id,
            { loggedInAt: "now", label: `account-${index}` },
            admin.userId,
          );
        await connections.catalogs().save(
          id,
          {
            attemptedAt: "now",
            errorCode: null,
            models: [createCatalogModel({ id: `model-${index}` })],
          },
          null,
        );
        await profiles.save(
          admin,
          null,
          profileInput({
            name: `${provider} profile ${index}`,
            connectionId: id,
            model: `model-${index}`,
            reasoningEffort: null,
            purposes: ["agent"],
            targets: [
              { kind: "person", targetId: index === 1 ? alice.id : bob.id },
            ],
          }),
        );
      }
      await expect(
        profiles.save(
          admin,
          null,
          profileInput({
            connectionId: ids[0],
            model: "model-2",
            reasoningEffort: null,
          }),
        ),
      ).rejects.toThrow("modelUnavailable");
      await profiles.save(
        admin,
        null,
        profileInput({
          name: "Second profile on same access",
          connectionId: ids[0],
          model: "model-1",
          reasoningEffort: null,
          targets: [{ kind: "person", targetId: alice.id }],
        }),
      );
      expect(
        (await profiles.choices(alice.id, "agent")).some(
          (entry) => entry.name === `${provider} profile 2`,
        ),
      ).toBe(false);
      if (provider === "codex_cli") {
        await connections.setCliAccount(
          ids[0],
          { loggedInAt: null, label: null },
          admin.userId,
        );
        expect(
          (await profiles.choices(alice.id, "agent")).some(
            (entry) => entry.name === "codex_cli profile 1",
          ),
        ).toBe(false);
        expect(
          (await profiles.choices(bob.id, "agent")).some(
            (entry) => entry.name === "codex_cli profile 2",
          ),
        ).toBe(true);
      }
    }
    expect(
      (await management.list(admin)).filter(
        (entry) => entry.provider === "google_ai_studio",
      ),
    ).toHaveLength(2);
  });

  it("rejects unknown scope references and stale edits; keeps model snapshots and legacy settings synchronized", async () => {
    const {
      profiles,
      admin,
      alice,
      roles,
      repository,
      connections,
      authorization,
    } = await setup(getDatabase());
    await expect(
      profiles.save(admin, "missing", profileInput()),
    ).rejects.toMatchObject({ code: "profile_not_found" });
    for (const kind of ["person", "group", "department"] as const)
      await expect(
        profiles.save(
          admin,
          null,
          profileInput({ targets: [{ kind, targetId: "missing" }] }),
        ),
      ).rejects.toMatchObject({ code: "profile_target_invalid" });
    await authorization.saveAccount({ ...admin, firstName: "", lastName: "" });
    expect(
      (await profiles.directory(admin)).persons.find(
        (entry) => entry.id === alice.id,
      )?.name,
    ).toBe(alice.id);
    await roles.save(admin, {
      role: {
        connectionId: "connection",
        model: "model-a",
        reasoningEffort: "medium",
      },
      retentionDays: 30,
    });
    expect((await profiles.choices(alice.id, "chat"))[0].id).toBe(
      "system-text",
    );
    const snapshot = await profiles.resolve(alice.id, "text", "system-text");
    await profiles.save(
      admin,
      "system-text",
      profileInput({
        name: "System Text",
        reasoningEffort: "low",
        purposes: ["text", "chat"],
        targets: [
          { kind: "system", targetId: "text" },
          { kind: "system", targetId: "chat" },
        ],
      }),
    );
    expect((await roles.read(admin)).role?.reasoningEffort).toBe("low");
    expect(snapshot.reasoningEffort).toBe("medium");
    await connections.catalogs().invalidate("connection");
    await profiles.save(
      admin,
      "system-text",
      profileInput({ reasoningEffort: "low", isActive: false }),
    );
    expect((await repository.list())[0].isActive).toBe(false);
    await expect(profiles.remove(admin, "system-text")).rejects.toMatchObject({
      code: "profile_in_use",
    });
    await profiles.save(
      admin,
      "system-text",
      profileInput({
        reasoningEffort: "low",
        isActive: false,
        targets: [],
        configuration: emptyAgentConfiguration("system"),
      }),
    );
    await profiles.remove(admin, "system-text");
    expect((await roles.read(admin)).role).toBeNull();
  });

  it("honors activation and System function scopes through the legacy resolution facade", async () => {
    const database = getDatabase();
    const { roles, admin, repository, alice } = await setup(database);
    await roles.save(admin, {
      role: {
        connectionId: "connection",
        model: "model-a",
        reasoningEffort: "medium",
      },
      retentionDays: 30,
    });
    await repository.save({
      ...profileInput({ isActive: false }),
      id: "system-text",
    });
    await expect(roles.resolve()).rejects.toThrow("roleMissing");
    await repository.save({
      ...profileInput({
        purposes: ["chat"],
        targets: [{ kind: "system", targetId: "chat" }],
      }),
      id: "system-text",
    });
    await expect(roles.resolve()).rejects.toThrow("roleMissing");
    await repository.save({
      ...profileInput({ targets: [{ kind: "person", targetId: alice.id }] }),
      id: "system-text",
    });
    await expect(roles.resolve()).rejects.toThrow("roleMissing");
    await repository.save({ ...profileInput(), id: "system-text" });
    expect((await roles.resolve()).model).toBe("model-a");
    await database.execute(
      "DELETE FROM agent_execution_profiles WHERE id = 'system-text';",
    );
    await expect(roles.resolve()).rejects.toThrow("roleMissing");
  });

  it("pins deliberate model and connection edits without changing another profile or credential", async () => {
    const { profiles, admin, alice, connections } = await setup(getDatabase());
    const first = await profiles.save(
      admin,
      null,
      profileInput({ targets: [{ kind: "person", targetId: alice.id }] }),
    );
    const other = await profiles.save(
      admin,
      null,
      profileInput({
        name: "Unchanged",
        targets: [{ kind: "person", targetId: alice.id }],
      }),
    );
    await connections.catalogs().save(
      "connection",
      {
        attemptedAt: "now",
        errorCode: null,
        models: [createCatalogModel({ id: "plain" })],
      },
      null,
    );
    await profiles.save(
      admin,
      first,
      profileInput({
        model: "plain",
        reasoningEffort: null,
        targets: [{ kind: "person", targetId: alice.id }],
      }),
    );
    expect((await profiles.resolve(alice.id, "text", first)).model).toBe(
      "plain",
    );
    await connections.insert({
      id: "other",
      name: "Another API",
      provider: "openai",
      secretEncrypted: "isolated-key",
      testModel: null,
      actorId: admin.userId,
    });
    await connections.checks().save(
      "other",
      "auth",
      {
        status: "passed",
        errorCode: null,
        durationMs: 1,
        checkedAt: "now",
        detail: {},
      },
      admin.userId,
    );
    await connections.catalogs().save(
      "other",
      {
        attemptedAt: "now",
        errorCode: null,
        models: [createCatalogModel({ id: "plain" })],
      },
      null,
    );
    await profiles.save(
      admin,
      first,
      profileInput({
        connectionId: "other",
        model: "plain",
        reasoningEffort: null,
        targets: [{ kind: "person", targetId: alice.id }],
      }),
    );
    expect(
      (await profiles.resolve(alice.id, "text", first)).connection.id,
    ).toBe("other");
    expect(
      (await profiles.list(admin)).find((profile) => profile.id === other)
        ?.connectionId,
    ).toBe("connection");
    expect(await connections.findSecretEncrypted("other")).toBe("isolated-key");
  });
});

describe("profile input and schema boundaries", () => {
  it("narrows scopes and purposes, validates bounds and removes duplicate grants", () => {
    for (const purpose of ["text", "chat", "agent"])
      expect(isAgentProfilePurpose(purpose)).toBe(true);
    expect(isAgentProfilePurpose("skills")).toBe(false);
    for (const kind of ["person", "group", "department", "system"])
      expect(isAgentProfileTargetKind(kind)).toBe(true);
    expect(isAgentProfileTargetKind("template")).toBe(false);
    const invalid: readonly unknown[] = [
      null,
      {},
      { ...profileInput(), name: " " },
      { ...profileInput(), name: "x".repeat(81) },
      { ...profileInput(), name: 1 },
      { ...profileInput(), connectionId: "" },
      { ...profileInput(), model: "" },
      { ...profileInput(), reasoningEffort: "x".repeat(25) },
      { ...profileInput(), isActive: "true" },
      { ...profileInput(), purposes: "text" },
      { ...profileInput(), targets: {} },
      { ...profileInput(), purposes: [] },
      { ...profileInput(), purposes: ["text", "text", "text", "text"] },
      { ...profileInput(), purposes: ["skills"] },
      {
        ...profileInput(),
        targets: Array.from({ length: 201 }, () => ({
          kind: "system",
          targetId: "text",
        })),
      },
      { ...profileInput(), targets: [{ kind: "template", targetId: "all" }] },
      { ...profileInput(), targets: [{ kind: "person", targetId: "" }] },
      { ...profileInput(), targets: [{ kind: "system", targetId: "chat" }] },
      {
        ...profileInput(),
        targets: [
          { kind: "person", targetId: "alice" },
          { kind: "group", targetId: "team" },
        ],
      },
    ];
    for (const input of invalid)
      expect(() => readAgentProfileInput(input)).toThrow();
    const repeated = readAgentProfileInput({
      ...profileInput(),
      name: " Trimmed ",
      purposes: ["text", "text"],
      targets: [
        { kind: "person", targetId: "alice" },
        { kind: "person", targetId: "alice" },
        { kind: "person", targetId: "bob" },
      ],
    });
    expect(repeated.name).toBe("Trimmed");
    expect(repeated.purposes).toEqual(["text"]);
    expect(repeated.targets).toHaveLength(2);
    expect(
      readAgentProfileInput(profileInput({ reasoningEffort: null }))
        .reasoningEffort,
    ).toBeNull();
  });

  it("rejects corrupt stored purposes and target kinds", async () => {
    for (const [purpose, kind] of [
      ["unknown", "system"],
      ["text", "unknown"],
    ]) {
      const rows: readonly DatabaseValue[][] = [
        [
          "id",
          "Name",
          "connection",
          "model",
          null,
          1,
          JSON.stringify(emptyAgentConfiguration("system")),
          1,
        ],
      ];
      const query = vi
        .fn()
        .mockResolvedValueOnce(rows)
        .mockResolvedValueOnce([["id", purpose]])
        .mockResolvedValueOnce([["id", kind, "text"]]);
      await expect(
        new AgentProfileStore({ query, execute: vi.fn() }).list(),
      ).rejects.toMatchObject({ code: "profile_invalid" });
    }
  });

  it("migrates existing system text/chat access once and defaults existing connections to active", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    try {
      await database.migrate(
        DATABASE_MIGRATIONS.filter((entry) => entry.name < "030"),
      );
      await database.execute(
        "INSERT INTO agent_connections (id, name, provider, created_by, updated_by) VALUES ('cli', 'Existing CLI', 'codex_cli', 'admin', 'admin');",
      );
      await database.execute(
        "INSERT INTO agent_function_assignments VALUES ('text', 'cli', 'model', 'medium');",
      );
      await database.migrate(DATABASE_MIGRATIONS);
      await database.migrate(DATABASE_MIGRATIONS);
      expect(await new AgentProfileRepository(database).list()).toEqual([
        {
          id: "system-text",
          name: "System Text",
          connectionId: "cli",
          model: "model",
          reasoningEffort: "medium",
          isActive: true,
          revision: 1,
          configuration: {
            ...emptyAgentConfiguration("system"),
            sharing: { isGlobal: true, targets: [] },
          },
          purposes: ["chat", "text"],
          targets: [
            { kind: "system", targetId: "chat" },
            { kind: "system", targetId: "text" },
          ],
        },
      ]);
      expect(
        await database.query("SELECT is_active FROM agent_connections;"),
      ).toEqual([[1]]);
    } finally {
      await database.close();
    }
  });
});
