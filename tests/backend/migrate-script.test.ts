import { afterEach, describe, expect, it, vi } from "vitest";

import { runTransferCommand } from "@/backend/database/legacy/TransferCommand";

vi.mock("@/backend/database/legacy/TransferCommand", () => ({
  runTransferCommand: vi.fn(),
}));

describe("scripts/migrate-sqlite-to-duckdb", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("passes the command-line arguments on and exits with the command's code", async () => {
    vi.mocked(runTransferCommand).mockResolvedValue(7);

    await import("../../scripts/migrate-sqlite-to-duckdb");

    expect(runTransferCommand).toHaveBeenCalledWith(
      process.argv.slice(2),
      console,
    );
    expect(process.exitCode).toBe(7);
  });
});
