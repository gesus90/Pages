import { expect, it, vi } from "vitest";

import { McpWikiApi } from "@/backend/service/mcp/wiki/McpWikiApi";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpWikiAccess } from "@/backend/service/mcp/wiki/McpWikiApi";
import type { McpWikiDependencies } from "@/backend/service/mcp/wiki/McpWikiContext";

it("rechecks the paired account and gives the context only the user", async () => {
  const authenticate = vi.fn(async () => ({ account: { username: "user" } }));
  const access = partial<McpWikiAccess>({
    devices: { authenticate },
    accounts: {
      findCredentialsByUsername: async () => ({
        user: { id: "user", isActive: true },
        passwordHash: "hash",
      }),
    },
  });
  const context = await new McpWikiApi(
    partial<McpWikiDependencies>({}),
    access,
  ).authenticate("Bearer token");
  expect(context.actor).toEqual({ id: "user", isActive: true });
  expect(authenticate).toHaveBeenCalledWith("Bearer token");
});

it("rejects a removed account", async () => {
  const access = partial<McpWikiAccess>({
    devices: { authenticate: async () => ({ account: { username: "user" } }) },
    accounts: { findCredentialsByUsername: async () => null },
  });
  await expect(
    new McpWikiApi(partial<McpWikiDependencies>({}), access).authenticate(null),
  ).rejects.toMatchObject({ code: "invalid_token" });
});
