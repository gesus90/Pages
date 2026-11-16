import { expect, it, vi } from "vitest";

import { McpTicketContext } from "@/backend/service/mcp/ticket/McpTicketContext";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpTicketDependencies } from "@/backend/service/mcp/ticket/McpTicketContext";
import type { User } from "@/definition/User";

it("normalizes ticket keys and caches person lookups per request", async () => {
  const getByKey = vi.fn(async () => ({ id: "ticket" }));
  const getById = vi.fn(async () => ({ username: "ada", displayName: "Ada" }));
  const actor = partial<User>({ id: "actor" });
  const context = new McpTicketContext(
    actor,
    partial<McpTicketDependencies>({ tasks: { getByKey }, users: { getById } }),
  );
  await context.ticket(" page-12 ");
  expect(getByKey).toHaveBeenCalledWith(actor, "PAGE-12");
  await expect(context.person("user")).resolves.toEqual({
    username: "ada",
    displayName: "Ada",
  });
  await context.person("user");
  expect(getById).toHaveBeenCalledOnce();
  await expect(context.ticket(" ")).rejects.toThrow();
});

it("resolves only visible people and checks project assignment eligibility", async () => {
  const user = { id: "person", username: "Ada", displayName: "Ada" };
  const findAssigneesByProjects = vi.fn(
    async () => new Map([["project", [user]]]),
  );
  const context = new McpTicketContext(
    partial<User>({ id: "actor" }),
    partial<McpTicketDependencies>({
      projects: { findAll: async () => [{ id: "project" }] },
      tasks: { findAssigneesByProjects, findEligibleAssignees: async () => [] },
    }),
  );
  await expect(context.requireVisiblePerson(" ada ")).resolves.toEqual(user);
  await expect(
    context.requireAssignablePerson("project", "Ada"),
  ).rejects.toMatchObject({ code: "invalid_request" });
  await expect(context.requireVisiblePerson("unknown")).rejects.toMatchObject({
    code: "not_found",
  });
  expect(findAssigneesByProjects).toHaveBeenCalledOnce();
});
