import { describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { withDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { withPostgresWriterOwnership } from "@/backend/database/postgres/PostgresWriterOwnership";

import type { PostgresConnection } from "@/backend/database/postgres/PostgresConnection";

function connectionFixture(): {
  connection: { run: Mock; discard: Mock };
  handle: PostgresConnection;
} {
  const connection = {
    run: vi.fn().mockResolvedValue([[1]]),
    discard: vi.fn(),
  };
  return { connection, handle: connection as unknown as PostgresConnection };
}

describe("PostgreSQL writer ownership", () => {
  it("holds the advisory lock during work and releases it afterwards", async () => {
    const { connection, handle } = connectionFixture();
    const result = await withPostgresWriterOwnership(handle, async () => {
      expect(connection.run).toHaveBeenCalledTimes(1);
      return "saved";
    });
    expect(result).toBe("saved");
    expect(connection.run).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("pg_try_advisory_lock"),
      {},
      "rows",
    );
    expect(connection.run).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("pg_advisory_unlock"),
      {},
      "execute",
    );
  });

  it("preserves the work error and discards a connection when unlock fails", async () => {
    const { connection, handle } = connectionFixture();
    const workError = new Error("work failed");
    connection.run
      .mockResolvedValueOnce([[1]])
      .mockRejectedValueOnce(new Error("unlock failed"));
    await expect(
      withPostgresWriterOwnership(handle, async () => {
        throw workError;
      }),
    ).rejects.toBe(workError);
    expect(connection.discard).toHaveBeenCalledOnce();
  });

  it("propagates unlock failure after successful work", async () => {
    const { connection, handle } = connectionFixture();
    const releaseError = new Error("unlock failed");
    connection.run
      .mockResolvedValueOnce([[1]])
      .mockRejectedValueOnce(releaseError);
    await expect(
      withPostgresWriterOwnership(handle, async () => "saved"),
    ).rejects.toBe(releaseError);
    expect(connection.discard).toHaveBeenCalledOnce();
  });

  it("refuses an aborted request before trying to acquire the lock", async () => {
    const { connection, handle } = connectionFixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      withDatabaseWork(
        { workClass: "request", signal: controller.signal },
        async () => withPostgresWriterOwnership(handle, async () => "saved"),
      ),
    ).rejects.toMatchObject({ reason: "aborted" });
    expect(connection.run).not.toHaveBeenCalled();
  });
});
