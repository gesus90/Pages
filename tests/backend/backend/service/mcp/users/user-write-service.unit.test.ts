import { expect, it, vi } from "vitest";

import { McpUserWriteService } from "@/backend/service/mcp/users/McpUserWriteService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpUserSession } from "@/backend/service/mcp/users/McpUserSession";

it("updates only changed profile fields and rejects a stale expected value", async () => {
  const updateProfile = vi.fn();
  const session = partial<McpUserSession>({
    actor: { userId: "actor" },
    visibleAccount: () => ({ firstName: "Ada", lastName: "Lovelace" }),
    policy: { canChange: () => true },
    repository: {
      users: () => ({
        findById: async () => ({ username: "ada" }),
        findEmailsByUserIds: async () => new Map([["user", "ada@example.com"]]),
      }),
    },
    administration: { updateProfile },
  });
  const service = new McpUserWriteService();
  const unchanged = service.update("user", {
    operationId: "one",
    expected: { firstName: "Ada" },
  });
  await expect(unchanged.apply(session)).resolves.toMatchObject({
    result: { changed: false },
  });
  expect(updateProfile).not.toHaveBeenCalled();
  const changed = service.update("user", {
    operationId: "two",
    firstName: "Grace",
    email: null,
    expected: { username: "ada" },
  });
  await expect(changed.apply(session)).resolves.toMatchObject({
    result: { changed: true },
  });
  expect(updateProfile).toHaveBeenCalledWith("actor", "user", {
    username: "ada",
    firstName: "Grace",
    lastName: "Lovelace",
    email: null,
  });
  const stale = service.update("user", {
    operationId: "three",
    firstName: "Grace",
    expected: { username: "other" },
  });
  await expect(stale.apply(session)).rejects.toMatchObject({
    code: "conflict",
  });
});

it("requires confirmation to deactivate and checks the read state", async () => {
  const setActive = vi.fn();
  const session = partial<McpUserSession>({
    actor: { userId: "actor" },
    visibleAccount: () => ({ isActive: true }),
    policy: { canChange: () => true },
    administration: { setActive },
  });
  const service = new McpUserWriteService();
  const request = {
    operationId: "one",
    isActive: false,
    expected: { isActive: true },
  };
  await expect(
    service.setActive("user", request).apply(session),
  ).rejects.toMatchObject({ code: "confirmation_required" });
  await expect(
    service
      .setActive("user", { ...request, confirmation: "DELETE" })
      .apply(session),
  ).resolves.toMatchObject({ result: { changed: true } });
  expect(setActive).toHaveBeenCalledWith("actor", "user", false);
  await expect(
    service
      .setActive("user", { ...request, expected: { isActive: false } })
      .apply(session),
  ).rejects.toMatchObject({ code: "conflict" });
});

it("compares sorted memberships and protects the final membership", async () => {
  const setMemberships = vi.fn();
  const session = partial<McpUserSession>({
    actor: { userId: "actor" },
    visibleAccount: () => ({ departments: ["b", "a"], hasHadDepartment: true }),
    policy: { canSetMemberships: () => true },
    administration: { setMemberships },
  });
  const service = new McpUserWriteService();
  const request = {
    operationId: "one",
    departmentIds: ["a", "b"],
    expected: { departmentIds: ["a", "b"] },
  };
  await expect(
    service.setDepartments("user", request).apply(session),
  ).resolves.toMatchObject({ result: { changed: false } });
  await expect(
    service
      .setDepartments("user", { ...request, departmentIds: [] })
      .apply(session),
  ).rejects.toMatchObject({ code: "last_membership" });
  await expect(
    service
      .setDepartments("user", { ...request, departmentIds: ["a"] })
      .apply(session),
  ).rejects.toMatchObject({ code: "confirmation_required" });
  await service
    .setDepartments("user", {
      ...request,
      departmentIds: ["a"],
      confirmation: "DELETE",
    })
    .apply(session);
  expect(setMemberships).toHaveBeenCalledWith("actor", "user", ["a"]);
});

it("requires confirmation when management scope is reduced", async () => {
  const setScope = vi.fn();
  const current = {
    managedDepartments: ["b", "a"],
    allDepartments: true,
    allProjects: true,
  };
  const session = partial<McpUserSession>({
    actor: { userId: "actor" },
    visibleAccount: () => current,
    administration: { setScope },
  });
  const service = new McpUserWriteService();
  const request = {
    operationId: "scope",
    scope: {
      managedDepartments: ["a"],
      allDepartments: false,
      allProjects: true,
    },
    expected: { scope: { ...current, managedDepartments: ["a", "b"] } },
  };
  await expect(
    service.setScope("user", request).apply(session),
  ).rejects.toMatchObject({ code: "confirmation_required" });
  await expect(
    service
      .setScope("user", { ...request, confirmation: "DELETE" })
      .apply(session),
  ).resolves.toMatchObject({ result: { changed: true } });
  expect(setScope).toHaveBeenCalledWith("actor", "user", request.scope);
});

it("requires confirmation for administrator changes and skips unchanged settings", async () => {
  const setAdministrator = vi.fn();
  const session = partial<McpUserSession>({
    actor: { userId: "actor" },
    visibleAccount: () => ({ isAdmin: false }),
    administration: { setAdministrator },
  });
  const service = new McpUserWriteService();
  const request = {
    operationId: "admin",
    isAdmin: true,
    expected: { isAdmin: false },
  };
  await expect(
    service.setAdministrator("user", request).apply(session),
  ).rejects.toMatchObject({ code: "confirmation_required" });
  await service
    .setAdministrator("user", { ...request, confirmation: "DELETE" })
    .apply(session);
  expect(setAdministrator).toHaveBeenCalledWith("actor", "user", true);
  await expect(
    service
      .setAdministrator("user", { ...request, isAdmin: false })
      .apply(session),
  ).resolves.toMatchObject({ result: { changed: false } });
});

it("creates a user with a trimmed name and returns the temporary credential", async () => {
  const createUser = vi.fn(async () => ({ temporaryPassword: "temporary" }));
  const session = partial<McpUserSession>({
    actor: { userId: "actor" },
    administration: { createUser },
    repository: {
      users: () => ({ findAll: async () => [{ id: "user", username: "ada" }] }),
    },
  });
  const request = {
    operationId: "create",
    username: " ada ",
    firstName: "Ada",
    lastName: "Lovelace",
    email: null,
    roleId: null,
    isAdmin: false,
    departmentIds: [],
  };
  await expect(
    new McpUserWriteService().create(request).apply(session),
  ).resolves.toMatchObject({
    result: { id: "user", changed: true },
    credential: {
      user: { id: "user", username: "ada" },
      temporaryPassword: "temporary",
    },
  });
  expect(createUser).toHaveBeenCalledWith(
    "actor",
    expect.objectContaining({ username: "ada" }),
  );
});
