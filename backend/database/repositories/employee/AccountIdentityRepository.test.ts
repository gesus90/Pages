import { expect, it, vi } from "vitest";

import { AccountIdentityRepository } from "./AccountIdentityRepository";

import { UsernameTakenError } from "@/backend/error/UserErrors";

import type { Database } from "@/backend/database/Database";

const IDENTITY = {
  username: "ada",
  displayName: "Ada",
  jobTitle: null,
  avatarColor: "red",
};

function doubleOf(
  rows: unknown[][],
  failure?: unknown,
): {
  repository: AccountIdentityRepository;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => {
    if (failure !== undefined) throw failure;
  });
  return {
    repository: new AccountIdentityRepository({
      query: vi.fn(async () => rows),
      execute,
    } as unknown as Database),
    execute,
  };
}

function uniqueViolation(detail: string): Error {
  return Object.assign(new Error("duplicate"), { code: "23505", detail });
}

it("inserts an agent account with its identity", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.insertAgent("u1", IDENTITY);

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    id: "u1",
    username: "ada",
    display_name: "Ada",
    job_title: null,
    avatar_color: "red",
  });
});

it("reports a taken username on insert and update", async () => {
  const plain = doubleOf([], uniqueViolation("Key (username)=(ada) exists"));
  const lowered = doubleOf(
    [],
    uniqueViolation("Key (lower(username))=(ada) exists"),
  );

  await expect(plain.repository.insertAgent("u1", IDENTITY)).rejects.toThrow(
    UsernameTakenError,
  );
  await expect(lowered.repository.updateAgent("u1", IDENTITY)).rejects.toThrow(
    UsernameTakenError,
  );
});

it("passes other failures through", async () => {
  const failure = new Error("down");
  const { repository } = doubleOf([], failure);

  await expect(repository.insertAgent("u1", IDENTITY)).rejects.toBe(failure);
  await expect(repository.updateAgent("u1", IDENTITY)).rejects.toBe(failure);
});

it("updates an agent account", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.updateAgent("u1", IDENTITY);

  expect(execute.mock.calls[0]?.[1]).toMatchObject({ id: "u1" });
});

it("sets a color", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.setColor("u1", null);

  expect(execute.mock.calls[0]?.[1]).toEqual({ id: "u1", avatar_color: null });
});

it("lists job titles by user", async () => {
  const { repository } = doubleOf([
    ["a", "Chef"],
    ["b", null],
  ]);

  expect(await repository.jobTitles()).toEqual(
    new Map([
      ["a", "Chef"],
      ["b", null],
    ]),
  );
});
