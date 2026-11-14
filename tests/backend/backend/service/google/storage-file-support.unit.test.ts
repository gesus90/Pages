import { describe, expect, it } from "vitest";

import {
  driveFailure,
  readEntryName,
  writeRefusal,
} from "@/backend/service/google/StorageFileSupport";

describe("storage file support", () => {
  it("maps provider scope and connection failures to actionable errors", () => {
    expect(
      driveFailure({
        ok: false,
        code: "provider_scope_missing",
        connectionProblem: null,
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "provider_scope_missing",
        consentPath: "/settings/system?googleDriveAccess=write",
      },
    });
    expect(
      driveFailure({
        ok: false,
        code: "not_found",
        connectionProblem: "access_revoked",
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "connection_unavailable",
        connectionProblem: "access_revoked",
        connectionState: "reauthorization_required",
      },
    });
    expect(writeRefusal({ accessToken: "token", canWrite: true })).toBeNull();
  });

  it("validates names after trimming", () => {
    expect(readEntryName("  report.txt  ")).toBe("report.txt");
    for (const name of ["", ".", "..", "a/b", "a\nb", "a".repeat(256)]) {
      expect(readEntryName(name)).toBeNull();
    }
  });
});
