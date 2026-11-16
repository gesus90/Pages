import { expect, it } from "vitest";

import {
  readRemoteConnectionInput,
  readRemoteWorkspaceInput,
} from "@/backend/service/remote/RemoteConnectionInput";

const CONNECTION = {
  name: " Server ",
  host: " example.org ",
  port: "22",
  username: " user ",
  authMethod: "password",
  departmentId: " department ",
};

it("normalizes saved connection fields and roots while preserving secrets", () => {
  expect(
    readRemoteConnectionInput(
      {
        ...CONNECTION,
        password: " secret ",
        privateKey: "-----BEGIN PRIVATE KEY-----\nsynthetic",
        passphrase: " phrase ",
        allowedRoots: [" /home//user/ ", "/home/user", "", "/"],
        revision: 2,
      },
      "save",
    ),
  ).toMatchObject({
    name: "Server",
    host: "example.org",
    port: 22,
    username: "user",
    departmentId: "department",
    password: " secret ",
    passphrase: " phrase ",
    allowedRoots: ["/home/user", "/"],
    revision: 2,
  });
});

it("accepts a test connection without save-only fields", () => {
  expect(
    readRemoteConnectionInput(
      { host: "::1", port: 65535, username: "root", authMethod: "key" },
      "test",
    ),
  ).toMatchObject({
    name: "",
    departmentId: "",
    allowedRoots: [],
    password: "",
    hostKey: null,
    revision: null,
  });
});

it.each([
  ["name", ""],
  ["name", "x".repeat(121)],
  ["host", "-invalid"],
  ["port", 0],
  ["port", 65536],
  ["port", 1.5],
  ["username", "bad user"],
  ["authMethod", "unknown"],
  ["password", "secret\n"],
  ["passphrase", "x".repeat(1025)],
  ["privateKey", "not a key"],
  ["privateKey", "-----BEGIN PRIVATE KEY-----\0"],
  ["revision", 0],
])("rejects invalid connection field %s", (field, input) => {
  expect(() =>
    readRemoteConnectionInput({ ...CONNECTION, [field]: input }, "save"),
  ).toThrow("remote_connection_invalid");
});

it.each([
  ["departmentId", "  ", "remote_department_invalid"],
  ["hostKey", "invalid", "remote_host_key_invalid"],
  ["allowedRoots", ["/home/../etc"], "remote_roots_invalid"],
  ["allowedRoots", ["relative"], "remote_roots_invalid"],
  ["allowedRoots", "not an array", "remote_roots_invalid"],
])("rejects invalid %s with its specific error", (field, input, error) => {
  expect(() =>
    readRemoteConnectionInput({ ...CONNECTION, [field]: input }, "save"),
  ).toThrow(error);
});

it("validates workspace identifiers and absolute paths", () => {
  const workspace = {
    name: " Work ",
    connectionId: " conn ",
    projectId: " project ",
    path: " /srv/project ",
    revision: 1,
  };
  expect(readRemoteWorkspaceInput(workspace)).toEqual({
    name: "Work",
    connectionId: "conn",
    projectId: "project",
    path: "/srv/project",
    revision: 1,
  });
  for (const invalid of [
    { path: "host:/srv" },
    { name: "" },
    { projectId: "bad\nproject" },
    { revision: -1 },
  ]) {
    expect(() =>
      readRemoteWorkspaceInput({ ...workspace, ...invalid }),
    ).toThrow("remote_workspace_invalid");
  }
});
