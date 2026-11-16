import { expect, it, vi } from "vitest";

import { McpPlanNotationService } from "@/backend/service/mcp/plan/McpPlanNotationService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpPlanNotationDependencies } from "@/backend/service/mcp/plan/McpPlanNotationCatalogs";
import type { User } from "@/definition/User";

it("reports syntax errors without reading or saving a workspace", async () => {
  const workspaces = vi.fn();
  const save = vi.fn();
  const service = new McpPlanNotationService(
    partial<McpPlanNotationDependencies>({ plans: { workspaces, save } }),
  );
  const result = await service.check(partial<User>({ id: "actor" }), {
    notation: "not a graph",
  });
  expect(result.ok).toBe(false);
  expect(result.issues.length).toBeGreaterThan(0);
  expect(result.preview).toBeNull();
  expect(workspaces).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it("rejects an invalid notation before creating a plan", async () => {
  const save = vi.fn();
  const service = new McpPlanNotationService(
    partial<McpPlanNotationDependencies>({ plans: { save } }),
  );
  await expect(
    service.create(partial<User>({ id: "actor" }), "not a graph"),
  ).rejects.toMatchObject({ code: "notation_invalid" });
  expect(save).not.toHaveBeenCalled();
});
