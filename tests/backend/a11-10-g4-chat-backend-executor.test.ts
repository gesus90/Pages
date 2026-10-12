import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { ChatError } from "@/backend/error/ChatErrors";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";

import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import type { AgentAdminWriteResponse } from "@/definition/AgentAdministration";
import type { AgentIdentity } from "@/definition/McpAuthorization";

const IDENTITY: AgentIdentity = {
  userId: "writer",
  isAdmin: false,
  permissions: [],
};

const CHANGED: AgentAdminWriteResponse = {
  apiVersion: "1",
  result: {
    id: "writer",
    targetType: "person",
    changed: true,
    affectedUserIds: ["writer"],
  },
};

function setup() {
  const handle = vi.fn<AgentOperationRouter["handle"]>();
  const verify = vi.fn<AgentIdentityService["verify"]>();
  verify.mockResolvedValue(IDENTITY);
  const executor = new ChatToolExecutor({
    router: { handle },
    identities: { verify },
  });
  return { executor, handle, verify };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("A11.10 g4: running one chat action", () => {
  it("refuses operations outside the chat catalog before any right is checked", async () => {
    const { executor, handle, verify } = setup();
    await expect(
      executor.run("writer", { operation: "files.read", parameters: {} }, null),
    ).resolves.toEqual({ ok: false, error: "UNKNOWN_OPERATION" });
    expect(verify).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  it("asks for the typed confirmation before a deletion runs", async () => {
    const { executor, handle } = setup();
    await expect(
      executor.run(
        "writer",
        { operation: "ticket.delete", parameters: { ticketId: "PAGE-1" } },
        null,
      ),
    ).resolves.toEqual({ ok: false, error: "CONFIRMATION_REQUIRED" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("sets operation ID and confirmation itself and drops the ones the agent supplied", async () => {
    const { executor, handle } = setup();
    handle.mockResolvedValue(CHANGED);
    const outcome = await executor.run(
      "writer",
      {
        operation: "ticket.delete",
        parameters: {
          ticketId: "PAGE-1",
          operationId: "forged-operation",
          confirmation: "forged",
        },
      },
      "LÖSCHEN",
    );
    expect(outcome).toEqual({ ok: true, result: CHANGED.result });
    const [identity, request] = handle.mock.calls[0];
    expect(identity).toEqual(IDENTITY);
    expect(request.operation).toBe("ticket.delete");
    expect(request.parameters).toMatchObject({
      ticketId: "PAGE-1",
      confirmation: "LÖSCHEN",
    });
    expect(request.parameters).not.toMatchObject({
      operationId: "forged-operation",
    });
  });

  it("passes a one-time password receipt on, outside of the result", async () => {
    const { executor, handle } = setup();
    const temporaryPassword = {
      userId: "new",
      username: "new-person",
      temporaryPassword: "einmal-passwort",
    };
    handle.mockResolvedValue({ ...CHANGED, temporaryPassword });
    const outcome = await executor.run(
      "writer",
      { operation: "admin.users.resetPassword", parameters: { userId: "new" } },
      "LÖSCHEN",
    );
    expect(outcome).toEqual({
      ok: true,
      result: CHANGED.result,
      temporaryPassword,
    });
  });

  it("stops with accessDenied when the account may no longer act", async () => {
    const { executor, handle, verify } = setup();
    verify.mockRejectedValue(new McpAuthorizationError("invalid_token", 401));
    const error: unknown = await executor
      .run("writer", { operation: "ticket.read", parameters: {} }, null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ChatError);
    expect(error).toMatchObject({ code: "accessDenied" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("does not hide an unexpected failure of the identity check", async () => {
    const { executor, verify } = setup();
    verify.mockRejectedValue(new Error("database is down"));
    await expect(
      executor.run(
        "writer",
        { operation: "ticket.read", parameters: {} },
        null,
      ),
    ).rejects.toThrow("database is down");
  });
});

describe("A11.10 g4: failures of a chat action", () => {
  async function failWith(error: unknown) {
    const { executor, handle } = setup();
    handle.mockRejectedValue(error);
    return executor.run(
      "writer",
      { operation: "ticket.read", parameters: {} },
      null,
    );
  }

  it("reports a business failure with its whitelisted details", async () => {
    await expect(
      failWith(new AgentOperationError("CONFLICT", { currentRevision: 4 })),
    ).resolves.toEqual({
      ok: false,
      error: "CONFLICT",
      details: { currentRevision: 4 },
    });
  });

  it("reports a business failure without details as the bare code", async () => {
    await expect(
      failWith(new AgentOperationError("NOT_FOUND")),
    ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("reports a withdrawn authorization as forbidden", async () => {
    await expect(
      failWith(new McpAuthorizationError("invalid_token", 401)),
    ).resolves.toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("reports anything else as failed and logs only the kind of error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      failWith(new TypeError("secret content of the action")),
    ).resolves.toEqual({ ok: false, error: "FAILED" });
    await expect(failWith("plain text")).resolves.toEqual({
      ok: false,
      error: "FAILED",
    });
    expect(log.mock.calls).toEqual([
      ["[pages] A chat action failed.", "ticket.read", "TypeError"],
      ["[pages] A chat action failed.", "ticket.read", "string"],
    ]);
  });
});
