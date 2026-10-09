import { describe, expect, it, vi } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { AgentAssignmentRepository } from "@/backend/database/repositories/agent/AgentAssignmentRepository";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { TextAssistantSettingsRepository } from "@/backend/database/repositories/assistant/TextAssistantSettingsRepository";
import { AgentAccessDeniedError } from "@/backend/error/AgentErrors";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { AgentAssignmentService } from "@/backend/service/agents/AgentAssignmentService";
import { AgentConnectionService } from "@/backend/service/agents/AgentConnectionService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { TextAgentRoleService } from "@/backend/service/assistant/TextAgentRoleService";
import { isAgentFunction } from "@/definition/AgentAssignment";
import {
  AGENT_PROVIDERS,
  isAgentProvider,
  isApiProvider,
} from "@/definition/AgentConnection";

import { createCatalogModel } from "../helpers/agents";
import { createAccess } from "../helpers/authorization";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AgentAssignment } from "@/definition/AgentAssignment";

const ADMIN = createAccess({ isAdmin: true, mode: "admin" });
const ASSIGNMENT: AgentAssignment = {
  function: "skills",
  connectionId: "connection",
  model: "catalog-model",
  reasoningEffort: "medium",
};

function setup(database: Database) {
  const connections = new AgentConnectionRepository(database);
  const assignments = new AgentAssignmentRepository(database);
  const operations = new AgentOperationRegistry();
  const cli = { describe: vi.fn(), cleanup: vi.fn() };
  const service = new AgentAssignmentService({
    assignments,
    connections,
    operations,
  });
  const management = new AgentConnectionService({
    repository: connections,
    cipher: new InstanceSecretCipher(Buffer.alloc(32, 9)),
    operations,
    cli,
  });
  const roles = new TextAgentRoleService(
    new TextAssistantSettingsRepository(database),
    connections,
    operations,
  );
  return {
    connections,
    assignments,
    operations,
    cli,
    service,
    management,
    roles,
  };
}

async function seed(database: Database) {
  const harness = setup(database);
  await harness.connections.insert({
    id: "connection",
    name: "Account one",
    provider: "openai",
    secretEncrypted: "synthetic-only",
    testModel: "unrelated-default",
    actorId: ADMIN.userId,
  });
  await harness.connections.catalogs().save(
    "connection",
    {
      attemptedAt: "now",
      errorCode: null,
      models: [
        createCatalogModel({
          id: "catalog-model",
          reasoning: "levels",
          reasoningEfforts: ["low", "medium"],
        }),
        createCatalogModel({ id: "plain" }),
      ],
    },
    null,
  );
  await harness.connections.checks().save(
    "connection",
    "auth",
    {
      status: "passed",
      errorCode: null,
      durationMs: 1,
      checkedAt: "now",
      detail: {},
    },
    ADMIN.userId,
  );
  return harness;
}

describe("predefined agent assignments", () => {
  const getDatabase = useMigratedDatabase();

  it("persists Text and SKILLS separately, shares the A8.3 Text runtime and keeps snapshots stable", async () => {
    const { service, roles, connections } = await seed(getDatabase());
    await service.save(ADMIN, ASSIGNMENT, "create");
    await service.save(ADMIN, { ...ASSIGNMENT, function: "text" }, "create");
    const snapshot = await roles.resolve();
    await service.save(
      ADMIN,
      {
        ...ASSIGNMENT,
        function: "text",
        model: "plain",
        reasoningEffort: null,
      },
      "update",
    );
    expect(await roles.resolve()).toMatchObject({
      model: "plain",
      reasoningEffort: null,
    });
    expect(snapshot).toMatchObject({
      model: "catalog-model",
      reasoningEffort: "medium",
      connection: { testModel: "unrelated-default" },
    });
    await roles.saveRetention(ADMIN, 7);
    expect((await roles.read(ADMIN)).retentionDays).toBe(7);
    expect(await service.list(ADMIN)).toEqual([
      { ...ASSIGNMENT, error: null },
      {
        ...ASSIGNMENT,
        function: "text",
        model: "plain",
        reasoningEffort: null,
        error: null,
      },
    ]);
    await connections.catalogs().invalidate("connection");
    await expect(roles.resolve()).rejects.toThrow("modelUnavailable");
    expect((await service.list(ADMIN)).map((entry) => entry.error)).toEqual([
      "modelUnavailable",
      "modelUnavailable",
    ]);
    expect(snapshot.model).toBe("catalog-model");
    await service.remove(ADMIN, "text");
    await expect(roles.resolve()).rejects.toThrow("roleMissing");
    expect(await service.list(ADMIN)).toHaveLength(1);
  });

  it("requires verified access, available credentials, and catalog-listed models and levels", async () => {
    const database = getDatabase();
    const { service, connections, assignments } = await seed(database);
    for (const assignment of [
      { ...ASSIGNMENT, connectionId: "missing" },
      { ...ASSIGNMENT, model: "foreign-account-model" },
      { ...ASSIGNMENT, reasoningEffort: "xhigh" },
      { ...ASSIGNMENT, reasoningEffort: null },
      { ...ASSIGNMENT, model: "plain", reasoningEffort: "low" },
    ])
      await expect(service.save(ADMIN, assignment, "create")).rejects.toThrow();
    await connections.checks().clear("connection");
    await expect(service.save(ADMIN, ASSIGNMENT, "create")).rejects.toThrow(
      "accessUnverified",
    );
    await assignments.save(ASSIGNMENT);
    expect((await service.list(ADMIN))[0].error).toBe("accessUnverified");
    await connections.checks().save(
      "connection",
      "auth",
      {
        status: "failed",
        errorCode: "provider_auth_failed",
        detail: {},
        checkedAt: "now",
        durationMs: 1,
      },
      ADMIN.userId,
    );
    await expect(service.save(ADMIN, ASSIGNMENT, "update")).rejects.toThrow(
      "accessUnverified",
    );
    const connection = await connections.find("connection");
    if (!connection) throw new Error("Missing fixture");
    vi.spyOn(connections, "find").mockResolvedValueOnce({
      ...connection,
      hasApiKey: false,
    });
    expect((await service.list(ADMIN))[0].error).toBe("connectionUnavailable");
    await database.execute("DELETE FROM agent_connections;");
    expect((await service.list(ADMIN))[0].error).toBe("connectionUnavailable");
    await expect(
      service.remove(ADMIN, "arbitrary-command"),
    ).rejects.toMatchObject({ code: "function_invalid" });
    expect(isAgentFunction("text")).toBe(true);
    expect(isAgentFunction("skills")).toBe(true);
    expect(isAgentFunction("arbitrary-command")).toBe(false);
    const invalidFunction: AgentAssignment = { ...ASSIGNMENT };
    Object.defineProperty(invalidFunction, "function", {
      value: "arbitrary-command",
    });
    await expect(
      service.save(ADMIN, invalidFunction, "create"),
    ).rejects.toMatchObject({ code: "function_invalid" });
  });

  it("enforces active administrator mode on every operation, with no token exception", async () => {
    const { service, roles, assignments } = await seed(getDatabase());
    const read = vi.spyOn(assignments, "list");
    for (const actor of [
      createAccess(),
      createAccess({ isAdmin: true }),
      createAccess({ isAdmin: true, mode: "admin", isActive: false }),
    ]) {
      await expect(service.list(actor)).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
      await expect(
        service.save(actor, ASSIGNMENT, "create"),
      ).rejects.toBeInstanceOf(AgentAccessDeniedError);
      await expect(service.remove(actor, "text")).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
      await expect(roles.saveRetention(actor, 30)).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
    }
    expect(read).not.toHaveBeenCalled();
    for (const days of [0, 366, 1.5, NaN])
      await expect(roles.saveRetention(ADMIN, days)).rejects.toThrow(
        "invalidInput",
      );
  });

  it("serializes creation, rejects stale edits and refuses deletion before CLI credential cleanup", async () => {
    const { service, management, assignments, connections, cli } =
      await seed(getDatabase());
    await expect(
      service.save(ADMIN, ASSIGNMENT, "update"),
    ).rejects.toMatchObject({ code: "assignment_not_found" });
    const attempts = await Promise.allSettled([
      service.save(ADMIN, ASSIGNMENT, "create"),
      service.save(ADMIN, ASSIGNMENT, "create"),
    ]);
    expect(attempts.map((attempt) => attempt.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    await expect(
      service.save(ADMIN, ASSIGNMENT, "create"),
    ).rejects.toMatchObject({ code: "assignment_exists" });
    await expect(management.remove(ADMIN, "connection")).rejects.toMatchObject({
      code: "connection_in_use",
    });
    await connections.insert({
      id: "cli",
      name: "CLI account",
      provider: "codex_cli",
      secretEncrypted: null,
      testModel: null,
      actorId: ADMIN.userId,
    });
    await assignments.save({
      ...ASSIGNMENT,
      function: "text",
      connectionId: "cli",
    });
    await expect(management.remove(ADMIN, "cli")).rejects.toMatchObject({
      code: "connection_in_use",
    });
    expect(cli.cleanup).not.toHaveBeenCalled();
    await service.remove(ADMIN, "skills");
    await management.remove(ADMIN, "connection");
    expect(await connections.find("connection")).toBeNull();
  });

  it("registers multiple names for each provider and isolates every catalog, access result and assignment", async () => {
    const { service, management, connections, assignments } =
      setup(getDatabase());
    for (const provider of Object.keys(AGENT_PROVIDERS)) {
      if (!isAgentProvider(provider)) throw new Error("Invalid fixture");
      const ids: string[] = [];
      for (const account of [1, 2]) {
        const id = await management.create(ADMIN, {
          name: `${provider}-${account}`,
          provider,
          apiKey: isApiProvider(provider) ? `synthetic-${account}` : undefined,
        });
        ids.push(id);
        if (isApiProvider(provider))
          await connections.checks().save(
            id,
            "auth",
            {
              status: "passed",
              errorCode: null,
              checkedAt: "now",
              durationMs: 1,
              detail: {},
            },
            ADMIN.userId,
          );
        else
          await connections.setCliAccount(
            id,
            { loggedInAt: "now", label: null },
            ADMIN.userId,
          );
        await connections.catalogs().save(
          id,
          {
            attemptedAt: "now",
            errorCode: null,
            models: [createCatalogModel({ id: `account-${account}` })],
          },
          null,
        );
      }
      await expect(
        service.save(
          ADMIN,
          {
            ...ASSIGNMENT,
            connectionId: ids[0],
            model: "account-2",
            reasoningEffort: null,
          },
          "create",
        ),
      ).rejects.toThrow("modelUnavailable");
      await service.save(
        ADMIN,
        {
          ...ASSIGNMENT,
          connectionId: ids[1],
          model: "account-2",
          reasoningEffort: null,
        },
        "create",
      );
      expect((await service.list(ADMIN))[0].connectionId).toBe(ids[1]);
      await assignments.remove("skills");
      await connections.catalogs().invalidate(ids[0]);
      expect((await connections.catalogs().find(ids[1])).models[0].id).toBe(
        "account-2",
      );
    }
    expect(await management.list(ADMIN)).toHaveLength(14);
  });

  it("propagates storage failures and rejects corrupt stored function contracts", async () => {
    const database = getDatabase();
    const { service, assignments, connections } = await seed(database);
    await assignments.save(ASSIGNMENT);
    vi.spyOn(connections, "find").mockRejectedValueOnce(
      new Error("Storage failure"),
    );
    await expect(service.list(ADMIN)).rejects.toThrow("Storage failure");
    vi.spyOn(database, "query").mockResolvedValueOnce([
      ["arbitrary-command", "connection", "model", null],
    ]);
    await expect(assignments.list()).rejects.toMatchObject({
      code: "function_invalid",
    });
  });
});

describe("A8.3 assignment migration", () => {
  it("preserves the exact existing Text assignment and retention, and applies only once", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    try {
      await database.migrate(
        DATABASE_MIGRATIONS.filter((entry) => entry.name < "026"),
      );
      await database.execute(
        "UPDATE text_assistant_settings SET connection_id = 'account', model = 'real-id', reasoning_effort = 'medium', retention_days = 7;",
      );
      await database.migrate(DATABASE_MIGRATIONS);
      await database.migrate(DATABASE_MIGRATIONS);
      expect(await new AgentAssignmentRepository(database).list()).toEqual([
        {
          function: "text",
          connectionId: "account",
          model: "real-id",
          reasoningEffort: "medium",
        },
      ]);
      expect(
        await new TextAssistantSettingsRepository(database).read(),
      ).toEqual({
        role: {
          connectionId: "account",
          model: "real-id",
          reasoningEffort: "medium",
        },
        retentionDays: 7,
      });
    } finally {
      await database.close();
    }
  });
});
