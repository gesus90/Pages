import { expect, it, vi } from "vitest";

import { McpConnectionService } from "@/backend/service/mcp/workspace/McpConnectionService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpWorkspaceServices } from "@/backend/service/mcp/workspace/McpWorkspaceCatalog";
import type { McpConnectionTestRequest } from "@/backend/service/mcp/workspace/McpWorkspaceRequest";

const RESULT = {
  reachability: { state: "passed", code: null },
  hostKey: { state: "failed", code: "host_key_unconfirmed" },
  authentication: { state: "skipped", code: null },
  testedAt: "now",
  presentedHostKey: {
    algorithm: "ssh-ed25519",
    key: "encoded",
    fingerprint: "SHA256:known",
  },
};

it("never tests credentials after a host key fingerprint mismatch", async () => {
  const test = vi.fn(async () => RESULT);
  const requireManagement = vi.fn(async () => {});
  const service = new McpConnectionService(
    partial<McpWorkspaceServices>({ connections: { test, requireManagement } }),
  );
  const request = partial<McpConnectionTestRequest>({
    host: "host",
    port: 22,
    username: "user",
    authMethod: "password",
    hostKeyFingerprint: "SHA256:other",
  });
  await expect(service.test("user", request)).rejects.toMatchObject({
    code: "host_key_mismatch",
  });
  expect(test).toHaveBeenCalledOnce();
  expect(requireManagement).toHaveBeenCalledWith("user");
});

it("returns the test result when no fingerprint was requested", async () => {
  const service = new McpConnectionService(
    partial<McpWorkspaceServices>({
      connections: { test: async () => RESULT },
    }),
  );
  const result = await service.test(
    "user",
    partial<McpConnectionTestRequest>({
      host: "host",
      port: 22,
      username: "user",
      authMethod: "password",
    }),
  );
  expect(result.test.presentedHostKey).toEqual({
    algorithm: "ssh-ed25519",
    fingerprint: "SHA256:known",
  });
});
