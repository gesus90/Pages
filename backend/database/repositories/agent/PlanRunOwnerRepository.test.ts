import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  created: [] as unknown[][],
  acquire: vi.fn(async () => true),
}));
vi.mock("@/backend/database/postgres/PostgresSessionLock", () => ({
  PostgresSessionLock: class {
    public readonly acquire = mocks.acquire;
    public constructor(...args: unknown[]) {
      mocks.created.push(args);
    }
  },
}));

import { PlanRunOwnerRepository } from "./PlanRunOwnerRepository";

it("takes the engine lock by default", async () => {
  const lost = vi.fn();

  const owner = new PlanRunOwnerRepository("postgres://x", lost);

  await expect(owner.acquire()).resolves.toBe(true);
  expect(mocks.created.at(-1)).toEqual([
    "postgres://x",
    lost,
    "pages-runs-owner",
  ]);
  expect(mocks.acquire).toHaveBeenLastCalledWith(
    "SELECT pg_try_advisory_lock(1346455365, 226) AS owned;",
  );
});

it("takes the separate lock of the api role", async () => {
  const owner = new PlanRunOwnerRepository("postgres://x", vi.fn(), "api");

  await owner.acquire();

  expect(mocks.created.at(-1)?.[2]).toBe("pages-runs-api-owner");
  expect(mocks.acquire).toHaveBeenLastCalledWith(
    "SELECT pg_try_advisory_lock(1346455365, 22601) AS owned;",
  );
});
