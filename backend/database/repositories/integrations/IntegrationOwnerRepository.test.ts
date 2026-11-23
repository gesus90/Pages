import { expect, it, vi } from "vitest";

import { PostgresSessionLock } from "@/backend/database/postgres/PostgresSessionLock";

import { IntegrationOwnerRepository } from "./IntegrationOwnerRepository";

vi.mock("@/backend/database/postgres/PostgresSessionLock", () => ({
  PostgresSessionLock: vi.fn(
    class {
      public readonly acquire = vi.fn(async () => true);
    },
  ),
}));

it("acquires the advisory lock through a session bound to the database url", async () => {
  const lost = vi.fn();
  const repository = new IntegrationOwnerRepository("postgres://db", lost);

  await expect(repository.acquire()).resolves.toBe(true);

  expect(PostgresSessionLock).toHaveBeenCalledWith("postgres://db", lost);
  const session = vi.mocked(PostgresSessionLock).mock.results[0]?.value as {
    acquire: ReturnType<typeof vi.fn>;
  };
  expect(session.acquire).toHaveBeenCalledWith(
    expect.stringContaining("pg_try_advisory_lock"),
  );
});
