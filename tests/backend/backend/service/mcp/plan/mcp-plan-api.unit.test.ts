import { beforeEach, expect, it, vi } from "vitest";

import { McpPlanApi } from "@/backend/service/mcp/plan/McpPlanApi";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type {
  McpPlanAccess,
  McpPlanServices,
} from "@/backend/service/mcp/plan/McpPlanApi";
import type { AgentIdentity } from "@/definition/McpAuthorization";

const handle = vi.fn();
const authenticate = vi.fn();
const credentials = vi.fn();
const verify = vi.fn();
const identity = partial<AgentIdentity>({ userId: "user" });
const api = new McpPlanApi(
  partial<McpPlanServices>({ operations: { handle }, identities: { verify } }),
  partial<McpPlanAccess>({
    devices: { authenticate },
    accounts: { findCredentialsByUsername: credentials },
  }),
);

beforeEach(() => {
  vi.resetAllMocks();
  authenticate.mockResolvedValue({ account: { username: "alice" } });
  credentials.mockResolvedValue({
    user: { id: "user", isActive: true },
    passwordHash: "hidden",
  });
  verify.mockResolvedValue(identity);
});

it("authenticates the current active account without exposing credentials", async () => {
  expect(await api.authenticate("Bearer token")).toBe(identity);
  expect(verify).toHaveBeenCalledWith("user");
  credentials.mockResolvedValue({ user: { id: "user", isActive: false } });
  await expect(api.authenticate("Bearer token")).rejects.toThrow();
  credentials.mockResolvedValue(null);
  await expect(api.authenticate(null)).rejects.toThrow();
});

it("passes path and request parameters to the operation and rejects duplicates", async () => {
  handle.mockResolvedValue({ result: { plan: { name: "Plan" } } });
  expect(
    await api.run(identity, "plans.read", {
      path: { planId: "p" },
      parameters: { cursor: "next" },
    }),
  ).toEqual({ plan: { name: "Plan" } });
  expect(handle).toHaveBeenCalledWith(identity, "plans.read", {
    planId: "p",
    cursor: "next",
  });
  await expect(
    api.run(identity, "plans.read", {
      path: { planId: "p" },
      parameters: { planId: "other" },
    }),
  ).rejects.toThrow();
  handle.mockResolvedValue(null);
  await expect(
    api.run(identity, "plans.list", { path: {}, parameters: {} }),
  ).rejects.toThrow();
});

it("describes a template before dispatching a confirmed removal", async () => {
  handle
    .mockResolvedValueOnce({
      result: {
        template: { id: "t", name: "Template", type: "agent", isShared: false },
      },
    })
    .mockResolvedValueOnce({ result: { deleted: true } });
  expect(
    await api.deleteTemplate(identity, {
      path: { templateId: "t" },
      parameters: { workspaceId: "w" },
    }),
  ).toEqual({
    confirmationRequired: true,
    template: { id: "t", name: "Template", type: "agent", isShared: false },
  });
  expect(
    await api.deleteTemplate(identity, {
      path: { templateId: "t" },
      parameters: { workspaceId: "w", confirmed: true, confirmation: "legacy" },
    }),
  ).toEqual({ deleted: true });
  expect(handle).toHaveBeenLastCalledWith(identity, "plans.templates.delete", {
    workspaceId: "w",
    templateId: "t",
  });
  await expect(
    api.deleteTemplate(identity, {
      path: { templateId: "t" },
      parameters: { confirmed: "yes" },
    }),
  ).rejects.toThrow();
  await expect(
    api.deleteTemplate(identity, {
      path: { templateId: "t" },
      parameters: { unexpected: true },
    }),
  ).rejects.toThrow();
});

it("reassembles a chunked plan name for the confirmation question", async () => {
  handle
    .mockResolvedValueOnce({
      result: {
        control: {
          planId: "p",
          canDelete: true,
          blockers: { delete: null },
          runId: null,
        },
      },
    })
    .mockResolvedValueOnce({
      result: { chunk: { text: '{"plan":{"name":', nextCursor: "next" } },
    })
    .mockResolvedValueOnce({
      result: { chunk: { text: '"Plan"}}', nextCursor: null } },
    });
  expect(
    await api.deletePlan(identity, { path: { planId: "p" }, parameters: {} }),
  ).toEqual({
    confirmationRequired: true,
    plan: { id: "p", name: "Plan" },
    canDelete: true,
    blocker: null,
    runId: null,
  });
  expect(handle).toHaveBeenLastCalledWith(identity, "plans.read", {
    planId: "p",
    cursor: "next",
  });
});
