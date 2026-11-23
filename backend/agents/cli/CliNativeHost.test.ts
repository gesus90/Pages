import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  nativeHostEnvironment,
  nativeHostProfile,
  nativeHostRequest,
  readNativeHost,
  redactNativeHost,
} from "@/backend/agents/cli/CliNativeHost";

import type * as NodeOs from "node:os";
import type { CliNativeHost } from "@/backend/agents/cli/CliNativeHost";
import type { CliSessionRequest } from "@/backend/agents/cli/CliContracts";
import type { AcpSessionProfile } from "@/backend/agents/acp/AcpDriver";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  userInfo: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof NodeOs>()),
  userInfo: mocks.userInfo,
}));
vi.mock("@/backend/logging/LogCorrelation", () => ({
  correlationEnvironment: () => ({ PAGES_CORRELATION: "corr" }),
}));

/** Builds a deliberately partial test double typed as the parameter it replaces. */
function stub<T>(value: unknown): T {
  return value as T;
}

const originalPlatform = process.platform;

function setPlatform(value: string): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

function account(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    uid: 1000,
    username: "tester",
    homedir: "/home/tester",
    shell: "/bin/zsh",
    ...overrides,
  };
}

function answer(stdout: string): void {
  mocks.execFile.mockImplementation(
    (
      file: string,
      args: string[],
      options: unknown,
      callback: (error: Error | null, result?: unknown) => void,
    ) => callback(null, { stdout, stderr: "" }),
  );
}

beforeEach(() => {
  setPlatform("linux");
  mocks.userInfo.mockReturnValue(account());
});

afterEach(() => {
  setPlatform(originalPlatform);
});

it.each([
  ["a platform other than Linux", () => setPlatform("darwin")],
  ["root", () => mocks.userInfo.mockReturnValue(account({ uid: 0 }))],
  [
    "no login shell",
    () => mocks.userInfo.mockReturnValue(account({ shell: "" })),
  ],
])("refuses the host for %s", async (description, arrange) => {
  arrange();
  await expect(
    readNativeHost("/work", new AbortController().signal),
  ).rejects.toMatchObject({ code: "agent_native_host_unavailable" });
  expect(mocks.execFile).not.toHaveBeenCalled();
});

it("hides the failure of the login shell", async () => {
  mocks.execFile.mockImplementation(
    (
      file: string,
      args: string[],
      options: unknown,
      callback: (e: Error) => void,
    ) => callback(new Error("token=secretvalue")),
  );
  await expect(
    readNativeHost("/work", new AbortController().signal),
  ).rejects.toMatchObject({ code: "agent_native_host_unavailable" });
});

it("refuses an answer without a PATH", async () => {
  answer("HOME=/x\0=empty\0broken\0");
  await expect(
    readNativeHost("/work", new AbortController().signal),
  ).rejects.toMatchObject({ code: "agent_native_host_unavailable" });
});

it("reads the login environment and fills in the session defaults", async () => {
  vi.stubEnv("LANG", "de_DE.UTF-8");
  answer(
    "PATH=/opt/bin:/usr/bin\0HOME=/other\0INVOCATION_ID=abc\0A=b=c\0" +
      "1BAD=x\0BAD NAME=y\0noequals\0",
  );
  const signal = new AbortController().signal;
  const host = await readNativeHost("/work", signal);
  expect(host).toEqual({
    account: "tester",
    home: "/home/tester",
    environment: {
      PATH: "/opt/bin:/usr/bin",
      HOME: "/home/tester",
      A: "b=c",
      XDG_RUNTIME_DIR: "/run/user/1000",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    },
  });
  expect(mocks.execFile).toHaveBeenCalledWith(
    "/bin/zsh",
    ["-lc", "exec /usr/bin/env -0"],
    expect.objectContaining({
      cwd: "/work",
      signal,
      env: expect.objectContaining({
        LANG: "de_DE.UTF-8",
        USER: "tester",
      }) as unknown,
    }),
    expect.any(Function),
  );
});

it("keeps a runtime directory and bus of the login shell and defaults the language", async () => {
  vi.stubEnv("LANG", undefined);
  answer(
    "PATH=/bin\0XDG_RUNTIME_DIR=/run/x\0DBUS_SESSION_BUS_ADDRESS=unix:b\0",
  );
  const host = await readNativeHost("/work", new AbortController().signal);
  expect(host.environment).toMatchObject({
    XDG_RUNTIME_DIR: "/run/x",
    DBUS_SESSION_BUS_ADDRESS: "unix:b",
  });
  expect(mocks.execFile.mock.calls[0]?.[2]).toMatchObject({
    env: { LANG: "C.UTF-8" },
  });
});

const host: CliNativeHost = {
  account: "tester",
  home: "/home/tester",
  environment: { PATH: "/opt/bin::/usr/bin", KEEP: "1" },
};

const request = stub<CliSessionRequest>({
  home: { config: "/cfg" },
  provider: "codex_cli",
  file: "/runner/bin/run",
});

it("puts the login PATH first and appends the runner and Node folders once", () => {
  const environment = nativeHostEnvironment(request, host);
  expect(environment).toMatchObject({
    PATH: `/opt/bin:/usr/bin:/runner/bin:${process.execPath.replace(/\/[^/]*$/u, "")}`,
    HOME: "/home/tester",
    KEEP: "1",
    CODEX_HOME: "/cfg",
    PAGES_CORRELATION: "corr",
  });
  expect(environment.TMPDIR).toBeUndefined();
});

it("prefers the tool folder, sets the temporary directory and tolerates a missing PATH", () => {
  const environment = nativeHostEnvironment(
    { ...request, toolFile: "/tool/bin/t", temporaryDirectory: "/t" },
    { ...host, environment: {} },
  );
  expect(environment.PATH?.startsWith("/tool/bin")).toBe(true);
  expect(environment).toMatchObject({ TMPDIR: "/t", TMP: "/t", TEMP: "/t" });
});

it("turns a request into a native start", () => {
  const started = nativeHostRequest(
    { ...request, isWorkingDirectoryReadOnly: true },
    host,
  );
  expect(started.isWorkingDirectoryReadOnly).toBe(false);
  expect(started.hostEnvironment?.HOME).toBe("/home/tester");
  expect(started.file).toBe("/runner/bin/run");
});

it("records the native execution in the profile", () => {
  const profile = nativeHostProfile(
    stub<AcpSessionProfile>({
      unattended: "yolo",
      permissions: { mode: "full" },
    }),
    host,
  );
  expect(profile).toEqual({
    unattended:
      "yolo; native process of the account tester, no sandbox of Pages",
    permissions: {
      mode: "full",
      execution: "native host process, no namespace or container of Pages",
      account: "tester",
      home: "/home/tester",
      files: "every path the account may read or write",
    },
  });
});

it("masks nothing without a host", () => {
  expect(redactNativeHost("token=abcdefgh1234", undefined)).toBe(
    "token=abcdefgh1234",
  );
});

it("masks secret host values, keys, tokens and assignments", () => {
  const secretHost: CliNativeHost = {
    ...host,
    environment: {
      MY_API_KEY: "supersecretvalue",
      SHORT_TOKEN: "abc",
      PLAIN: "visiblevalue",
    },
  };
  const text = [
    "value supersecretvalue abc visiblevalue",
    "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----",
    "ghp_abcdefghijkl1234 github_pat_abcdefghijkl_12 eyJabc.def.ghi",
    'password: "hunter22" api_key=xyz Authorization: Bearer tok',
  ].join("\n");
  const masked = redactNativeHost(text, secretHost);
  expect(masked).not.toContain("supersecretvalue");
  expect(masked).toContain("abc visiblevalue");
  expect(masked).not.toContain("AAAA");
  expect(masked).not.toContain("ghp_abcdefghijkl1234");
  expect(masked).not.toContain("github_pat_");
  expect(masked).not.toContain("eyJabc");
  expect(masked).not.toContain("hunter22");
  expect(masked).not.toContain("xyz");
  expect(masked).not.toContain("tok");
});
