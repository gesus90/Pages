import { expect, it, vi } from "vitest";

import { AgentFileOperationService } from "@/backend/service/agents/AgentFileOperationService";
import { planOperationFailure } from "@/backend/service/agents/bridge/PlanBridgeFailure";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { sessionOperations } from "@/backend/service/mcp/AgentOperationCatalog";
import { TOOL_ENTRIES } from "@/definition/AgentTools/ToolCatalog";
import { RepositoryReadError } from "@/definition/RepositoryRead";

import { storageWorld } from "../google/page323-storage-fixture";

import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AgentFileDependencies } from "@/backend/service/agents/AgentFileOperationService";

const IDENTITY = { userId: "Ed", isAdmin: false, permissions: [] } as const;

function world(): ReturnType<typeof storageWorld> & {
  readonly service: AgentFileOperationService;
  readonly stored: Map<string, StoredAgentOperation>;
  readonly repositories: AgentFileDependencies["repositories"];
} {
  const storage = storageWorld();
  const stored = new Map<string, StoredAgentOperation>();
  const repositories = {
    run: vi.fn<AgentFileDependencies["repositories"]["run"]>(async () => ({
      commits: [],
    })),
  };
  const service = new AgentFileOperationService({
    files: storage.files,
    access: storage.access,
    repositories,
    receipts: {
      claim: async (userId, id, receipt) => {
        const prior = stored.get(`${userId}:${id}`);
        if (prior) return prior;
        stored.set(`${userId}:${id}`, { ...receipt, resultJson: "null" });
        return null;
      },
      finish: async (userId, id, resultJson) => {
        const prior = stored.get(`${userId}:${id}`);
        if (!prior) throw new Error("receipt missing");
        stored.set(`${userId}:${id}`, { ...prior, resultJson });
      },
    },
  });
  return { ...storage, service, stored, repositories };
}

it("registers Storage and repository tools with read/full/ticket session separation", () => {
  const names = TOOL_ENTRIES.map((entry) => entry.tool.name);
  expect(names).toContain("repository_log");
  expect(names).toContain("storage_upload");
  const scope = { runId: "run", stepId: "step", operations: [], tickets: [] };
  expect(sessionOperations({ ...scope, reach: "read" }, false)).toContain(
    "repository.log",
  );
  expect(sessionOperations({ ...scope, reach: "read" }, false)).toContain(
    "storage.read",
  );
  expect(sessionOperations({ ...scope, reach: "read" }, false)).not.toContain(
    "storage.upload",
  );
  expect(sessionOperations({ ...scope, reach: "full" }, false)).toContain(
    "storage.upload",
  );
  expect(
    sessionOperations({ ...scope, reach: "tickets" }, false),
  ).not.toContain("repository.log");
});

it("describes the upload conflict policies and their meaning", () => {
  const upload = TOOL_ENTRIES.find(
    (entry) => entry.tool.name === "storage_upload",
  );
  expect(upload?.tool.inputSchema.properties?.onConflict).toEqual({
    type: "string",
    enum: ["fail", "keep_both", "rename"],
    description:
      "fail (default) reports a name conflict; keep_both chooses a free name. rename is an alias for keep_both.",
  });
});

it("writes as the account and replays the durable receipt without a second folder", async () => {
  const testWorld = world();
  const input = {
    operationId: "operation",
    parentRef: "pages",
    name: "Reports",
  };
  const first = await testWorld.service.handle(
    IDENTITY,
    "storage.create_folder",
    input,
  );
  expect(first).toMatchObject({
    result: { storage: { ok: true, value: { name: "Reports" } } },
  });
  expect(
    await testWorld.service.handle(IDENTITY, "storage.create_folder", input),
  ).toEqual(first);
  expect(testWorld.drive.calls.createFolder).toHaveBeenCalledTimes(1);
  await expect(
    testWorld.service.handle(IDENTITY, "storage.create_folder", {
      ...input,
      name: "Different",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  testWorld.grants.splice(0);
  await expect(
    testWorld.service.handle(IDENTITY, "storage.create_folder", input),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(testWorld.drive.calls.createFolder).toHaveBeenCalledTimes(1);
});

it("rejects an unfinished reservation and never repeats a possibly completed external write", async () => {
  const testWorld = world();
  const input = {
    operationId: "operation",
    parentRef: "pages",
    name: "Reports",
  };
  await testWorld.service.handle(IDENTITY, "storage.create_folder", input);
  const prior = testWorld.stored.get("Ed:operation");
  if (!prior) throw new Error("receipt missing");
  testWorld.stored.set("Ed:operation", { ...prior, resultJson: "null" });
  await expect(
    testWorld.service.handle(IDENTITY, "storage.create_folder", input),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(testWorld.drive.calls.createFolder).toHaveBeenCalledTimes(1);
});

it("reads capabilities and uploads text, while rejecting missing rights and operation IDs", async () => {
  const testWorld = world();
  expect(
    await testWorld.service.handle(IDENTITY, "storage.capabilities", {}),
  ).toMatchObject({
    result: {
      storage: { ok: true, value: { grantedFolders: [{ ref: "pages" }] } },
    },
  });
  const input = {
    operationId: "upload",
    parentRef: "pages",
    name: "report.md",
    content: "# Report",
    encoding: "text",
    mimeType: "text/markdown",
  };
  expect(
    await testWorld.service.handle(IDENTITY, "storage.upload", input),
  ).toMatchObject({ result: { storage: { ok: true } } });
  await expect(
    testWorld.service.handle(IDENTITY, "storage.upload", {
      ...input,
      parentRef: "private",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    testWorld.service.handle(IDENTITY, "storage.create_folder", {
      parentRef: "pages",
      name: "Missing receipt",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(testWorld.drive.calls.upload).toHaveBeenCalledTimes(1);
});

it.each(["keep_both", "rename"])(
  "uploads a free name through the plan bridge with %s",
  async (policy) => {
    const testWorld = world();
    const result = await testWorld.service.handle(IDENTITY, "storage.upload", {
      operationId: "upload-conflict",
      parentRef: "reports",
      name: "report.md",
      content: "new",
      encoding: "text",
      onConflict: policy,
    });
    expect(result).toMatchObject({ result: { storage: { ok: true } } });
    expect(testWorld.drive.calls.upload.mock.calls[0]?.[1]).toMatchObject({
      name: "report (2).md",
    });
  },
);

it.each([undefined, "fail"])(
  "does not replace a conflicting file with policy %s",
  async (policy) => {
    const testWorld = world();
    const input = {
      operationId: "upload-conflict",
      parentRef: "reports",
      name: "report.md",
      content: "new",
      encoding: "text",
      ...(policy === undefined ? {} : { onConflict: policy }),
    };
    expect(
      await testWorld.service.handle(IDENTITY, "storage.upload", input),
    ).toMatchObject({
      result: { storage: { ok: false, error: { code: "name_conflict" } } },
    });
    expect(testWorld.drive.calls.upload).not.toHaveBeenCalled();
  },
);

it("refuses invalid upload policies through the plan bridge", async () => {
  const testWorld = world();
  const input = {
    operationId: "upload-conflict",
    parentRef: "reports",
    name: "report.md",
    content: "new",
    encoding: "text",
  };
  await expect(
    testWorld.service.handle(IDENTITY, "storage.upload", {
      ...input,
      onConflict: "unknown",
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { problems: [expect.stringContaining("fail or keep_both")] },
  });
  await expect(
    testWorld.service.handle(IDENTITY, "storage.upload", {
      ...input,
      onConflict: "overwrite",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(testWorld.drive.calls.upload).not.toHaveBeenCalled();
  expect(
    planOperationFailure(
      new AgentOperationError("INVALID_REQUEST", {
        reason: "validation",
        problems: [
          "onConflict must be fail or keep_both; rename is an alias for keep_both.",
        ],
      }),
    ),
  ).toMatchObject({
    details: { problems: [expect.stringContaining("fail or keep_both")] },
  });
});

it("dispatches repository reads with the verified account and translates refusal without diagnostics", async () => {
  const testWorld = world();
  expect(
    await testWorld.service.handle(IDENTITY, "repository.log", {
      projectId: "pages",
      range: "c5ee1978..3468b2db",
    }),
  ).toEqual({ apiVersion: "1", result: { repository: { commits: [] } } });
  expect(testWorld.repositories.run).toHaveBeenCalledWith(
    "Ed",
    "repository_log",
    { projectId: "pages", range: "c5ee1978..3468b2db" },
  );
  vi.mocked(testWorld.repositories.run).mockRejectedValue(
    new RepositoryReadError("FORBIDDEN"),
  );
  await expect(
    testWorld.service.handle(IDENTITY, "repository.log", {
      projectId: "private",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await testWorld.service.handle(IDENTITY, "unrelated.operation", {}),
  ).toBeNull();
});
