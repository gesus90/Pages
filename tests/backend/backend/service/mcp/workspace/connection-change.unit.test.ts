import { expect, it } from "vitest";

import {
  confirmedHostKeyLine,
  connectionChangeQuestion,
} from "@/backend/service/mcp/workspace/McpConnectionChange";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { ValidatedRemoteConnection } from "@/backend/service/remote/RemoteConnectionInput";
import type {
  RemoteConnectionView,
  RemoteWorkspaceView,
} from "@/definition/RemoteConnection";

it("asks before changing roots that exclude a workspace or changing department", () => {
  const stored = partial<RemoteConnectionView>({
    id: "connection",
    name: "Server",
    username: "user",
    departmentId: "team",
    allowedRoots: ["/old"],
  });
  const workspace = partial<RemoteWorkspaceView>({
    id: "work",
    name: "Work",
    path: "/old/project",
    projectId: "project",
    projectName: "Project",
  });
  const next = partial<ValidatedRemoteConnection>({
    username: "user",
    departmentId: "other",
    allowedRoots: ["/new"],
  });
  expect(connectionChangeQuestion(stored, next, [workspace])).toMatchObject({
    confirmationRequired: true,
    changes: ["allowed_roots", "department"],
    affectedWorkspaces: [{ id: "work" }],
  });
  expect(
    connectionChangeQuestion(
      stored,
      { ...next, departmentId: "team", allowedRoots: ["/old"] },
      [workspace],
    ),
  ).toBeNull();
});

it("pins only the key the server presented with an exact fingerprint", () => {
  const result = {
    presentedHostKey: {
      algorithm: "ssh-ed25519",
      key: "encoded",
      fingerprint: "SHA256:known",
    },
  };
  expect(confirmedHostKeyLine(result, "SHA256:known")).toBe(
    "ssh-ed25519 encoded",
  );
  expect(confirmedHostKeyLine(result, "SHA256:other")).toBeNull();
  expect(
    confirmedHostKeyLine({ presentedHostKey: null }, "SHA256:known"),
  ).toBeNull();
});
