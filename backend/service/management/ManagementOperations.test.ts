import { describe, expect, it, vi } from "vitest";

import { ManagementOperations } from "./ManagementOperations";

import type { ManagementService } from "./ManagementService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

interface ServiceStub {
  readonly audit: {
    readonly run: ReturnType<
      typeof vi.fn<
        (
          actorId: string,
          operation: string,
          target: string,
          work: () => Promise<unknown>,
        ) => Promise<unknown>
      >
    >;
  };
  readonly projectRevision: ReturnType<typeof vi.fn>;
  readonly call: ReturnType<typeof vi.fn>;
}

function serviceStub(): ServiceStub {
  return {
    audit: {
      run: vi.fn(async (actorId, operation, target, work) => work()),
    },
    projectRevision: vi.fn(async () => "rev"),
    call: vi.fn(async () => ({ id: "u" })),
  };
}

function identityOf(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    userId: "user-1",
    isAdmin: false,
    isManagement: false,
    permissions: [],
    ...overrides,
  };
}

function operationsOf(stub: ServiceStub, channel?: "ui"): ManagementOperations {
  const service = stub as unknown as ManagementService;
  return channel
    ? new ManagementOperations(() => service, channel)
    : new ManagementOperations(() => service);
}

describe("ManagementOperations.audited", () => {
  it("derives the target from the first known identifier", async () => {
    const stub = serviceStub();
    const operations = operationsOf(stub);
    const work = vi.fn(async () => 7);
    const identity = identityOf();
    expect(
      await operations.audited(identity, "op", { ticketId: "t" }, work),
    ).toBe(7);
    await operations.audited(identity, "op", { planId: "p" }, work);
    await operations.audited(identity, "op", { userId: "u" }, work);
    await operations.audited(identity, "op", { pageId: "g" }, work);
    await operations.audited(identity, "op", {}, work);
    await operations.audited(identity, "op", null, work);
    await operations.audited(identity, "op", "text", work);
    expect(stub.audit.run.mock.calls.map((call) => call[2])).toEqual([
      "t",
      "p",
      "u",
      "g",
      "directory",
      "directory",
      "directory",
    ]);
    expect(stub.audit.run.mock.calls[0]?.[0]).toBe("user-1");
  });
});

describe("ManagementOperations.projectRevision", () => {
  it("returns nothing for ordinary identities", async () => {
    const stub = serviceStub();
    expect(
      await operationsOf(stub).projectRevision(identityOf(), "p"),
    ).toBeUndefined();
    expect(stub.projectRevision).not.toHaveBeenCalled();
  });

  it("reads the revision for administrators and management on the channel", async () => {
    const stub = serviceStub();
    const operations = operationsOf(stub, "ui");
    expect(
      await operations.projectRevision(identityOf({ isAdmin: true }), "p"),
    ).toBe("rev");
    expect(
      await operations.projectRevision(identityOf({ isManagement: true }), "p"),
    ).toBe("rev");
    expect(stub.projectRevision).toHaveBeenCalledWith("user-1", "p", "ui");
  });
});

describe("ManagementOperations.handle", () => {
  it("leaves unknown operations to their owner", async () => {
    const stub = serviceStub();
    expect(
      await operationsOf(stub).handle(identityOf(), "other", {}),
    ).toBeNull();
  });

  it("calls the service for a named operation", async () => {
    const stub = serviceStub();
    const response = await operationsOf(stub).handle(
      identityOf(),
      "users_list",
      { a: 1 },
    );
    expect(response).toEqual({ apiVersion: "1", result: { id: "u" } });
    expect(stub.call).toHaveBeenCalledWith(
      "user-1",
      "users_list",
      { a: 1 },
      "mcp",
    );
  });
});
