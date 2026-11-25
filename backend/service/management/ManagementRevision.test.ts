import { describe, expect, it } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";

import {
  managementRevision,
  requireManagementRevision,
} from "./ManagementRevision";

describe("managementRevision", () => {
  it("is stable for equal state and differs for changed state", () => {
    expect(managementRevision({ a: 1 })).toBe(managementRevision({ a: 1 }));
    expect(managementRevision({ a: 1 })).not.toBe(managementRevision({ a: 2 }));
    expect(managementRevision("x")).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe("requireManagementRevision", () => {
  it("accepts a matching revision", () => {
    expect(() => requireManagementRevision("r1", "r1")).not.toThrow();
  });

  it("reports the current revision on a mismatch", () => {
    try {
      requireManagementRevision("r1", "r2");
      expect.unreachable();
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AgentOperationError);
      expect((error as AgentOperationError).code).toBe("CONFLICT");
      expect((error as AgentOperationError).details).toEqual({
        currentRevision: "r1",
      });
    }
  });
});
