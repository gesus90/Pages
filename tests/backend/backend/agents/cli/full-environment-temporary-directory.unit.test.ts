import { expect, it, vi } from "vitest";

import { isolateFullEnvironmentTemporaryDirectory } from "@/backend/agents/cli/CliFullEnvironmentTemporaryDirectory";

import type { CliSessionRequest } from "@/backend/agents/cli/CliContracts";

vi.mock("@/backend/agents/cli/CliSshConfigOverlay", () => ({
  sshConfigOverlayArguments: vi.fn(async () => []),
}));

const REQUEST: CliSessionRequest = {
  file: "/owner/bin/codex-acp",
  arguments: ["--yolo"],
  provider: "codex_cli",
  home: { root: "/owner", home: "/owner", config: "/owner", work: "/work" },
  workingDirectory: "/work",
  fullEnvironment: { TOKEN: "owner-secret", PATH: "/owner/bin" },
  environment: {},
  timeoutMs: 0,
  signal: new AbortController().signal,
  onLine: () => {},
};

it("keeps owner access and credentials with a private disk /tmp and owned PID namespace", async () => {
  const request = await isolateFullEnvironmentTemporaryDirectory({
    ...REQUEST,
    temporaryDirectory: "/disk/run/step",
  });
  expect(request.file).toBe("/usr/bin/bwrap");
  expect(request.arguments).toEqual(
    expect.arrayContaining([
      "--unshare-pid",
      "--bind",
      "/",
      "/",
      "--bind",
      "/disk/run/step",
      "/tmp",
    ]),
  );
  expect(request.arguments.slice(-3)).toEqual(["--", REQUEST.file, "--yolo"]);
  expect(request.fullEnvironment).toEqual(REQUEST.fullEnvironment);
  expect(request.environment).toMatchObject({
    TMPDIR: "/tmp",
    TMP: "/tmp",
    TEMP: "/tmp",
    NODE_COMPILE_CACHE: "/tmp/node-compile-cache",
  });
});

it("leaves sessions outside plan execution unchanged", async () => {
  expect(await isolateFullEnvironmentTemporaryDirectory(REQUEST)).toBe(REQUEST);
});
