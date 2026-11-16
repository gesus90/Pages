import { expect, it } from "vitest";

import { McpWorkspaceRequest } from "@/backend/service/mcp/workspace/McpWorkspaceRequest";

it("requires a connection only for remote workspace creation", () => {
  expect(
    McpWorkspaceRequest.workspaceCreate({
      kind: "local",
      name: " Work ",
      path: "/work",
      projectId: "project",
    }),
  ).toMatchObject({ name: "Work" });
  expect(() =>
    McpWorkspaceRequest.workspaceCreate({
      kind: "local",
      name: "Work",
      path: "/work",
      projectId: "project",
      connectionId: "connection",
    }),
  ).toThrow();
  expect(() =>
    McpWorkspaceRequest.workspaceCreate({
      kind: "remote",
      name: "Work",
      path: "/work",
      projectId: "project",
    }),
  ).toThrow();
});

it("rejects empty changes, duplicate queries and invalid fingerprints", () => {
  expect(() => McpWorkspaceRequest.workspaceUpdate({ revision: 1 })).toThrow();
  expect(() =>
    McpWorkspaceRequest.connectionUpdate({ revision: 1, confirmed: true }),
  ).toThrow();
  expect(() =>
    McpWorkspaceRequest.workspaceList(
      new URLSearchParams("kind=local&kind=remote"),
    ),
  ).toThrow();
  expect(() =>
    McpWorkspaceRequest.connectionTest({
      host: "host",
      port: 22,
      username: "user",
      authMethod: "password",
      hostKeyFingerprint: "bad",
    }),
  ).toThrow();
  expect(
    McpWorkspaceRequest.folders(new URLSearchParams("showHidden=1")),
  ).toEqual({ showHidden: "1" });
});
