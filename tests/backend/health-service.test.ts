import { describe, expect, it, vi } from "vitest";

import { HealthService } from "@/backend/service/HealthService";

import { useMigratedDatabase } from "../helpers/test-database";

import type { Database } from "@/backend/database/Database";

describe("HealthService", () => {
  const getDatabase = useMigratedDatabase();

  it("reports a database that answers", async () => {
    await expect(
      new HealthService(getDatabase()).canQueryDatabase(),
    ).resolves.toBe(true);
  });

  it("reports and logs a database that fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = {
      query: vi.fn().mockRejectedValue(new Error("closed")),
    } as unknown as Database;

    await expect(new HealthService(failing).canQueryDatabase()).resolves.toBe(
      false,
    );
    expect(error).toHaveBeenCalledWith(
      "[pages] The health check could not query the database.",
      expect.any(Error),
    );
  });
});
