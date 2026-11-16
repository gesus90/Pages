import { expect, it, vi } from "vitest";

import { McpTicketApi } from "@/backend/service/mcp/ticket/McpTicketApi";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpTicketAccess } from "@/backend/service/mcp/ticket/McpTicketApi";
import type { McpTicketDependencies } from "@/backend/service/mcp/ticket/McpTicketContext";

it("rechecks the paired account and does not retain its credential", async () => {
  const authenticate = vi.fn(async () => ({ account: { username: "user" } }));
  const findCredentialsByUsername = vi.fn(async () => ({
    user: { id: "user", isActive: true },
    passwordHash: "hash",
  }));
  const api = new McpTicketApi(
    partial<McpTicketDependencies>({}),
    partial<McpTicketAccess>({
      devices: { authenticate },
      accounts: { findCredentialsByUsername },
    }),
  );
  const context = await api.authenticate("Bearer token");
  expect(context.actor).toEqual({ id: "user", isActive: true });
  expect(authenticate).toHaveBeenCalledWith("Bearer token");
  expect(findCredentialsByUsername).toHaveBeenCalledWith("user");
});

it("refuses a missing or deactivated paired account", async () => {
  const access = partial<McpTicketAccess>({
    devices: { authenticate: async () => ({ account: { username: "user" } }) },
    accounts: {
      findCredentialsByUsername: async () => ({ user: { isActive: false } }),
    },
  });
  const api = new McpTicketApi(partial<McpTicketDependencies>({}), access);
  await expect(api.authenticate(null)).rejects.toMatchObject({
    code: "invalid_token",
  });
});
