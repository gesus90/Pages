import { expect, it, vi, type Mock } from "vitest";

import {
  PlanBridgeGrantRepository,
  type StoredPlanBridgeGrant,
} from "./PlanBridgeGrantRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

const GRANT: StoredPlanBridgeGrant = {
  bearerHash: "b",
  credentialHash: "c",
  runId: "r",
  stepId: "s",
  instanceId: "i",
  sealedToken: "t",
  expiresAt: 1234,
};

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: PlanBridgeGrantRepository;
  readonly execute: Mock<Database["execute"]>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  return {
    repository: new PlanBridgeGrantRepository({ execute, query }),
    execute,
  };
}

it("inserts a grant with its creation time", async () => {
  const { repository, execute } = repositoryOf();

  await repository.insert(GRANT, 99);

  expect(execute.mock.calls[0]?.[1]).toEqual({
    bearer_hash: "b",
    credential_hash: "c",
    run_id: "r",
    step_id: "s",
    instance_id: "i",
    sealed_token: "t",
    expires_at: 1234,
    created_at: 99,
  });
});

it("finds a grant and converts the expiry to a number", async () => {
  const { repository } = repositoryOf([["b", "c", "r", "s", "i", "t", "1234"]]);

  expect(await repository.find("b")).toEqual(GRANT);
});

it("returns null for an unknown bearer hash", async () => {
  const { repository } = repositoryOf();

  expect(await repository.find("x")).toBeNull();
});

it("deletes the grant of one bearer hash", async () => {
  const { repository, execute } = repositoryOf();

  await repository.delete("b");

  expect(execute.mock.calls[0]?.[1]).toEqual({ bearer_hash: "b" });
});

it("revokes one step or every step of a run", async () => {
  const { repository, execute } = repositoryOf();

  await repository.revoke("r", "s");
  await repository.revoke("r", null);

  expect(execute.mock.calls[0]?.[1]).toEqual({ run_id: "r", step_id: "s" });
  expect(String(execute.mock.calls[0]?.[0])).toContain("AND step_id");
  expect(execute.mock.calls[1]?.[1]).toEqual({ run_id: "r" });
  expect(String(execute.mock.calls[1]?.[0])).not.toContain("AND step_id");
});
