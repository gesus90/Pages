import { expect, it, vi } from "vitest";

import { ManagementOperations } from "@/backend/service/management/ManagementOperations";
import { MANAGEMENT_READ_OPERATIONS } from "@/definition/Management";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { ManagementService } from "@/backend/service/management/ManagementService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

const identity = partial<AgentIdentity>({ userId: "user", isAdmin: true });

it("audits operations against the most specific supplied target", async () => {
  const run = vi.fn(
    async (
      user: string,
      operation: string,
      target: string,
      work: () => Promise<string>,
    ) => {
      void user;
      void operation;
      void target;
      return work();
    },
  );
  const operations = new ManagementOperations(() =>
    partial<ManagementService>({ audit: { run } }),
  );
  await expect(
    operations.audited(
      identity,
      "update",
      { ticketId: "ticket", planId: "plan" },
      async () => "saved",
    ),
  ).resolves.toBe("saved");
  await operations.audited(identity, "read", null, async () => "read");
  expect(run.mock.calls[0]?.slice(0, 3)).toEqual(["user", "update", "ticket"]);
  expect(run.mock.calls[1]?.slice(0, 3)).toEqual(["user", "read", "directory"]);
});

it("uses the selected channel only for authorized revisions and known operations", async () => {
  const call = vi.fn(async () => ({ ok: true }));
  const projectRevision = vi.fn(async () => "revision");
  const operations = new ManagementOperations(
    () => partial<ManagementService>({ call, projectRevision }),
    "ui",
  );
  await expect(
    operations.projectRevision(
      partial({ userId: "user", isAdmin: false, isManagement: false }),
      "project",
    ),
  ).resolves.toBeUndefined();
  await expect(operations.projectRevision(identity, "project")).resolves.toBe(
    "revision",
  );
  expect(projectRevision).toHaveBeenCalledWith("user", "project", "ui");
  expect(await operations.handle(identity, "unknown", {})).toBeNull();
  const known = MANAGEMENT_READ_OPERATIONS[0];
  await expect(
    operations.handle(identity, known, { id: "x" }),
  ).resolves.toEqual({ apiVersion: "1", result: { ok: true } });
  expect(call).toHaveBeenCalledWith("user", known, { id: "x" }, "ui");
});
