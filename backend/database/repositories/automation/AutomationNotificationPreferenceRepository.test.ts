import { expect, it, vi } from "vitest";

import {
  AutomationNotificationPreferenceRepository,
  DEFAULT_AUTOMATION_NOTIFICATION,
} from "./AutomationNotificationPreferenceRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: AutomationNotificationPreferenceRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AutomationNotificationPreferenceRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

it.each(["off", "always", "error"])(
  "returns the stored mode %s",
  async (mode) => {
    const { repository, query } = doubleOf([[mode]]);

    expect(await repository.find("u1")).toBe(mode);
    expect(query.mock.calls[0]?.[1]).toEqual({ user_id: "u1" });
  },
);

it("falls back to the default without a stored choice", async () => {
  const { repository } = doubleOf([]);

  expect(await repository.find("u1")).toBe(DEFAULT_AUTOMATION_NOTIFICATION);
});

it("falls back to the default for an unknown stored mode", async () => {
  const { repository } = doubleOf([["loud"]]);

  expect(await repository.find("u1")).toBe(DEFAULT_AUTOMATION_NOTIFICATION);
});

it("stores the mode of a person", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.save("u1", "always", "t");

  expect(execute.mock.calls[0]?.[1]).toEqual({
    user_id: "u1",
    mode: "always",
    updated_at: "t",
  });
});
