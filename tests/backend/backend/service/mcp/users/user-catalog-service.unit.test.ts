import { expect, it, vi } from "vitest";

import { McpUserCatalogService } from "@/backend/service/mcp/users/McpUserCatalogService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpUserSession } from "@/backend/service/mcp/users/McpUserSession";

it("requires confirmation when assigning a role removes permissions", async () => {
  const assignRole = vi.fn();
  const target = {
    userId: "user",
    role: { id: "old", permissions: ["manage_users"] },
  };
  const session = partial<McpUserSession>({
    actor: { userId: "actor" },
    visibleRole: () => ({ id: "new", permissions: [] }),
    visibleAccount: () => target,
    policy: { canAssignRole: () => true, canChange: () => true },
    administration: { assignRole },
  });
  const service = new McpUserCatalogService();
  const request = {
    operationId: "operation",
    targetType: "person" as const,
    targetId: "user",
    expectedAssignments: [{ userId: "user", roleId: "old" }],
  };
  await expect(
    service.assignRole("new", request).apply(session),
  ).rejects.toMatchObject({ code: "confirmation_required" });
  expect(assignRole).not.toHaveBeenCalled();
  await expect(
    service
      .assignRole("new", { ...request, confirmation: "DELETE" })
      .apply(session),
  ).resolves.toMatchObject({
    result: { changed: true, affectedUserIds: ["user"] },
  });
  expect(assignRole).toHaveBeenCalledWith("actor", "user", "new");
});

it("rejects stale assignments before writing", async () => {
  const assignRole = vi.fn();
  const session = partial<McpUserSession>({
    actor: { userId: "actor" },
    visibleRole: () => ({ id: "new", permissions: [] }),
    visibleAccount: () => ({ userId: "user", role: null }),
    policy: { canAssignRole: () => true, canChange: () => true },
    administration: { assignRole },
  });
  const request = {
    operationId: "operation",
    targetType: "person" as const,
    targetId: "user",
    expectedAssignments: [{ userId: "user", roleId: "old" }],
  };
  await expect(
    new McpUserCatalogService().assignRole("new", request).apply(session),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(assignRole).not.toHaveBeenCalled();
});
