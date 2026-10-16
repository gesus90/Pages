import { expect, it, vi } from "vitest";

import { AcpResourceRepository } from "@/backend/database/repositories/agent/AcpResourceRepository";

import { owner } from "../../../service/agents/page81-resource-fixture";

import type { Database } from "@/backend/database/Database";

function database(): Pick<Database, "query" | "execute"> {
  return {
    query: vi.fn<Database["query"]>(async () => []),
    execute: vi.fn(async () => {}),
  };
}

it("journals only explicit ownership and lifecycle fields using bound SQL parameters", async () => {
  const connection = database();
  const repository = new AcpResourceRepository(connection);
  const record = {
    ...owner("native-tag"),
    state: "starting" as const,
    since: "2026-10-16",
  };
  await repository.save(record);
  expect(connection.execute).toHaveBeenCalledWith(
    expect.stringContaining("ON CONFLICT"),
    {
      instance_id: "native-tag",
      user_id: "owner",
      provider: "codex_cli",
      run_id: "run-native-tag",
      step_id: "step",
      state: "starting",
      since: "2026-10-16",
    },
  );
  await repository.remove("native-tag");
  expect(connection.execute).toHaveBeenLastCalledWith(
    expect.stringContaining("DELETE FROM acp_resource_leases"),
    { instance_id: "native-tag" },
  );
});

it("maps durable states on restart and refuses unknown providers or states", async () => {
  const connection = database();
  const repository = new AcpResourceRepository(connection);
  vi.mocked(connection.query).mockResolvedValueOnce([
    ["tag", "owner", "claude_code", null, null, "cleanup_failed", "today"],
  ]);
  expect(await repository.list()).toEqual([
    {
      instanceId: "tag",
      userId: "owner",
      provider: "claude_code",
      runId: null,
      stepId: null,
      state: "cleanup_failed",
      since: "today",
    },
  ]);
  vi.mocked(connection.query).mockResolvedValueOnce([
    ["tag", "owner", "unknown", null, null, "starting", "today"],
  ]);
  await expect(repository.list()).rejects.toThrow("provider");
  vi.mocked(connection.query).mockResolvedValueOnce([
    ["tag", "owner", "codex_cli", null, null, "unknown", "today"],
  ]);
  await expect(repository.list()).rejects.toThrow("state");
});
