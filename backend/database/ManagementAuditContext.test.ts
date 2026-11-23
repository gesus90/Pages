import { expect, it } from "vitest";

import {
  managementAuditActor,
  withManagementAudit,
} from "@/backend/database/ManagementAuditContext";

it("carries the actor through async work only", async () => {
  expect(managementAuditActor()).toBeUndefined();
  const seen = await withManagementAudit("user-1", async () => {
    await Promise.resolve();
    return managementAuditActor();
  });
  expect(seen).toBe("user-1");
  expect(managementAuditActor()).toBeUndefined();
});
