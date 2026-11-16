import { expect, it, vi } from "vitest";

import { McpWikiContext } from "@/backend/service/mcp/wiki/McpWikiContext";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpWikiDependencies } from "@/backend/service/mcp/wiki/McpWikiContext";
import type { User } from "@/definition/User";

it("checks the current page revision and caches missing people", async () => {
  const getById = vi.fn(async () => null);
  const actor = partial<User>({ id: "actor" });
  const context = new McpWikiContext(
    actor,
    partial<McpWikiDependencies>({
      wiki: { view: async () => ({ page: { revision: 3 } }) },
      users: { getById },
    }),
  );
  await expect(context.pageAtRevision("page", 3)).resolves.toMatchObject({
    page: { revision: 3 },
  });
  await expect(context.pageAtRevision("page", 2)).rejects.toMatchObject({
    code: "conflict",
  });
  await expect(context.person("deleted", "Former")).resolves.toEqual({
    username: "",
    displayName: "Former",
  });
  await context.person("deleted", "Former");
  expect(getById).toHaveBeenCalledOnce();
});

it("only allows owner candidates offered by the wiki service", async () => {
  const actor = partial<User>({ id: "actor" });
  const context = new McpWikiContext(
    actor,
    partial<McpWikiDependencies>({
      users: {
        findCredentialsByUsername: async () => ({ user: { id: "user" } }),
      },
      wiki: { ownerCandidates: async () => [{ id: "user" }] },
    }),
  );
  await expect(context.requireOwnerCandidate(" user ")).resolves.toBe("user");
  const denied = new McpWikiContext(
    actor,
    partial<McpWikiDependencies>({
      users: {
        findCredentialsByUsername: async () => ({ user: { id: "user" } }),
      },
      wiki: { ownerCandidates: async () => [] },
    }),
  );
  await expect(denied.requireOwnerCandidate("user")).rejects.toMatchObject({
    code: "not_found",
  });
});
