import { expect, it, vi } from "vitest";

import { PersonColorService } from "@/backend/service/employee/PersonColorService";
import { PERSON_COLORS } from "@/definition/PersonColor";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";

it("normalizes an own palette color and supports clearing it", async () => {
  const setColor = vi.fn(async () => undefined);
  const invalidateUsers = vi.fn();
  const authorization = partial<AuthorizationRepository>({
    employees: () => ({ identities: () => ({ setColor }) }),
  });
  const service = new PersonColorService(authorization, { invalidateUsers });
  const color = PERSON_COLORS[0];
  if (!color) throw new Error("Expected a palette color");
  await service.setOwn("user", color.toUpperCase());
  await service.setOwn("user", "");
  expect(setColor.mock.calls).toEqual([
    ["user", color],
    ["user", null],
  ]);
  expect(invalidateUsers).toHaveBeenCalledTimes(2);
  await expect(service.setOwn("user", "not-a-color")).rejects.toMatchObject({
    code: "invalidInput",
  });
  expect(invalidateUsers).toHaveBeenCalledTimes(2);
});

it("refuses another account when the actor is inactive or missing", async () => {
  const setColor = vi.fn();
  const invalidateUsers = vi.fn();
  const repository = {
    snapshot: async () => ({
      accounts: [{ userId: "actor", isActive: false }, { userId: "target" }],
    }),
    employees: () => ({ identities: () => ({ setColor }) }),
  };
  const authorization = partial<AuthorizationRepository>({
    transaction: async (work: (scope: typeof repository) => Promise<void>) =>
      work(repository),
  });
  const service = new PersonColorService(authorization, { invalidateUsers });
  await expect(service.set("actor", "target", null)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(setColor).not.toHaveBeenCalled();
  expect(invalidateUsers).not.toHaveBeenCalled();
});
