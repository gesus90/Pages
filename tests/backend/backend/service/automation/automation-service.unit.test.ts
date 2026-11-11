import { afterEach, expect, it, vi } from "vitest";

import { AutomationNotificationPreferenceRepository } from "@/backend/database/repositories/automation/AutomationNotificationPreferenceRepository";
import { AutomationAccess } from "@/backend/service/automation/AutomationAccess";
import { AutomationReads } from "@/backend/service/automation/AutomationReads";
import { AutomationService } from "@/backend/service/automation/AutomationService";
import { AutomationWrites } from "@/backend/service/automation/AutomationWrites";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { Database } from "@/backend/database/Database";
import type { AutomationDirectory } from "@/backend/service/automation/AutomationDirectory";

const directory = partial<AutomationDirectory>({
  sharingNames: vi.fn().mockResolvedValue(new Map([["project", "Project"]])),
});
const database = partial<Pick<Database, "query" | "execute" | "transaction">>(
  {},
);

function service(): AutomationService {
  return new AutomationService({
    database,
    directory,
    now: () => new Date("2030-01-01T00:00:00.000Z"),
  });
}

afterEach(() => vi.restoreAllMocks());

it("delegates reads and writes with the calling account and input", async () => {
  const reads = vi
    .spyOn(AutomationReads.prototype, "read")
    .mockResolvedValue(partial({ id: "automation" }));
  const writes = vi
    .spyOn(AutomationWrites.prototype, "setActive")
    .mockResolvedValue(partial({ id: "automation", isActive: true }));
  const subject = service();
  const input = { automationId: "automation" };
  await expect(subject.read("user", input)).resolves.toEqual({
    id: "automation",
  });
  await expect(subject.setActive("user", input)).resolves.toEqual({
    id: "automation",
    isActive: true,
  });
  expect(reads).toHaveBeenCalledWith("user", input);
  expect(writes).toHaveBeenCalledWith("user", input);
  await expect(subject.sharingNames()).resolves.toEqual(
    new Map([["project", "Project"]]),
  );
  expect(subject.rules).toBeInstanceOf(AutomationAccess);
});

it("validates notification preferences before resolving the actor or saving", async () => {
  const actor = vi
    .spyOn(AutomationAccess.prototype, "actor")
    .mockResolvedValue(partial({ id: "user" }));
  const save = vi
    .spyOn(AutomationNotificationPreferenceRepository.prototype, "save")
    .mockResolvedValue(undefined);
  const find = vi
    .spyOn(AutomationNotificationPreferenceRepository.prototype, "find")
    .mockResolvedValue("error");
  const subject = service();
  await expect(
    subject.setNotificationMode("user", "unknown"),
  ).rejects.toMatchObject({ code: "invalid_request", reason: "validation" });
  expect(actor).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  await expect(subject.setNotificationMode("user", "always")).resolves.toBe(
    "always",
  );
  expect(actor).toHaveBeenCalledWith("user");
  expect(save).toHaveBeenCalledWith(
    "user",
    "always",
    "2030-01-01T00:00:00.000Z",
  );
  await expect(subject.notificationMode("user")).resolves.toBe("error");
  expect(find).toHaveBeenCalledWith("user");
});
