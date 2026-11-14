import { describe, expect, it, vi } from "vitest";

import { GoogleDriveSimulatedConnection } from "@/backend/service/google/GoogleDriveSimulatedConnection";

describe("GoogleDriveSimulatedConnection", () => {
  it("reports a confirmed simulated account and consent needs", async () => {
    const readAccount = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        emailAddress: "user@example.test",
        permissionId: "permission",
      },
    });
    const connection = new GoogleDriveSimulatedConnection({
      client: { readAccount },
      grantedScopes: [],
    });
    expect(await connection.start()).toBeNull();
    expect(await connection.complete()).toBe("invalid");
    expect(
      await connection.getStatus({
        allowed: ["https://pages.example.test"],
        current: null,
      }),
    ).toMatchObject({
      state: "connected",
      accountEmail: "user@example.test",
      isSimulation: true,
      needsFolderAccess: true,
      needsWriteAccess: true,
    });
    expect(readAccount).toHaveBeenCalledWith("simulated-access-token");
  });

  it("reports an unavailable provider and recognizes full access", async () => {
    const connection = new GoogleDriveSimulatedConnection({
      client: {
        readAccount: vi
          .fn()
          .mockResolvedValue({ ok: false, problem: "google_unreachable" }),
      },
      grantedScopes: ["https://www.googleapis.com/auth/drive"],
    });
    expect(await connection.access()).toEqual({
      ok: false,
      problem: "google_unreachable",
      state: "unavailable",
    });
    expect(
      await connection.getStatus({ allowed: [], current: null }),
    ).toMatchObject({
      state: "unavailable",
      needsFolderAccess: false,
      needsWriteAccess: false,
      problem: "google_unreachable",
    });
  });
});
