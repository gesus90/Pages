import { expect, it, vi } from "vitest";

import { RuntimeApproval } from "@/backend/agents/runtime/RuntimeApproval";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";

import { runtimeContext } from "./runtime-fixture";

import type { ChatTemporaryPassword } from "@/definition/AgentAdministration";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";

it("consumes typed confirmation only once even with concurrent destructive calls", async () => {
  const { context } = await runtimeContext();
  const tools = {
    run: vi.fn<ChatToolExecutor["run"]>(async () => ({ ok: true })),
  };
  const approval = new RuntimeApproval({
    context,
    tools,
    confirmation: "DELETE",
    agentConfirmation: null,
    onTemporaryPassword: vi.fn(),
  });
  await approval.run({ operation: "ticket.read", parameters: {} });
  await Promise.all([
    approval.run({ operation: "ticket.delete", parameters: {} }),
    approval.run({ operation: "ticket.delete", parameters: {} }),
  ]);
  expect(
    tools.run.mock.calls.map((call) => [call[0], call[2], call[3]]),
  ).toEqual([
    [context.userId, "DELETE", null],
    [context.userId, "DELETE", null],
    [context.userId, null, null],
  ]);
});

it("keeps temporary receipts out of model-facing outcomes", async () => {
  const { context } = await runtimeContext();
  const receipt: ChatTemporaryPassword = {
    userId: "synthetic-user",
    username: "synthetic",
    temporaryPassword: "[synthetic receipt]",
  };
  const tools = {
    run: vi.fn<ChatToolExecutor["run"]>(async () => ({
      ok: true,
      result: { changed: true },
      temporaryPassword: receipt,
    })),
  };
  const onTemporaryPassword = vi.fn();
  const approval = new RuntimeApproval({
    context,
    tools,
    confirmation: "LÖSCHEN",
    agentConfirmation: "LÖSCHEN",
    onTemporaryPassword,
  });
  expect(
    await approval.run({ operation: "agents.delete", parameters: {} }),
  ).toEqual({ ok: true, result: { changed: true } });
  expect(onTemporaryPassword).toHaveBeenCalledWith(receipt);
  await approval.run({ operation: "agents.delete", parameters: {} });
  expect(tools.run.mock.calls[1]?.slice(2)).toEqual([null, null]);
});

it("retains the actual Pages confirmation and parameter-sanitizing boundary", async () => {
  const { context } = await runtimeContext();
  const identities = {
    verify: vi.fn<() => Promise<AgentIdentity>>(async () => ({
      userId: context.userId,
      isAdmin: false,
      permissions: [],
    })),
  };
  const router = {
    handle: vi.fn<AgentOperationRouter["handle"]>(async () => ({
      apiVersion: "1",
      result: { deleted: [], failed: [], cleanupFailed: [] },
    })),
  };
  const tools = new ChatToolExecutor({ identities, router });
  const approval = new RuntimeApproval({
    context,
    tools,
    confirmation: null,
    agentConfirmation: null,
    onTemporaryPassword: vi.fn(),
  });
  expect(
    await approval.run({
      operation: "ticket.delete",
      parameters: { confirmation: "DELETE", operationId: "forged" },
    }),
  ).toEqual({ ok: false, error: "CONFIRMATION_REQUIRED" });
  expect(router.handle).not.toHaveBeenCalled();
  const confirmed = new RuntimeApproval({
    context,
    tools,
    confirmation: "DELETE",
    agentConfirmation: null,
    onTemporaryPassword: vi.fn(),
  });
  expect(
    (
      await confirmed.run({
        operation: "ticket.delete",
        parameters: {
          ticketId: "ticket",
          confirmation: "forged",
          operationId: "forged",
        },
      })
    ).ok,
  ).toBe(true);
  expect(router.handle.mock.calls[0]?.[1]).toMatchObject({
    operation: "ticket.delete",
    parameters: { ticketId: "ticket", confirmation: "DELETE" },
  });
  expect(router.handle.mock.calls[0]?.[1]).not.toMatchObject({
    parameters: { operationId: "forged" },
  });
  expect(
    await confirmed.run({ operation: "ticket.delete", parameters: {} }),
  ).toEqual({ ok: false, error: "CONFIRMATION_REQUIRED" });
  expect(router.handle).toHaveBeenCalledOnce();
});

it("refuses revoked sessions before consuming or dispatching approvals", async () => {
  const { context, sessions } = await runtimeContext();
  const tools = {
    run: vi.fn<ChatToolExecutor["run"]>(async () => ({ ok: true })),
  };
  const approval = new RuntimeApproval({
    context,
    tools,
    confirmation: "DELETE",
    agentConfirmation: null,
    onTemporaryPassword: vi.fn(),
  });
  sessions.require.mockRejectedValueOnce(new Error("Session revoked"));
  await expect(
    approval.run({ operation: "ticket.delete", parameters: {} }),
  ).rejects.toThrow("Session revoked");
  expect(tools.run).not.toHaveBeenCalled();
  await approval.run({ operation: "ticket.delete", parameters: {} });
  expect(tools.run.mock.calls[0]?.[2]).toBe("DELETE");
});
