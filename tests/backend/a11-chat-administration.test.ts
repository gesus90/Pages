import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { describeChatOperations } from "@/backend/service/chat/ChatToolCatalog";
import {
  AGENT_ADMIN_READ_OPERATIONS,
  AGENT_ADMIN_WRITE_OPERATIONS,
  CHAT_ADMIN_WRITE_OPERATIONS,
} from "@/definition/AgentAdministration";

import { createRole } from "../helpers/authorization";
import { chatAction, useChatHarness } from "../helpers/chat-harness";

import type { ChatHarness } from "../helpers/chat-harness";

const setup = useChatHarness();
const CREATE_USER = {
  username: "new-person",
  firstName: "New",
  lastName: "Person",
  email: null,
  roleId: "role-writer",
  isAdmin: false,
  departmentIds: ["alpha"],
};
const UNUSED_ROLE = createRole({
  id: "unused",
  name: "Unused role",
  permissions: [],
});

function prompts(run: ChatHarness): string {
  return run.execution.run.mock.calls
    .map(([input]) => `${input.instructions}\n${input.prompt}`)
    .join("\n");
}

async function prepare(run: ChatHarness): Promise<void> {
  const repository = new AuthorizationRepository(run.database);
  await repository
    .groups()
    .save({ id: "existing", name: "Existing group", memberIds: ["writer"] });
  await repository.saveRole(UNUSED_ROLE);
}

function model(
  run: ChatHarness,
  operation: string,
  parameters: Readonly<Record<string, unknown>>,
): void {
  run.execution.run.mockReset();
  run.execution.run
    .mockResolvedValueOnce(chatAction(operation, parameters))
    .mockResolvedValueOnce("Erledigt.");
}

async function audit(run: ChatHarness) {
  return new AdministrationActivityRepository(run.database).findAll();
}

describe("A11.6 AK-07: the admin chat uses UI services and extra confirmation", () => {
  it("describes the full administration catalog to the chat", () => {
    const catalog = describeChatOperations();
    for (const operation of [
      ...AGENT_ADMIN_READ_OPERATIONS,
      ...AGENT_ADMIN_WRITE_OPERATIONS,
      ...CHAT_ADMIN_WRITE_OPERATIONS,
    ])
      expect(catalog).toContain(`\`${operation}\``);
    expect(catalog).toContain("zusätzliche Bestätigung");
  });

  it.each([
    ["admin.users.create", CREATE_USER],
    [
      "admin.users.setAdministrator",
      { userId: "writer", isAdmin: true, expectedIsAdmin: false },
    ],
    [
      "admin.users.setActive",
      { userId: "writer", isActive: false, expectedIsActive: true },
    ],
    ["admin.users.resetPassword", { userId: "writer" }],
    [
      "admin.groups.delete",
      {
        groupId: "existing",
        expectedName: "Existing group",
        expectedMemberIds: ["writer"],
      },
    ],
    [
      "admin.departments.delete",
      {
        departmentId: "beta",
        expectedName: "Department beta",
        expectedMemberIds: ["outsider"],
      },
    ],
    ["admin.roles.delete", { roleId: "unused", expectedRole: UNUSED_ROLE }],
  ])(
    "runs %s only with the person's current confirmation, never a model's parameter",
    async (operation, parameters) => {
      const run = await setup();
      await prepare(run);
      const before = await new AuthorizationRepository(run.database).snapshot();
      model(run, operation, { ...parameters, confirmation: "LÖSCHEN" });
      await run.ask("admin", "Führe die Aktion aus.");
      expect(prompts(run)).toContain('"error":"CONFIRMATION_REQUIRED"');
      expect(
        await new AuthorizationRepository(run.database).snapshot(),
      ).toEqual(before);
      expect(await audit(run)).toEqual([]);
      model(run, operation, parameters);
      await run.ask("admin", "Ich bestätige: LÖSCHEN");
      expect(prompts(run)).toContain('Ergebnis: {"ok":true');
      expect(await audit(run)).toMatchObject([
        { operation, actorId: "admin", source: "ai" },
      ]);
    },
  );

  it("creates a user with a one-time password shown to the admin only, absent from every prompt and durable record", async () => {
    const run = await setup();
    model(run, "admin.users.create", CREATE_USER);
    const reply = await run.ask("admin", "Lege New Person an. LÖSCHEN");
    const receipt = reply.temporaryPasswords?.[0];
    if (!receipt) throw new Error("Missing password receipt.");
    expect(receipt).toMatchObject({ username: "new-person" });
    const credentials = await run.database.query(
      "SELECT password_hash, must_change_password FROM users WHERE id = $id;",
      { id: receipt.userId },
    );
    expect(
      await new PasswordHasher().verify(
        String(credentials[0][0]),
        receipt.temporaryPassword,
      ),
    ).toBe(true);
    expect(Number(credentials[0][1])).toBe(1);
    expect((await run.account(receipt.userId)).departments).toEqual(["alpha"]);
    expect(prompts(run)).not.toContain(receipt.temporaryPassword);
    expect(
      JSON.stringify(
        await run.chatSessionService.view(run.people.admin, reply.session.id),
      ),
    ).not.toContain(receipt.temporaryPassword);
    for (const rows of [
      await run.database.query("SELECT result_json FROM agent_operation_keys;"),
      await run.database.query(
        "SELECT changes_json FROM administration_activity;",
      ),
      await run.database.query("SELECT content FROM chat_messages;"),
    ])
      expect(JSON.stringify(rows)).not.toContain(receipt.temporaryPassword);
    run.execution.run.mockResolvedValue("Alles klar.");
    await run.chatService.send(run.people.admin, {
      requestId: randomUUID(),
      sessionId: reply.session.id,
      text: "Und weiter?",
      attachmentIds: [],
    });
    expect(prompts(run)).not.toContain(receipt.temporaryPassword);
  });

  it("resets a password through the surface service, returning the new password outside the model loop", async () => {
    const run = await setup();
    model(run, "admin.users.resetPassword", { userId: "writer" });
    const reply = await run.ask("admin", "Setze Wandas Passwort neu. LÖSCHEN");
    const receipt = reply.temporaryPasswords?.[0];
    if (!receipt) throw new Error("Missing password receipt.");
    const rows = await run.database.query(
      "SELECT password_hash FROM users WHERE id = 'writer';",
    );
    expect(
      await new PasswordHasher().verify(
        String(rows[0][0]),
        receipt.temporaryPassword,
      ),
    ).toBe(true);
    expect(prompts(run)).not.toContain(receipt.temporaryPassword);
    expect(JSON.stringify(await audit(run))).not.toContain(
      receipt.temporaryPassword,
    );
  });

  it("consumes one typed confirmation for only one admin action, and never uses an earlier message as consent", async () => {
    const run = await setup();
    run.execution.run
      .mockResolvedValueOnce(chatAction("admin.users.create", CREATE_USER))
      .mockResolvedValueOnce(
        chatAction("admin.users.setAdministrator", {
          userId: "writer",
          isAdmin: true,
          expectedIsAdmin: false,
        }),
      )
      .mockResolvedValueOnce("Bitte bestätige den neuen Admin extra.");
    const reply = await run.ask(
      "admin",
      "Benutzer anlegen und Admin bestimmen. LÖSCHEN",
    );
    expect((await run.account("writer")).isAdmin).toBe(false);
    expect(prompts(run)).toContain('"error":"CONFIRMATION_REQUIRED"');
    expect(await audit(run)).toHaveLength(1);
    model(run, "admin.users.setAdministrator", {
      userId: "writer",
      isAdmin: true,
      expectedIsAdmin: false,
    });
    await run.chatService.send(run.people.admin, {
      requestId: randomUUID(),
      sessionId: reply.session.id,
      text: "Mach weiter.",
      attachmentIds: [],
    });
    expect((await run.account("writer")).isAdmin).toBe(false);
    expect(await audit(run)).toHaveLength(1);
    model(run, "admin.users.setAdministrator", {
      userId: "writer",
      isAdmin: true,
      expectedIsAdmin: false,
    });
    await run.ask("admin", "Neue Bestätigung: LÖSCHEN");
    expect((await run.account("writer")).isAdmin).toBe(true);
  });

  it("checks the current interface language for extra confirmations", async () => {
    const run = await setup();
    await new UserSettingsRepository(run.database).upsertLanguage(
      "admin",
      "en",
    );
    model(run, "admin.users.setAdministrator", {
      userId: "writer",
      isAdmin: true,
      expectedIsAdmin: false,
    });
    await run.ask("admin", "LÖSCHEN");
    expect((await run.account("writer")).isAdmin).toBe(false);
    model(run, "admin.users.setAdministrator", {
      userId: "writer",
      isAdmin: true,
      expectedIsAdmin: false,
    });
    await run.ask("admin", "DELETE");
    expect((await run.account("writer")).isAdmin).toBe(true);
  });
});

describe("A11.6 AK-05/08: existing surface boundaries and chat-only catalog", () => {
  it.each([
    ["admin.groups.create", { name: "Chat group", memberIds: ["writer"] }],
    ["admin.departments.create", { name: "Chat department" }],
    [
      "admin.roles.save",
      {
        role: createRole({
          id: "new-role",
          name: "Chat role",
          permissions: [],
        }),
        expectedRole: null,
      },
    ],
  ])(
    "runs %s as an AI action in active admin mode and refuses personal admins in role mode",
    async (operation, parameters) => {
      const run = await setup();
      for (const person of ["writer", "roleAdmin"] as const) {
        model(run, operation, parameters);
        await run.ask(person, "Lege den Eintrag an.");
        expect(prompts(run)).toContain('"error":"FORBIDDEN"');
        expect(await audit(run)).toEqual([]);
      }
      model(run, operation, parameters);
      await run.ask("admin", "Lege den Eintrag an.");
      expect(prompts(run)).toContain('Ergebnis: {"ok":true');
      expect(await audit(run)).toMatchObject([
        { operation, actorId: "admin", source: "ai" },
      ]);
      await expect(
        run.mcp.pagesAgentApiService.handle(
          (
            await run.mcp.personalAgentTokenService.create(
              "admin",
              "MCP fixture",
              null,
            )
          ).token,
          { operation, parameters: { operationId: "not-mcp", ...parameters } },
        ),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    },
  );

  it.each(CHAT_ADMIN_WRITE_OPERATIONS)(
    "refuses %s for non-admins and admins in UI role mode",
    async (operation) => {
      const run = await setup();
      await prepare(run);
      for (const person of ["writer", "roleAdmin"] as const) {
        model(run, operation, { userId: "reader" });
        await run.ask(person, "LÖSCHEN");
        expect(prompts(run)).toContain('"error":"FORBIDDEN"');
      }
      expect(await audit(run)).toEqual([]);
    },
  );

  it("retains the last-administrator and agent-use deletion locks of the UI", async () => {
    const run = await setup();
    const repository = new AuthorizationRepository(run.database);
    await repository.saveAccount({
      ...(await run.account("roleadmin")),
      isAdmin: false,
    });
    model(run, "admin.users.setAdministrator", {
      userId: "admin",
      isAdmin: false,
      expectedIsAdmin: true,
    });
    await run.ask("admin", "Entziehe meinen Admin-Zugang. LÖSCHEN");
    expect(prompts(run)).toContain('"error":"CONFLICT"');
    expect((await run.account("admin")).isAdmin).toBe(true);
    await repository
      .groups()
      .save({ id: "used", name: "Used group", memberIds: ["writer"] });
    await run.database.execute(
      "INSERT INTO agent_profile_targets (profile_id, kind, target_id) VALUES ($id, 'group', 'used');",
      { id: run.agentId },
    );
    model(run, "admin.groups.delete", {
      groupId: "used",
      expectedName: "Used group",
      expectedMemberIds: ["writer"],
    });
    await run.ask("admin", "Lösche die Gruppe. LÖSCHEN");
    expect(prompts(run)).toContain('"error":"CONFLICT"');
    expect((await repository.groups().findAll()).map(({ id }) => id)).toContain(
      "used",
    );
    expect(await audit(run)).toEqual([]);
  });
});
