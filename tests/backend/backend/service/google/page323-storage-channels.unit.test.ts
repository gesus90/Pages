import { beforeEach, expect, it, vi } from "vitest";

import { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import { PicaAdminService } from "@/backend/service/chat/admin/PicaAdminService";
import { registerPicaStorageTools } from "@/backend/service/chat/admin/PicaStorageTools";
import { runMcpStorageRoute } from "@/app/lib/mcp-storage-route.server";

import { storageWorld } from "./page323-storage-fixture";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";

vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  registerShutdownTask: vi.fn(),
}));
const services = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: services.get,
}));

const CONTEXT: RuntimeExecutionContext = {
  userId: "Ed",
  sessionId: "session",
  runId: "run",
  signal: new AbortController().signal,
  authorize: async () => undefined,
};

beforeEach(() => services.get.mockReset());

it("offers and runs native Storage tools with the agent's folder rights, without administrator mode", async () => {
  const world = storageWorld();
  const service = new PicaAdminService(
    {
      users: { getById: async () => null },
      administration: { getContext: async () => world.account },
    },
    { storage: world.files },
  );
  const registry = new RuntimeToolRegistry(async () => false);
  registerPicaStorageTools(registry, {
    service,
    turn: async () => ({
      message: "Write report",
      id: "turn",
      confirmation: null,
    }),
    spend: () => true,
  });
  expect(
    registry.describe({ includeAdministrator: false }).map((tool) => tool.id),
  ).toContain("storage_create_folder");
  expect(
    await registry.invoke(
      "storage_create_folder",
      { parentRef: "pages", name: "Reports" },
      CONTEXT,
    ),
  ).toMatchObject({ isValid: true, output: { ok: true, error: null } });
  expect(
    await registry.invoke(
      "storage_create_folder",
      { parentRef: "private", name: "Denied" },
      CONTEXT,
    ),
  ).toMatchObject({ isValid: true, output: { ok: false, error: "FORBIDDEN" } });
  expect(world.drive.calls.createFolder).toHaveBeenCalledTimes(1);
  expect(world.repository.record).toHaveBeenCalledWith(
    expect.objectContaining({ actorId: "Ed", actorName: "Ed Agent" }),
    "permission",
  );
});

it("MCP checks folder rights for uploads and downloads and never grants cookie-based access", async () => {
  const world = storageWorld();
  const authenticate = vi.fn(async () => ({ id: "Ed" }));
  services.get.mockResolvedValue({
    mcpUserApi: { authenticate },
    googleDriveFileService: world.files,
  });
  const create = (parentRef: string): Request =>
    new Request("http://pages/api/mcp/v1/storage/create-folder", {
      method: "POST",
      headers: {
        Authorization: "Bearer agent-session",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ parentRef, name: "Report" }),
    });
  expect(
    (await runMcpStorageRoute(create("pages"), "create-folder")).status,
  ).toBe(200);
  const upload = new Request("http://pages/api/mcp/v1/storage/upload", {
    method: "POST",
    headers: {
      Authorization: "Bearer agent-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parentRef: "pages",
      name: "report.md",
      content: "# Report",
      encoding: "text",
      mimeType: "text/markdown",
    }),
  });
  expect((await runMcpStorageRoute(upload, "upload")).status).toBe(200);
  const denied = await runMcpStorageRoute(create("private"), "create-folder");
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ error: "forbidden" });
  const download = await runMcpStorageRoute(
    new Request("http://pages/api/mcp/v1/storage/download?ref=private"),
    "download",
  );
  expect(download.status).toBe(403);
  expect(authenticate).toHaveBeenLastCalledWith(null);
  world.grants.splice(0);
  expect(
    (await runMcpStorageRoute(create("pages"), "create-folder")).status,
  ).toBe(403);
  expect(world.drive.calls.createFolder).toHaveBeenCalledTimes(1);
});

it.each([
  { field: "onConflict", policy: "keep_both" },
  { field: "onConflict", policy: "rename" },
  { field: "conflict", policy: "rename" },
  { field: "onConflict", policy: "fail" },
  { field: "onConflict", policy: undefined },
  { field: "onConflict", policy: "unknown" },
  { field: "onConflict", policy: "overwrite" },
])(
  "validates upload conflict policy $field=$policy at the MCP HTTP boundary",
  async ({ field, policy }) => {
    const world = storageWorld();
    services.get.mockResolvedValue({
      mcpUserApi: { authenticate: async () => ({ id: "Ed" }) },
      googleDriveFileService: world.files,
    });
    const request = new Request("http://pages/api/mcp/v1/storage/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentRef: "reports",
        name: "report.md",
        content: "new",
        encoding: "text",
        [field]: policy,
      }),
    });
    const response = await runMcpStorageRoute(request, "upload");
    const body: unknown = await response.json();
    if (policy === "keep_both" || policy === "rename") {
      expect(response.status).toBe(200);
      expect(world.drive.calls.upload.mock.calls[0]?.[1]).toMatchObject({
        name: "report (2).md",
      });
    } else {
      expect(body).toMatchObject({
        error:
          policy === "fail" || policy === undefined
            ? "name_conflict"
            : "invalid_request",
      });
      if (policy !== "fail" && policy !== undefined)
        expect(body).toMatchObject({
          message:
            "onConflict must be fail or keep_both; rename is an alias for keep_both.",
        });
      expect(world.drive.calls.upload).not.toHaveBeenCalled();
    }
  },
);
