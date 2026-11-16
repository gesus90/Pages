import { expect, it, vi } from "vitest";

import { AgentDeletionService } from "@/backend/service/employee/AgentDeletionService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { AgentDeletionDependencies } from "@/backend/service/employee/AgentDeletionService";

const ACCOUNTS = [
  { userId: "admin", isActive: true, isAdmin: true, mode: "admin" },
  { userId: "agent", isActive: true, isAdmin: false, isAgent: true },
];

it("saves an inventory preview bound to the administrator and agent", async () => {
  const savePreview = vi.fn(async () => {});
  const repository = {
    findDeletion: async () => null,
    inventory: async () => ({
      fingerprint: "hash",
      blockers: [],
      deletes: {},
      keeps: {},
      ownedPlans: [],
    }),
    savePreview,
  };
  const authorization = partial<AuthorizationRepository>({
    snapshot: async () => ({ accounts: ACCOUNTS }),
    users: () => ({ findById: async () => ({ displayName: "Agent" }) }),
    employees: () => ({ deletions: () => repository }),
  });
  const service = new AgentDeletionService(
    partial<AgentDeletionDependencies>({
      authorization: {
        transaction: async (
          work: (value: AuthorizationRepository) => Promise<unknown>,
        ) => work(authorization),
      },
      now: () => new Date("2026-01-01T00:00:00Z"),
    }),
  );
  await expect(service.preview("admin", "agent")).resolves.toMatchObject({
    agentId: "agent",
    displayName: "Agent",
    expiresAt: "2026-01-01T00:10:00.000Z",
  });
  expect(savePreview).toHaveBeenCalledWith(
    expect.objectContaining({
      agentId: "agent",
      actorId: "admin",
      fingerprint: "hash",
    }),
  );
  await expect(service.preview("admin", "admin")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

it("rejects stale and blocked previews before changing the agent", async () => {
  const remove = vi.fn();
  const repository = {
    findOperation: async () => null,
    findDeletion: async () => null,
    findPreview: async () => ({
      agentId: "agent",
      actorId: "admin",
      expiresAt: "2026-01-02",
      fingerprint: "hash",
    }),
    inventory: async () => ({ fingerprint: "hash", blockers: ["running"] }),
    delete: remove,
  };
  const authorization = partial<AuthorizationRepository>({
    snapshot: async () => ({ accounts: ACCOUNTS }),
    employees: () => ({ deletions: () => repository }),
  });
  const service = new AgentDeletionService(
    partial<AgentDeletionDependencies>({
      authorization: {
        transaction: async (
          work: (value: AuthorizationRepository) => Promise<unknown>,
        ) => work(authorization),
      },
      now: () => new Date("2026-01-01T00:00:00Z"),
    }),
  );
  await expect(
    service.delete("admin", "agent", "preview", "operation"),
  ).rejects.toMatchObject({ code: "CONFLICT", reason: "active_runs" });
  await expect(
    service.delete("admin", "agent", "", "operation"),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    reason: "preview_missing",
  });
  expect(remove).not.toHaveBeenCalled();
});
