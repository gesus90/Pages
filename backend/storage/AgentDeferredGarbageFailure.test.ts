import { expect, it, vi } from "vitest";

import type * as FileSystem from "node:fs/promises";
import type { DatabaseTransaction } from "@/backend/database/Database";

const boundary = vi.hoisted(() => ({ stat: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  lstat: boundary.stat,
}));

import { AgentDeferredGarbage } from "./AgentDeferredGarbage";

it("retains a deletion after a filesystem permission failure and retries it later", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  const failure = Object.assign(new Error("permission denied"), {
    code: "EACCES",
  });
  boundary.stat
    .mockReset()
    .mockRejectedValueOnce(failure)
    .mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
  const name = "plan-sessions/12345678-1234-1234-1234-123456789abc/";
  const query = vi.fn<DatabaseTransaction["query"]>(
    async (statement, parameters) => (parameters?.after === "" ? [[name]] : []),
  );
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = async <Result>(
    work: (access: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work({ query, execute });
  const collector = new AgentDeferredGarbage({
    directory: "/isolated",
    removePayload: async () => {},
    retryDelayMs: 1000,
  });
  try {
    collector.schedule({ query, execute, transaction });
    await collector.idle();
    expect(execute).not.toHaveBeenCalled();
    collector.schedule({ query, execute, transaction });
    await collector.idle();
    expect(boundary.stat).toHaveBeenCalledTimes(1);
    vi.setSystemTime(11000);
    collector.schedule({ query, execute, transaction });
    await collector.idle();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][1]).toEqual({ storage_name: name });
  } finally {
    await collector.close();
    vi.useRealTimers();
  }
});
