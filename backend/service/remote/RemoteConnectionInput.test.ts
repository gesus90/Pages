import { describe, expect, it } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";

import {
  readRemoteConnectionInput,
  readRemoteWorkspaceInput,
} from "./RemoteConnectionInput";

const HOST_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5eHl6";
const PRIVATE_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n";

function inputOf(overrides: Record<string, unknown> = {}): unknown {
  return {
    name: "  Build  ",
    host: " example.org ",
    port: "22",
    username: " deploy ",
    authMethod: "password",
    departmentId: " dep-1 ",
    password: "secret",
    ...overrides,
  };
}

function codeOf(action: () => unknown): string | null {
  try {
    action();
  } catch (error: unknown) {
    return error instanceof RemoteError
      ? `${error.code}/${error.failure ?? ""}`
      : "other";
  }
  return null;
}

describe("readRemoteConnectionInput", () => {
  it("validates a saved connection", () => {
    const result = readRemoteConnectionInput(
      inputOf({
        privateKey: PRIVATE_KEY,
        hostKey: HOST_KEY,
        allowedRoots: ["/srv/", "/srv", "", "  ", "/a/./b", "/"],
        revision: 3,
      }),
      "save",
    );
    expect(result).toMatchObject({
      name: "Build",
      host: "example.org",
      port: 22,
      username: "deploy",
      authMethod: "password",
      departmentId: "dep-1",
      password: "secret",
      privateKey: PRIVATE_KEY,
      passphrase: "",
      allowedRoots: ["/srv", "/a/b", "/"],
      revision: 3,
    });
    expect(result.hostKey?.algorithm).toBe("ssh-ed25519");
  });

  it("needs no name, department or roots for a test", () => {
    const result = readRemoteConnectionInput(
      inputOf({ host: "10.0.0.1", port: 2222, allowedRoots: ["/x"], name: 5 }),
      "test",
    );
    expect(result).toMatchObject({
      name: "",
      departmentId: "",
      allowedRoots: [],
      hostKey: null,
      revision: null,
      port: 2222,
    });
  });

  it("treats a non-object as invalid", () => {
    expect(codeOf(() => readRemoteConnectionInput("x", "save"))).toBe(
      "remote_connection_invalid/",
    );
    expect(
      codeOf(() =>
        readRemoteConnectionInput(inputOf({ authMethod: "x" }), "test"),
      ),
    ).toBe("remote_connection_invalid/");
  });
});

describe("readRemoteConnectionInput invalid input", () => {
  it.each([
    { label: "name", overrides: { name: 1 } },
    { label: "empty name", overrides: { name: " " } },
    { label: "long name", overrides: { name: "a".repeat(121) } },
    { label: "control name", overrides: { name: "a\nb" } },
    { label: "host type", overrides: { host: 1 } },
    { label: "host", overrides: { host: "-bad host" } },
    { label: "port text", overrides: { port: "x" } },
    { label: "port type", overrides: { port: null } },
    { label: "port fraction", overrides: { port: 1.5 } },
    { label: "port low", overrides: { port: 0 } },
    { label: "port high", overrides: { port: 65_536 } },
    { label: "user type", overrides: { username: 1 } },
    { label: "user", overrides: { username: "-x" } },
    { label: "password type", overrides: { password: 1 } },
    { label: "password long", overrides: { password: "a".repeat(1025) } },
    { label: "password control", overrides: { password: "a\tb" } },
    { label: "passphrase control", overrides: { passphrase: "a\u0001" } },
    { label: "revision type", overrides: { revision: "1" } },
    { label: "revision low", overrides: { revision: 0 } },
    { label: "revision fraction", overrides: { revision: 1.5 } },
  ])("rejects an invalid $label", ({ overrides }) => {
    expect(
      codeOf(() => readRemoteConnectionInput(inputOf(overrides), "save")),
    ).toBe("remote_connection_invalid/");
  });

  it("rejects bad private keys with a key hint", () => {
    for (const privateKey of ["not a key", `${PRIVATE_KEY}\u0000`])
      expect(
        codeOf(() =>
          readRemoteConnectionInput(inputOf({ privateKey }), "save"),
        ),
      ).toBe("remote_connection_invalid/key_invalid");
  });

  it("accepts empty secrets as null, undefined or empty text", () => {
    for (const password of [undefined, null, ""])
      expect(
        readRemoteConnectionInput(inputOf({ password, hostKey: "" }), "save")
          .password,
      ).toBe("");
  });

  it.each([5, "x".repeat(5001), "ssh-rsa nonsense"])(
    "rejects the host key %s",
    (hostKey) => {
      expect(
        codeOf(() => readRemoteConnectionInput(inputOf({ hostKey }), "save")),
      ).toBe("remote_host_key_invalid/");
    },
  );

  it("rejects an invalid department", () => {
    for (const departmentId of [1, " ", "d".repeat(101)])
      expect(
        codeOf(() =>
          readRemoteConnectionInput(inputOf({ departmentId }), "save"),
        ),
      ).toBe("remote_department_invalid/");
  });

  it("rejects invalid allowed roots", () => {
    const tooMany = Array.from({ length: 21 }, (_, index) => `/r${index}`);
    for (const allowedRoots of [
      "/x",
      [1],
      ["relative"],
      ["/a".repeat(2100)],
      ["/a\u0001"],
      ["/a/../b"],
      tooMany,
    ])
      expect(
        codeOf(() =>
          readRemoteConnectionInput(inputOf({ allowedRoots }), "save"),
        ),
      ).toBe("remote_roots_invalid/");
  });

  it("treats missing roots as empty", () => {
    for (const allowedRoots of [undefined, null])
      expect(
        readRemoteConnectionInput(inputOf({ allowedRoots }), "save")
          .allowedRoots,
      ).toEqual([]);
  });
});

describe("readRemoteWorkspaceInput", () => {
  function workspaceOf(overrides: Record<string, unknown> = {}): unknown {
    return {
      name: " W ",
      connectionId: "c1",
      path: " /srv/app ",
      projectId: "p1",
      ...overrides,
    };
  }

  it("validates a profile", () => {
    expect(readRemoteWorkspaceInput(workspaceOf({ revision: 2 }))).toEqual({
      name: "W",
      connectionId: "c1",
      path: "/srv/app",
      projectId: "p1",
      revision: 2,
    });
    expect(readRemoteWorkspaceInput(workspaceOf()).revision).toBeNull();
  });

  it.each([
    { name: 1 },
    { path: "host:/srv" },
    { path: "/a\u0001" },
    { name: "n".repeat(121) },
    { connectionId: "c".repeat(101) },
    { projectId: "p".repeat(101) },
    { path: `/${"a".repeat(4096)}` },
    { revision: 0 },
  ])("rejects %j", (overrides) => {
    expect(codeOf(() => readRemoteWorkspaceInput(workspaceOf(overrides)))).toBe(
      "remote_workspace_invalid/",
    );
  });
});
