import { describe, expect, it } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";
import { applyChatAdministration } from "@/backend/service/agents/ChatAdministrationWrites";
import { agentTransactionScope } from "@/backend/service/agents/AgentTransactionScope";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";
import { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";

import { useChatHarness } from "../helpers/chat-harness";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { AgentAdministrationContext } from "@/backend/service/agents/AgentAdministrationContext";
import type { ChatHarness } from "../helpers/chat-harness";

const setup = useChatHarness();
const CONFIRMATION = "LÖSCHEN";
const NEW_USER = {
  username: "extra-person",
  firstName: "Extra",
  lastName: "Person",
  email: null,
  roleId: "role-writer",
  isAdmin: false,
  departmentIds: ["alpha"],
};

function executorOf(run: ChatHarness): ChatToolExecutor {
  const users = new UserRepository(run.database);
  return new ChatToolExecutor({
    router: run.mcp.chatOperationRouter,
    identities: new AgentIdentityService(
      { getById: (id: string) => users.findById(id) },
      { getContext: run.account },
    ),
  });
}

async function act(
  run: ChatHarness,
  operation: string,
  parameters: Readonly<Record<string, unknown>>,
  confirmation: "LÖSCHEN" | null = CONFIRMATION,
) {
  return executorOf(run).run("admin", { operation, parameters }, confirmation);
}

async function writerRole(run: ChatHarness) {
  const snapshot = await new AuthorizationRepository(run.database).snapshot();
  const role = snapshot.roles.find(({ id }) => id === "role-writer");
  if (!role) throw new Error("Missing writer role.");
  return role;
}

describe("A11.10 g4: chat administration rejects what the person did not ask for", () => {
  it("refuses an email address that is neither a text nor null and creates nobody", async () => {
    const run = await setup();
    const before = await new UserRepository(run.database).findAll();
    await expect(
      act(run, "admin.users.create", { ...NEW_USER, email: 5 }),
    ).resolves.toEqual({ ok: false, error: "INVALID_REQUEST" });
    expect(await new UserRepository(run.database).findAll()).toEqual(before);
  });

  it("creates an administrator without a role", async () => {
    const run = await setup();
    const outcome = await act(run, "admin.users.create", {
      ...NEW_USER,
      roleId: null,
      isAdmin: true,
    });
    expect(outcome).toMatchObject({
      ok: true,
      result: { targetType: "person", changed: true },
      temporaryPassword: { username: "extra-person" },
    });
    const created = (await new UserRepository(run.database).findAll()).find(
      ({ username }) => username === "extra-person",
    );
    if (!created) throw new Error("The user was not created.");
    const account = await run.account(created.id);
    expect(account).toMatchObject({ isAdmin: true, role: null });
  });

  it.each([
    ["admin.users.resetPassword", { userId: "ghost" }],
    [
      "admin.groups.delete",
      { groupId: "ghost", expectedName: "Ghost", expectedMemberIds: [] },
    ],
    [
      "admin.departments.delete",
      { departmentId: "ghost", expectedName: "Ghost", expectedMemberIds: [] },
    ],
    [
      "admin.roles.delete",
      {
        roleId: "ghost",
        expectedRole: {
          id: "ghost",
          name: "Ghost",
          rank: 1,
          departmentBound: false,
          permissions: [],
        },
      },
    ],
  ])(
    "reports %s of an unknown target as not found",
    async (operation, parameters) => {
      const run = await setup();
      await expect(act(run, operation, parameters)).resolves.toEqual({
        ok: false,
        error: "NOT_FOUND",
      });
      expect(
        await new AdministrationActivityRepository(run.database).findAll(),
      ).toEqual([]);
    },
  );

  it.each([
    [
      "admin.users.setAdministrator",
      { userId: "writer", isAdmin: false, expectedIsAdmin: false },
    ],
    [
      "admin.users.setActive",
      { userId: "writer", isActive: true, expectedIsActive: true },
    ],
  ])(
    "leaves the account and the audit untouched when %s changes nothing",
    async (operation, parameters) => {
      const run = await setup();
      await expect(act(run, operation, parameters)).resolves.toEqual({
        ok: true,
        result: {
          id: "writer",
          targetType: "person",
          changed: false,
          affectedUserIds: [],
        },
      });
      expect(
        await new AdministrationActivityRepository(run.database).findAll(),
      ).toEqual([]);
    },
  );
});

describe("A11.10 g4: saving a role in the chat", () => {
  it("applies a change that adds a permission without a confirmation and names its holders", async () => {
    const run = await setup();
    const role = await writerRole(run);
    const outcome = await act(
      run,
      "admin.roles.save",
      {
        role: { ...role, permissions: ["milestones", "write"] },
        expectedRole: role,
      },
      null,
    );
    expect(outcome).toEqual({
      ok: true,
      result: {
        id: "role-writer",
        targetType: "role",
        changed: true,
        affectedUserIds: ["writer"],
      },
    });
    expect((await writerRole(run)).permissions).toEqual([
      "milestones",
      "write",
    ]);
  });

  it("saves an unchanged role without writing or auditing anything", async () => {
    const run = await setup();
    const role = await writerRole(run);
    const outcome = await act(
      run,
      "admin.roles.save",
      { role, expectedRole: role },
      null,
    );
    expect(outcome).toMatchObject({ ok: true, result: { changed: false } });
    expect(
      await new AdministrationActivityRepository(run.database).findAll(),
    ).toEqual([]);
  });

  it("requires the typed confirmation for a change that withdraws a permission", async () => {
    const run = await setup();
    const role = await writerRole(run);
    const withdrawal = {
      role: { ...role, permissions: [] },
      expectedRole: role,
    };
    await expect(
      act(run, "admin.roles.save", withdrawal, null),
    ).resolves.toEqual({ ok: false, error: "CONFIRMATION_REQUIRED" });
    expect((await writerRole(run)).permissions).toEqual(["write"]);
    await expect(
      act(run, "admin.roles.save", withdrawal),
    ).resolves.toMatchObject({ ok: true, result: { changed: true } });
    expect((await writerRole(run)).permissions).toEqual([]);
  });

  it("refuses to change a role from a stale reading", async () => {
    const run = await setup();
    const role = await writerRole(run);
    await expect(
      act(
        run,
        "admin.roles.save",
        {
          role: { ...role, name: "Renamed" },
          expectedRole: { ...role, name: "Stale name" },
        },
        null,
      ),
    ).resolves.toEqual({ ok: false, error: "CONFLICT" });
    expect((await writerRole(run)).name).toBe("Role writer");
  });
});

describe("A11.10 g4: the administration surface of the chat channel", () => {
  async function withContext<Result>(
    run: ChatHarness,
    channel: AgentChannel,
    work: (context: AgentAdministrationContext) => Promise<Result>,
    createAdministration: (
      repository: AuthorizationRepository,
    ) => AdministrationService = (repository) =>
      new AdministrationService(
        repository,
        ServerCache.disabled(),
        new PasswordHasher(),
        agentChannelPolicy("chat").actor,
      ),
  ): Promise<Result> {
    return run.database.transaction(async (transaction) => {
      const repository = new AuthorizationRepository(
        agentTransactionScope(transaction),
      );
      const actor = await repository.users().findById("admin");
      if (!actor) throw new Error("Missing administrator.");
      return work({
        database: transaction,
        repository,
        snapshot: await repository.snapshot(),
        actor,
        channel,
        administration: createAdministration(repository),
        groups: new GroupAdministrationService(
          repository,
          ServerCache.disabled(),
          agentChannelPolicy("chat").actor,
        ),
      });
    });
  }

  it("refuses chat-only operations on any other channel and changes nothing", async () => {
    const run = await setup();
    const error: unknown = await withContext(run, "mcp", (context) =>
      applyChatAdministration(context, "admin.groups.create", {
        name: "Forbidden group",
        memberIds: [],
      }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AgentOperationError);
    expect(error).toMatchObject({ code: "INVALID_REQUEST" });
    expect(
      await new AuthorizationRepository(run.database).groups().findAll(),
    ).toEqual([]);
  });

  it("creates a group on the chat channel", async () => {
    const run = await setup();
    const mutation = await withContext(run, "chat", (context) =>
      applyChatAdministration(context, "admin.groups.create", {
        name: "Chat group",
        memberIds: ["writer"],
      }),
    );
    expect(mutation.result).toMatchObject({
      targetType: "group",
      changed: true,
      affectedUserIds: ["writer"],
    });
    expect(
      (await new AuthorizationRepository(run.database).groups().findAll()).map(
        ({ name }) => name,
      ),
    ).toEqual(["Chat group"]);
  });

  it("fails loudly when a created account cannot be found afterwards", async () => {
    const run = await setup();
    class VanishingAdministration extends AdministrationService {
      public override async createUser(): Promise<{
        readonly temporaryPassword: string;
      }> {
        return { temporaryPassword: "never-stored" };
      }
    }
    const error: unknown = await withContext(
      run,
      "chat",
      (context) =>
        applyChatAdministration(context, "admin.users.create", {
          ...NEW_USER,
          confirmation: CONFIRMATION,
        }),
      (repository) =>
        new VanishingAdministration(
          repository,
          ServerCache.disabled(),
          new PasswordHasher(),
          agentChannelPolicy("chat").actor,
        ),
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      message: "Created administration account is missing.",
    });
  });
});
