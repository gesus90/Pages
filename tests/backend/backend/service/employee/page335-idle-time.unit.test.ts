import { expect, it, vi } from "vitest";

import { AgentSessionSettingsRepository } from "@/backend/database/repositories/employee/AgentSessionSettingsRepository";
import { AgentSessionLimitService } from "@/backend/service/employee/AgentSessionLimitService";

import type { AccountAccess } from "@/definition/Authorization";
import type { AgentSessionLimits } from "@/definition/AgentSessionLimits";

const LIMITS: AgentSessionLimits = {
  perAgent: 4,
  total: 16,
  revision: 2,
  dreamTime: "03:00",
  idleMinutes: 10,
};

const ADMINISTRATOR: AccountAccess = {
  userId: "admin",
  role: null,
  isAdmin: true,
  mode: "admin",
  firstName: "Ada",
  lastName: "Admin",
  isActive: true,
  departments: [],
  managedDepartments: [],
  allDepartments: true,
  allProjects: true,
  hasHadDepartment: false,
};

function service(): {
  readonly limits: AgentSessionLimitService;
  readonly save: ReturnType<typeof vi.fn>;
} {
  const save = vi.fn(async () => undefined);
  const settings: unknown = { read: vi.fn(async () => LIMITS), save };
  const slots = { apply: vi.fn(), running: 0, waiting: 0 };
  return {
    limits: new AgentSessionLimitService(
      settings as AgentSessionSettingsRepository,
      slots,
    ),
    save,
  };
}

it("reads the idle time of a resting chat session from the agent settings", async () => {
  await expect(service().limits.idleMinutes()).resolves.toBe(10);
});

it("saves an idle time from 1 to 1440 minutes and refuses any other", async () => {
  const { limits, save } = service();
  const input = {
    perAgent: "4",
    total: "16",
    revision: "2",
    dreamTime: "03:00",
  };
  await limits.save(ADMINISTRATOR, { ...input, idleMinutes: "30" });
  expect(save).toHaveBeenCalledWith({ ...LIMITS, idleMinutes: 30 });
  for (const idleMinutes of ["0", "1441", "abc", "2.5"])
    await expect(
      limits.save(ADMINISTRATOR, { ...input, idleMinutes }),
    ).rejects.toMatchObject({ code: "profile_invalid" });
  expect(save).toHaveBeenCalledOnce();
});

it("stores and reads the idle time in its own column", async () => {
  const query = vi.fn(async (statement: string) =>
    statement.includes("UPDATE") ? [[1]] : [[4, 16, 2, "03:00", 25]],
  );
  const repository = new AgentSessionSettingsRepository({ query });
  await expect(repository.read()).resolves.toEqual({
    ...LIMITS,
    idleMinutes: 25,
  });
  expect(query.mock.calls[0]?.[0]).toContain("idle_minutes");
  await repository.save({ ...LIMITS, idleMinutes: 45 });
  expect(query).toHaveBeenLastCalledWith(
    expect.stringContaining("idle_minutes = $idle_minutes"),
    expect.objectContaining({ idle_minutes: 45 }),
  );
});
