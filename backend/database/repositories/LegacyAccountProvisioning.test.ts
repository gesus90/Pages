import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { provisionAccount } from "./LegacyAccountProvisioning";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { NewUser } from "./UserRepository";

interface Harness {
  readonly execute: Mock;
  readonly query: Mock;
  readonly transaction: DatabaseTransaction;
}

function transactionOf(inserted: unknown[][]): Harness {
  const execute = vi.fn(async () => undefined);
  const query = vi.fn(async () => inserted);
  return {
    execute,
    query,
    transaction: { execute, query } as unknown as DatabaseTransaction,
  };
}

function userOf(role: string, extra: object = {}): NewUser {
  return { id: "u", displayName: "Ada", role, ...extra } as unknown as NewUser;
}

it("seeds the manager profile and grants all projects", async () => {
  const { transaction, execute, query } = transactionOf([["legacy-manager"]]);
  await provisionAccount(transaction, userOf("manager"));
  expect(query).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(5);
  expect(execute).toHaveBeenLastCalledWith(
    expect.stringContaining("INSERT INTO user_authorization"),
    expect.objectContaining({
      role: "legacy-manager",
      admin: false,
      mode: "role",
      first: "Ada",
      last: "",
      all_projects: true,
    }),
  );
});

it("keeps a customized profile untouched", async () => {
  const { transaction, execute } = transactionOf([]);
  await provisionAccount(transaction, userOf("employee"));
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ role: "legacy-employee", all_projects: false }),
  );
});

it("creates an administrator without a profile", async () => {
  const { transaction, execute, query } = transactionOf([]);
  await provisionAccount(transaction, userOf("admin"));
  expect(query).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ role: null, admin: true, mode: "admin" }),
  );
});

it("uses explicit authorization without seeding", async () => {
  const { transaction, execute, query } = transactionOf([]);
  await provisionAccount(
    transaction,
    userOf("manager", {
      authorization: {
        roleId: "r",
        isAdmin: false,
        mode: "role",
        firstName: "F",
        lastName: "L",
      },
    }),
  );
  expect(query).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      role: "r",
      first: "F",
      last: "L",
      all_projects: false,
    }),
  );
});
