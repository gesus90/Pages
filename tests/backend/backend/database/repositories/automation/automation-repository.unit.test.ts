import { beforeEach, expect, it, vi } from "vitest";

import { AutomationRepository } from "@/backend/database/repositories/automation/AutomationRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";

const query = vi.fn();
const execute = vi.fn();
const repository = new AutomationRepository(
  partial<DatabaseTransaction>({ query, execute }),
);
const row = [
  "automation",
  "user",
  "Name",
  '{"type":"manual"}',
  '{"type":"plan","planId":"plan"}',
  "project",
  "project",
  1,
  0,
  "error",
  "agent",
  null,
  2,
  "created",
  "updated",
];
const automation: StoredAutomation = {
  id: "automation",
  creatorId: "user",
  name: "Name",
  trigger: { type: "manual" },
  action: { type: "plan", planId: "plan" },
  sharing: { scope: "project", projectId: "project" },
  isActive: true,
  deleteAfterSuccess: false,
  agentNotification: { mode: "error", agentId: "agent" },
  nextRunAt: null,
  revision: 2,
  createdAt: "created",
  updatedAt: "updated",
};

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue([]);
});

it("parses stored automation contracts and visibility", async () => {
  query.mockResolvedValue([row]);
  expect(await repository.find("automation")).toEqual(automation);
  expect(
    await repository.list({
      viewerId: "user",
      isAdministrator: false,
      limit: 10,
    }),
  ).toEqual([automation]);
  expect(query).toHaveBeenLastCalledWith(
    expect.stringContaining("$viewer_id"),
    expect.objectContaining({ viewer_id: "user" }),
  );
});

it("refuses invalid stored action or trigger JSON", async () => {
  const invalid = [...row];
  invalid[3] = '{"type":"invalid"}';
  query.mockResolvedValueOnce([invalid]);
  await expect(repository.find("automation")).rejects.toThrow();
});

it("serializes only explicit trigger, action and share settings", async () => {
  await repository.insert(automation);
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO automations"),
    expect.objectContaining({
      id: "automation",
      sharing_scope: "project",
      sharing_target_id: "project",
      notification_mode: "error",
    }),
  );
  await repository.schedule("automation", "later");
  expect(execute).toHaveBeenLastCalledWith(
    expect.stringContaining("next_run_at"),
    { id: "automation", next_run_at: "later" },
  );
});
