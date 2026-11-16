import { expect, it } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { RemoteError } from "@/backend/error/RemoteErrors";
import {
  hideInvisibleProject,
  toMcpWorkspaceError,
} from "@/backend/service/mcp/workspace/McpWorkspaceError";

it("translates remote failures and retains only stable public details", () => {
  expect(
    toMcpWorkspaceError(
      new RemoteError("remote_check_failed", "unreachable_timeout"),
    ),
  ).toMatchObject({
    code: "check_failed",
    status: 409,
    detail: "unreachable_timeout",
  });
  expect(
    toMcpWorkspaceError(new RemoteError("remote_access_denied")),
  ).toMatchObject({ code: "forbidden", status: 403, detail: null });
  expect(
    toMcpWorkspaceError(new AgentError("workspace_path_outside_roots")),
  ).toMatchObject({
    code: "path_invalid",
    status: 400,
    detail: "outside_roots",
  });
  expect(toMcpWorkspaceError(new Error("internal"))).toBeNull();
});

it("hides a project access denial as not found and propagates other failures", async () => {
  await expect(
    hideInvisibleProject(async () => {
      throw new AgentError("workspace_access_denied");
    }),
  ).rejects.toMatchObject({ code: "not_found", status: 404 });
  await expect(
    hideInvisibleProject(async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
  await expect(hideInvisibleProject(async () => "ok")).resolves.toBe("ok");
});
